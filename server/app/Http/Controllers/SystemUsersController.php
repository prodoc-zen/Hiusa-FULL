<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\ClearanceSignature;
use App\Models\User;
use App\Services\PasswordResetService;
use App\Support\FilterValues;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Database\Query\Builder;
use Illuminate\Database\QueryException;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\Rule;
use RuntimeException;

class SystemUsersController extends Controller
{
    private const ROLES = ['SUPER_ADMIN', 'ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'];

    /**
     * Every foreign key to users is read from the schema and BLOCKS deleting the person unless it is listed here
     * ("table.column"). Listed columns hold rows that are disposable (they go with the user) or that are
     * reassigned or cleared (set null, or moved to the deleting SAO by transferInstitutionalRecords). A new
     * table that points at users is therefore protected by default; add it here only when its rows do not
     * count as the person's history. The list is the agreed allowlist and nothing more: a person's own work
     * (task progress, reviews, checks, calendar and deadline records) is history and blocks deletion. A test
     * pins this list, fails if an entry matches no real foreign key, and fails if one could make the database
     * refuse the delete (anything but cascade or set null).
     */
    private const DISPOSABLE_REFERENCES = [
        'notifications.user_id',
        'announcement_views.user_id',
        'announcement_reactions.user_id',
        'announcement_recipients.user_id',
        'fingerprints.user_id',
        'account_profiles.user_school_id',
        'organization_applicant_grants.user_school_id',
        'organization_applicant_grants.granted_by',
        'tasks.assigned_to',
        'announcements.created_by',
        'ai_outputs.requested_by',
        'ai_outputs.decided_by',
        // Moved to the deleting SAO by transferInstitutionalRecords() before the delete.
        'compliance_requirement_types.created_by',
        'clearance_periods.created_by',
    ];

    /** Response keys the SAO page and its tests already know, for the columns that were counted before. */
    private const COUNT_KEYS = [
        'clearance_signatures.student_id' => 'clearance_signatures',
        'transactions.recorded_by' => 'transactions',
        'collections.collected_by' => 'collections',
        'cash_advances.borrower_id' => 'cash_advances',
        'events.created_by' => 'events',
        'attendance.user_id' => 'attendance',
        'orders.student_id' => 'orders',
        'invoices.student_id' => 'invoices',
        'event_requirement_files.uploaded_by' => 'event_requirement_files',
        'votes.voter_id' => 'votes',
        'candidates.user_id' => 'candidates',
        'tasks.created_by' => 'tasks',
        'approval_requests.requested_by' => 'approval_requests',
        'grievances.submitted_by' => 'grievances',
        'venue_bookings.requested_by' => 'venue_bookings',
        'organization_compliance_submissions.submitted_by' => 'organization_compliance_submissions',
        'event_registrations.user_id' => 'event_registrations',
        'evaluation_responses.user_id' => 'evaluation_responses',
        'remittances.remitted_by' => 'remittances',
        'invoice_payments.recorded_by' => 'invoice_payments',
        'cash_advance_repayments.recorded_by' => 'cash_advance_repayments',
    ];

