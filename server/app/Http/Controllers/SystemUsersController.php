<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\ClearanceSignature;
use App\Models\User;
use App\Support\FilterValues;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class SystemUsersController extends Controller
{
    private const ROLES = ['SUPER_ADMIN', 'ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'];

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
                $organizationId = $locked->getRawOriginal('organization_id');
                $role = $locked->getRawOriginal('role');
                $this->transferInstitutionalRecords($locked->school_id, $request->user()->school_id);
                $this->deleteProtectedDependents($locked->school_id);
                $locked->delete();
                AuditLog::create([
                    'organization_id' => $organizationId,
                    'user_id' => $request->user()->school_id,
                    'actor_role' => 'SUPER_ADMIN',
                    'module' => 'system_users',
                    'action' => 'user_deleted',
                    'record_type' => User::class,
                    'record_id' => $data['school_id'],
                    'description' => 'SAO deleted a user and dependent records.',
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

        return response()->json(['message' => 'User and dependent records deleted.', 'removed' => $removed]);
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

    private function linkedRecordCounts(int $schoolId): array
    {
        return [
            'profiles' => DB::table('account_profiles')->where('user_school_id', $schoolId)->count(),
            'clearance_signatures' => DB::table('clearance_signatures')->where('student_id', $schoolId)->count(),
            'transactions' => DB::table('transactions')->where('recorded_by', $schoolId)->count(),
            'collections' => DB::table('collections')->where('collected_by', $schoolId)->count(),
            'cash_advances' => DB::table('cash_advances')->where('borrower_id', $schoolId)->count(),
            'events' => DB::table('events')->where('created_by', $schoolId)->count(),
            'orders' => DB::table('orders')->where('student_id', $schoolId)->count(),
            'invoices' => DB::table('invoices')->where('student_id', $schoolId)->count(),
            'event_requirement_files' => DB::table('event_requirement_files')->where('uploaded_by', $schoolId)->count(),
        ];
    }

    private function deleteProtectedDependents(int $schoolId): void
    {
        // These user references normally restrict deletion. Keep that protection for
        // organization and profile removal, and explicitly cascade only for SAO deletion.
        foreach ([
            ['invoice_payments', 'recorded_by'],
            ['invoices', 'student_id'],
            ['cash_advance_repayments', 'recorded_by'],
            ['cash_advances', 'borrower_id'],
            ['remittances', 'remitted_by'],
            ['collections', 'collected_by'],
            ['transactions', 'recorded_by'],
            ['event_requirement_files', 'uploaded_by'],
        ] as [$table, $column]) {
            DB::table($table)->where($column, $schoolId)->delete();
        }
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
