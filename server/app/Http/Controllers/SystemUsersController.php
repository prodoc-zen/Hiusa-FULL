<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\ClearanceSignature;
use App\Models\User;
use App\Services\PasswordResetService;
use App\Support\FilterValues;
use Illuminate\Database\QueryException;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\Rule;

class SystemUsersController extends Controller
{
    private const ROLES = ['SUPER_ADMIN', 'ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'];

    /**
     * Every foreign key to users is read from the schema and BLOCKS deleting the person unless it is listed here
     * ("table.column"). Listed columns hold rows that are disposable (they go with the user) or that are
     * reassigned or cleared (set null, or moved to the deleting SAO by transferInstitutionalRecords). A new
     * table that points at users is therefore protected by default; add it here only when its rows do not
     * count as the person's history. A test fails if an entry here matches no real foreign key.
     */
    private const DISPOSABLE_REFERENCES = [
        'notifications.user_id',
        'announcement_views.user_id',
        'announcement_reactions.user_id',
        'announcement_recipients.user_id',
        'fingerprints.user_id',
        'fingerprint_verifications.user_id',
        'fingerprint_verifications.performed_by',
        'account_profiles.user_school_id',
        'organization_applicant_grants.user_school_id',
        'organization_applicant_grants.granted_by',
        'tasks.assigned_to',
        'announcements.created_by',
        'task_progress_updates.updated_by',
        'ai_outputs.requested_by',
        'ai_outputs.decided_by',
        'task_recommendations.officer_id',
        'evaluation_windows.created_by',
        'academic_years.created_by',
        'academic_semesters.created_by',
        'financial_report_deadlines.set_by',
        'organization_application_review_files.uploaded_by',
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
            'linked_records' => $this->linkedRecordCounts($user->school_id),
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
                $linked = array_filter(Arr::except($counts, ['profiles']));
                if ($linked !== []) {
                    throw new HttpResponseException(response()->json([
                        'message' => 'This user has linked records such as finance entries, events, orders, attendance, clearance or election records. Deleting the account would erase them. Deactivate the account instead.',
                        'linked_records' => $linked,
                    ], 409));
                }
                $organizationId = $locked->getRawOriginal('organization_id');
                $role = $locked->getRawOriginal('role');
                $this->transferInstitutionalRecords($locked->school_id, $request->user()->school_id);
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
                    'new_values' => ['school_id' => $data['school_id'], 'role' => $role, 'linked_records' => $counts],
                    'ip_address' => $request->ip(),
                    'created_at' => now(),
                ]);

                return $counts;
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
     * "<table>_<column>". The profiles count is shown for information and never blocks.
     */
    private function linkedRecordCounts(int $schoolId): array
    {
        $counts = ['profiles' => DB::table('account_profiles')->where('user_school_id', $schoolId)->count()];
        foreach (Schema::getTables() as $table) {
            foreach (Schema::getForeignKeys($table['name']) as $foreignKey) {
                if ($foreignKey['foreign_table'] !== 'users') {
                    continue;
                }
                foreach ($foreignKey['columns'] as $column) {
                    $reference = $table['name'].'.'.$column;
                    if (in_array($reference, self::DISPOSABLE_REFERENCES, true)) {
                        continue;
                    }
                    $rows = DB::table($table['name'])->where($column, $schoolId);
                    if ($reference === 'audit_logs.user_id') {
                        // Signing up writes one audit row with the new person as actor; that alone is not history.
                        $rows->where(fn ($other) => $other->where('module', '!=', 'users')
                            ->orWhere('action', '!=', 'student_signed_up')
                            ->orWhereNull('record_id')
                            ->orWhere('record_id', '!=', $schoolId));
                    }
                    $counts[self::COUNT_KEYS[$reference] ?? $table['name'].'_'.$column] = $rows->count();
                }
            }
        }

        return $counts;
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