    /**
     * What the SAO reads for every counted reference ("table.column"): what the person did, in plain words, so
     * no table or column name reaches the screen. A test fails if a foreign key to users that the guard counts
     * has no label here.
     */
    private const LABELS = [
        'academic_semesters.created_by' => 'semesters created',
        'academic_years.created_by' => 'academic years created',
        'announcements.reviewed_by' => 'announcements reviewed',
        'approval_requests.assigned_approver' => 'approval requests assigned to them',
        'approval_requests.requested_by' => 'approval requests submitted',
        'approval_requests.reviewed_by' => 'approval requests reviewed',
        'attendance.recorded_by' => 'attendance entries recorded',
        'attendance.user_id' => 'attendance records',
        'audit_logs.user_id' => 'activity log entries',
        'budgets.department_head_approved_by' => 'budgets approved as department head',
        'candidates.user_id' => 'election candidacies',
        'cash_advance_repayments.recorded_by' => 'cash advance repayments recorded',
        'cash_advances.approved_by' => 'cash advances approved',
        'cash_advances.borrower_id' => 'cash advances borrowed',
        'cash_advances.released_by' => 'cash advances released',
        'clearance_signatures.signed_by' => 'clearance signatures given',
        'clearance_signatures.student_id' => 'clearance records',
        'collections.collected_by' => 'collections recorded',
        'collections.verified_by' => 'collections verified',
        'department_head_invitations.invited_by' => 'department head invitations sent',
        'evaluation_responses.user_id' => 'evaluation responses submitted',
        'evaluation_windows.created_by' => 'evaluation windows created',
        'event_registrations.user_id' => 'event registrations',
        'event_requirement_files.uploaded_by' => 'event requirement files uploaded',
        'events.created_by' => 'events created',
        'financial_forecasts.generated_by' => 'financial forecasts generated',
        'financial_report_deadlines.set_by' => 'financial report deadlines set',
        'financial_reports.department_head_approved_by' => 'financial reports approved as department head',
        'financial_reports.generated_by' => 'financial reports generated',
        'financial_reports.sao_approved_by' => 'financial reports approved as SAO',
        'fingerprint_verifications.performed_by' => 'fingerprint checks performed',
        'fingerprint_verifications.user_id' => 'fingerprint checks',
        'fingerprints.enrolled_by' => 'fingerprints enrolled',
        'grievances.submitted_by' => 'grievances submitted',
        'invoice_payments.recorded_by' => 'invoice payments recorded',
        'invoices.student_id' => 'invoices issued',
        'orders.approved_by' => 'orders approved',
        'orders.claim_verified_by' => 'order claims verified',
        'orders.processed_by' => 'orders processed',
        'orders.student_id' => 'orders placed',
        'organization_application_requirement_reviews.reviewed_by' => 'application requirements reviewed',
        'organization_application_review_files.uploaded_by' => 'application review files uploaded',
        'organization_applications.endorsed_by' => 'organization applications endorsed',
        'organization_applications.reviewed_by' => 'organization applications reviewed',
        'organization_compliance_submissions.reviewed_by' => 'compliance submissions reviewed',
        'organization_compliance_submissions.submitted_by' => 'compliance submissions made',
        'remittances.remitted_by' => 'remittances made',
        'remittances.verified_by' => 'remittances verified',
        'task_progress_updates.updated_by' => 'task progress updates',
        'task_recommendations.officer_id' => 'task recommendations',
        'tasks.created_by' => 'tasks created',
        'transactions.payer_id' => 'transactions paid',
        'transactions.recorded_by' => 'transactions recorded',
        'venue_bookings.requested_by' => 'venue bookings requested',
        'venue_bookings.reviewed_by' => 'venue bookings reviewed',
        'votes.voter_id' => 'votes cast',
    ];

    /**
     * Every foreign key to users as "table.column" => [table, column], read once and kept for the request so the
     * drawer and the delete do not repeat roughly eighty lookups.
     *
     * @var array<string, array{table: string, column: string}>|null
     */
    private static ?array $foreignKeysToUsers = null;

    public function __construct(private readonly PasswordResetService $passwordResetService) {}

    public function index(Request $request)
    {
        $filters = $request->validate([
            'search' => ['nullable', 'string', 'max:120'],
            'role' => ['nullable', FilterValues::rule(['nullable', Rule::in(self::ROLES)])],
            'status' => ['nullable', FilterValues::rule(['nullable', Rule::in(['active', 'inactive', 'disabled'])])],
            'organization_id' => ['nullable', FilterValues::rule(['nullable', 'integer', 'exists:organizations,id'])],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $query = User::query()->with(['organization:id,name,acronym', 'accountProfiles:id,user_school_id,role'])
            ->when($filters['role'] ?? null, fn ($query, $role) => $query->where(fn ($matches) => $matches
                ->whereIn('role', FilterValues::values($role))
                ->orWhereHas('accountProfiles', fn ($profiles) => $profiles->whereIn('role', FilterValues::values($role)))))
            ->when($filters['status'] ?? null, fn ($query, $status) => $query->whereIn('account_status', FilterValues::values($status)))
            ->when($filters['organization_id'] ?? null, fn ($query, $id) => $query->whereIn('organization_id', FilterValues::values($id)))
            ->when($filters['search'] ?? null, fn ($query, $search) => $query->where(fn ($matches) => $matches
                ->where('first_name', 'like', '%'.$search.'%')
                ->orWhere('last_name', 'like', '%'.$search.'%')
                ->orWhere('email', 'like', '%'.$search.'%')
                ->orWhere('school_id', 'like', '%'.$search.'%')));

        return response()->json($query->orderBy('last_name')->orderBy('first_name')->orderBy('school_id')
            ->paginate($filters['per_page'] ?? 20)->through(fn (User $user) => $this->summary($user)));
    }

    public function show(User $user)
    {
        $user->load(['organization:id,name,acronym', 'accountProfiles.organization:id,name,acronym']);
        $clearances = ClearanceSignature::where('student_id', $user->school_id)
            ->with('clearancePeriod:id,title,academic_year,deadline_at')
            ->orderByDesc('clearance_period_id')->get()
            ->groupBy('clearance_period_id')->take(20)->map(function ($rows) {
                $period = $rows->first()->clearancePeriod;

                return [
                    'period_id' => $period?->id,
                    'title' => $period?->title,
                    'academic_year' => $period?->academic_year,
                    'is_complete' => $rows->every(fn ($row) => $row->status === 'cleared'),
                    'signatures' => $rows->map(fn ($row) => [
                        'required_role' => $row->required_role,
                        'status' => $row->status,
                        'remarks' => $row->remarks,
                    ])->values(),
                ];
            })->values();

        return response()->json([
            'user' => [
                ...$this->summary($user),
                'profiles' => $user->accountProfiles->map(fn ($profile) => [
                    'id' => $profile->id,
                    'role' => $profile->role,
                    'account_status' => $profile->account_status,
                    'organization' => $profile->organization?->only(['id', 'name', 'acronym']),
                ])->values(),
            ],
            'clearances' => $clearances,
            // Profiles are listed above and never block, so the drawer's linked records are only the ones that do.
            'linked_records' => Arr::except($this->linkedRecordCounts($user->school_id), ['profiles']),
        ]);
    }

    public function destroy(Request $request, User $user)
    {
        $data = $request->validate(['school_id' => ['required', 'integer', Rule::in([$user->school_id])]]);
        abort_if($request->user()->school_id === $user->school_id, 422, 'You cannot delete your own account.');

        try {
            $removed = DB::transaction(function () use ($request, $user, $data) {
                $locked = User::whereKey($user->school_id)->lockForUpdate()->firstOrFail();
                if ($locked->getRawOriginal('role') === 'SUPER_ADMIN') {
                    abort_unless(User::where('role', 'SUPER_ADMIN')->where('account_status', 'active')->whereKeyNot($locked->school_id)->exists(), 409, 'The last active SAO account cannot be deleted.');
                }
                $counts = $this->linkedRecordCounts($locked->school_id);
                $linked = array_filter(Arr::except($counts, ['profiles']), fn (array $record) => $record['count'] > 0);
                if ($linked !== []) {
                    throw new HttpResponseException(response()->json([
                        'message' => 'This user has linked records such as finance entries, events, orders, attendance, clearance or election records. Deleting the account would erase them. Deactivate the account instead.',
                        'linked_records' => $linked,
                    ], 409));
                }
                $plainCounts = array_map(fn (array $record) => $record['count'], $counts);
                $organizationId = $locked->getRawOriginal('organization_id');
                $role = $locked->getRawOriginal('role');
                $this->transferInstitutionalRecords($locked->school_id, $request->user()->school_id);
                // A token is keyed by school ID only, so one left behind would sign in as whoever is later given the same ID.
                $locked->tokens()->delete();
                $locked->delete();
                AuditLog::create([
                    'organization_id' => $organizationId,
                    'user_id' => $request->user()->school_id,
                    'actor_role' => 'SUPER_ADMIN',
                    'module' => 'system_users',
                    'action' => 'user_deleted',
                    'record_type' => User::class,
                    'record_id' => $data['school_id'],
                    'description' => 'SAO deleted a user.',
                    'new_values' => ['school_id' => $data['school_id'], 'role' => $role, 'linked_records' => $plainCounts],
                    'ip_address' => $request->ip(),
                    'created_at' => now(),
                ]);

                return $plainCounts;
            });
        } catch (QueryException $exception) {
            if (! in_array((string) $exception->getCode(), ['23000', '23503', '19'], true)) {
                throw $exception;
            }
            abort(409, 'This account still has a protected linked record and could not be deleted.');
        }

        return response()->json(['message' => 'User deleted.', 'removed' => $removed]);
    }

    /** The SAO's way to reset a student or officer, since the organization Admin cannot while voting is open. */
    public function initiatePasswordReset(Request $request, User $user)
    {
        if (! in_array($user->role, ['STUDENT', 'SBO_OFFICER'], true)) {
            return response()->json(['message' => 'Only student and officer accounts are reset here.'], 422);
        }
        if ($user->account_status !== 'active') {
            return response()->json(['message' => 'Activate this account before initiating a password reset.'], 422);
        }

        $resetLink = $this->passwordResetService->issue($user);
        AuditLog::create([
            'organization_id' => $user->getRawOriginal('organization_id'),
            'user_id' => $request->user()->school_id,
            'actor_role' => 'SUPER_ADMIN',
            'module' => 'system_users',
            'action' => 'user_password_reset_initiated',
            'record_type' => User::class,
            'record_id' => $user->school_id,
            'description' => 'SAO initiated a secure password reset for a student or officer.',
            'new_values' => ['email' => $user->email],
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);

        return SystemAdministrationController::resetResponse($resetLink, 'Password reset instructions were sent to the member email address.');
    }

    private function summary(User $user): array
    {
        return [
            'school_id' => $user->school_id,
            'first_name' => $user->first_name,
            'last_name' => $user->last_name,
            'email' => $user->email,
            'role' => $user->getRawOriginal('role'),
            'profile_roles' => $user->accountProfiles->pluck('role')->unique()->values(),
            'account_status' => $user->getRawOriginal('account_status'),
            'organization' => $user->organization?->only(['id', 'name', 'acronym']),
        ];
    }

    /**
     * Rows that tie this person to the system's history. Every foreign key to users is found from the live
     * schema and counted, so a table added later blocks deletion until it is deliberately listed in
     * DISPOSABLE_REFERENCES. Keys are COUNT_KEYS names where the page already knew the column, otherwise
     * "<table>_<column>". Each entry carries the plain LABELS wording the SAO reads and its count. The profiles
     * count is shown for information and never blocks.
     *
     * @return array<string, array{label: string, count: int}>
     */
    private function linkedRecordCounts(int $schoolId): array
    {
        $counts = ['profiles' => ['label' => 'profiles', 'count' => DB::table('account_profiles')->where('user_school_id', $schoolId)->count()]];
        foreach (self::foreignKeysToUsers() as $reference => ['table' => $table, 'column' => $column]) {
            if (in_array($reference, self::DISPOSABLE_REFERENCES, true)) {
                continue;
            }
            $rows = DB::table($table)->where($column, $schoolId);
            if ($reference === 'audit_logs.user_id') {
                // Signing up writes one audit row with the new person as actor; that alone is not history.
                $rows->where(fn ($other) => $other->where('module', '!=', 'users')
                    ->orWhere('action', '!=', 'student_signed_up')
                    ->orWhereNull('record_id')
                    ->orWhere('record_id', '!=', $schoolId));
            }
            $counts[self::COUNT_KEYS[$reference] ?? $table.'_'.$column] = [
                // A foreign key added after this list was written still blocks and still reads as words, until a label is added.
                'label' => self::LABELS[$reference] ?? str_replace('_', ' ', $table).' records',
                'count' => $rows->count(),
            ];
        }

        return $counts;
    }

    /**
     * Every foreign key to users, read once per request. MariaDB answers with one query on
     * information_schema.key_column_usage for this database only; sqlite (the tests) keeps Schema introspection.
     *
     * @return array<string, array{table: string, column: string}>
     */
    private static function foreignKeysToUsers(): array
    {
        if (self::$foreignKeysToUsers !== null) {
            return self::$foreignKeysToUsers;
        }

        $schema = Schema::getCurrentSchemaName();
        $references = [];
        if (in_array(DB::getDriverName(), ['mysql', 'mariadb'], true)) {
            foreach (self::usersForeignKeyQuery(DB::connection(), $schema)->get() as $row) {
                $references[$row->table_name.'.'.$row->column_name] = ['table' => $row->table_name, 'column' => $row->column_name];
            }
        } else {
            foreach (Schema::getTables($schema) as $table) {
                foreach (Schema::getForeignKeys($table['name']) as $foreignKey) {
                    if ($foreignKey['foreign_table'] !== 'users') {
                        continue;
                    }
                    foreach ($foreignKey['columns'] as $column) {
                        $references[$table['name'].'.'.$column] = ['table' => $table['name'], 'column' => $column];
                    }
                }
            }
        }
        // Nothing found means the read itself failed (a wrong schema name), and an empty list would count nothing and let history be erased.
        throw_if($references === [], new RuntimeException('No foreign keys to users were found, so the delete guard cannot run.'));
        ksort($references);

        return self::$foreignKeysToUsers = $references;
    }

    /** The one MariaDB query for every column in this schema that references users. Aliased so the keys keep their case. */
    private static function usersForeignKeyQuery(ConnectionInterface $connection, string $schema): Builder
    {
        return $connection->table('information_schema.key_column_usage')
            ->select('table_name as table_name', 'column_name as column_name')
            ->where('referenced_table_name', 'users')
            ->where('table_schema', $schema)
            ->orderBy('table_name')
            ->orderBy('column_name');
    }

    private function transferInstitutionalRecords(int $schoolId, int $actorSchoolId): void
    {
        // These settings and periods belong to the university, not the author.
        // Reassigning them avoids removing every organization's requirements or
        // every student's clearance when an SAO account is deleted.
        foreach (['compliance_requirement_types', 'clearance_periods'] as $table) {
            DB::table($table)->where('created_by', $schoolId)->update(['created_by' => $actorSchoolId]);
        }
    }
}
