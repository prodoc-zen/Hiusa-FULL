<?php

namespace App\Http\Controllers;

use App\Models\ApprovalRequest;
use App\Models\AuditLog;
use App\Models\Election;
use App\Models\Event;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use App\Services\PasswordResetService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/** SAO-only administration and read-only university oversight. */
class SystemAdministrationController extends Controller
{
    public function __construct(private readonly PasswordResetService $passwordResetService) {}

    public function overview(Request $request)
    {
        $organizationId = $request->integer('organization_id') ?: null;
        $organizationIds = Organization::where('organization_type', '!=', 'SYSTEM_ADMINISTRATION')->pluck('id');
        if ($organizationId && ! $organizationIds->contains($organizationId)) {
            return response()->json(['message' => 'Organization is not available for SAO oversight.'], 422);
        }
        $selectedIds = $organizationId ? collect([$organizationId]) : $organizationIds;
        $userBase = User::whereIn('organization_id', $selectedIds);
        $transactionBase = Transaction::whereIn('organization_id', $selectedIds);

        return response()->json([
            'filter_organization_id' => $organizationId,
            'organizations' => [
                'total' => $organizationIds->count(),
                'active' => Organization::whereIn('id', $organizationIds)->where('is_active', true)->count(),
                'inactive' => Organization::whereIn('id', $organizationIds)->where('is_active', false)->count(),
            ],
            'people' => [
                'admins' => (clone $userBase)->where('role', 'ADMIN')->count(),
                'officers' => (clone $userBase)->where('role', 'SBO_OFFICER')->count(),
                'students' => (clone $userBase)->where('role', 'STUDENT')->count(),
            ],
            'operations' => [
                'upcoming_events' => Event::whereIn('organization_id', $selectedIds)->where('start_time', '>=', now())->count(),
                'active_elections' => Election::whereIn('organization_id', $selectedIds)->where('status', 'active')->count(),
                'pending_approvals' => ApprovalRequest::whereIn('organization_id', $selectedIds)
                    ->where('required_role', config('approvals.routes.budget'))
                    ->where(fn ($assigned) => $assigned->whereNull('assigned_approver')->orWhere('assigned_approver', $request->user()->school_id))
                    ->where('status', 'pending')
                    ->count(),
            ],
            'financials' => [
                'income' => (float) (clone $transactionBase)->where('type', 'income')->sum('amount'),
                'expenses' => (float) (clone $transactionBase)->where('type', 'expense')->sum('amount'),
                'net' => (float) (clone $transactionBase)->where('type', 'income')->sum('amount') - (float) (clone $transactionBase)->where('type', 'expense')->sum('amount'),
            ],
            'notifications' => [
                'unread' => Notification::where('organization_id', $request->user()->organization_id)
                    ->where('user_id', $request->user()->school_id)
                    ->where('is_read', false)
                    ->count(),
                'recent' => Notification::where('organization_id', $request->user()->organization_id)
                    ->where('user_id', $request->user()->school_id)
                    ->latest('created_at')
                    ->limit(5)
                    ->get(),
            ],
            'recent_activity' => AuditLog::query()
                ->leftJoin('organizations', 'audit_logs.organization_id', '=', 'organizations.id')
                ->leftJoin('users', 'audit_logs.user_id', '=', 'users.school_id')
                ->when($organizationId, fn ($query) => $query->where('audit_logs.organization_id', $organizationId))
                ->select('audit_logs.*', 'organizations.name as organization_name', 'users.first_name', 'users.last_name')
                ->latest('audit_logs.created_at')->limit(12)->get(),
        ]);
    }

    public function organizations(Request $request)
    {
        $filters = $request->validate(['search' => ['nullable', 'string', 'max:120'], 'status' => ['nullable', 'in:active,inactive,all'], 'per_page' => ['nullable', 'integer', 'min:1', 'max:100']]);
        $query = Organization::withCount('users')->with(['administrators:school_id,organization_id,first_name,last_name,email,account_status'])
            ->where('organization_type', '!=', 'SYSTEM_ADMINISTRATION');
        if (! empty($filters['search'])) {
            $query->where(fn ($q) => $q->where('name', 'like', '%'.$filters['search'].'%')->orWhere('acronym', 'like', '%'.$filters['search'].'%')->orWhere('college', 'like', '%'.$filters['search'].'%'));
        }
        if (($filters['status'] ?? 'all') !== 'all') {
            $query->where('is_active', $filters['status'] === 'active');
        }

        return response()->json($query->orderBy('name')->paginate($filters['per_page'] ?? 20));
    }

    public function storeOrganization(Request $request)
    {
        $data = $request->validate(['name' => ['required', 'string', 'max:255', 'unique:organizations,name'], 'acronym' => ['required', 'string', 'max:50', 'unique:organizations,acronym'], 'college' => ['nullable', 'string', 'max:255'], 'description' => ['nullable', 'string', 'max:3000'], 'logo_url' => ['nullable', 'url', 'max:2048'], 'is_active' => ['sometimes', 'boolean']]);
        $organization = Organization::create([...$data, 'slug' => Str::slug($data['name']), 'organization_type' => 'STUDENT_ORGANIZATION', 'is_active' => $data['is_active'] ?? true]);
        $this->audit($request, 'organization_created', $organization, $organization->toArray(), 'SAO registered a student organization.');

        return response()->json($organization, 201);
    }

    public function updateOrganization(Request $request, Organization $organization)
    {
        if ($organization->organization_type === 'SYSTEM_ADMINISTRATION') {
            return response()->json(['message' => 'The SAO system organization is not managed as an SBO.'], 403);
        }
        $data = $request->validate(['name' => ['sometimes', 'required', 'string', 'max:255', Rule::unique('organizations', 'name')->ignore($organization->id)], 'acronym' => ['sometimes', 'required', 'string', 'max:50', Rule::unique('organizations', 'acronym')->ignore($organization->id)], 'college' => ['nullable', 'string', 'max:255'], 'description' => ['nullable', 'string', 'max:3000'], 'logo_url' => ['nullable', 'url', 'max:2048'], 'is_active' => ['sometimes', 'boolean']]);
        $old = $organization->toArray();
        if (isset($data['name'])) {
            $data['slug'] = Str::slug($data['name']);
        }
        $organization->update($data);
        $fresh = $organization->fresh();
        $action = match (true) {
            ($old['is_active'] ?? null) !== $fresh->is_active && $fresh->is_active => 'organization_activated',
            ($old['is_active'] ?? null) !== $fresh->is_active => 'organization_deactivated',
            default => 'organization_updated',
        };
        $this->audit($request, $action, $fresh, ['before' => $old, 'after' => $fresh->toArray()], 'SAO updated a student organization.');

        return response()->json($fresh);
    }

    public function admins(Request $request)
    {
        $filters = $request->validate(['organization_id' => ['nullable', 'integer', 'exists:organizations,id'], 'search' => ['nullable', 'string', 'max:120'], 'status' => ['nullable', 'in:active,inactive,disabled,all'], 'per_page' => ['nullable', 'integer', 'min:1', 'max:100']]);
        $query = User::with('organization:id,name,acronym,college')
            ->where('role', 'ADMIN')
            ->whereHas('organization', fn ($organization) => $organization->where('organization_type', '!=', 'SYSTEM_ADMINISTRATION'));
        if (! empty($filters['organization_id'])) {
            $query->where('organization_id', $filters['organization_id']);
        }
        if (($filters['status'] ?? 'all') !== 'all') {
            $query->where('account_status', $filters['status']);
        }
        if (! empty($filters['search'])) {
            $query->where(fn ($q) => $q->where('first_name', 'like', '%'.$filters['search'].'%')->orWhere('last_name', 'like', '%'.$filters['search'].'%')->orWhere('email', 'like', '%'.$filters['search'].'%')->orWhere('school_id', 'like', '%'.$filters['search'].'%'));
        }

        return response()->json($query->orderBy('last_name')->paginate($filters['per_page'] ?? 20));
    }

    public function storeAdmin(Request $request)
    {
        $this->normalizeAdminInput($request);
        $data = $request->validate(['organization_id' => ['required', 'integer', Rule::exists('organizations', 'id')->where('is_active', true)], 'school_id' => ['required', 'integer', 'min:1', 'max:99999999', 'unique:users,school_id'], 'first_name' => ['required', 'string', 'max:60'], 'last_name' => ['required', 'string', 'max:60'], 'email' => ['required', 'email', 'max:255', 'unique:users,email'], 'contact_number' => ['nullable', 'string', 'max:30', 'regex:/^[0-9+\\-\\s()]{7,30}$/'], 'position_title' => ['nullable', 'string', 'max:100'], 'password' => ['required', 'string', 'min:8', 'confirmed']]);
        $organization = Organization::whereKey($data['organization_id'])->where('organization_type', '!=', 'SYSTEM_ADMINISTRATION')->first();
        if (! $organization) {
            return response()->json(['message' => 'Choose an active student organization.'], 422);
        }

        $admin = DB::transaction(function () use ($data, $organization, $request) {
            $admin = User::create([
                'organization_id' => $organization->id,
                'school_id' => $data['school_id'],
                'first_name' => $data['first_name'],
                'last_name' => $data['last_name'],
                'email' => $data['email'],
                'contact_number' => $data['contact_number'] ?? null,
                'position_title' => $data['position_title'] ?? null,
                'password_hash' => $data['password'],
                'role' => 'ADMIN',
                'account_status' => 'active',
                'is_member' => true,
                'department' => $organization->college,
            ]);
            Notification::create(['organization_id' => $organization->id, 'user_id' => $admin->school_id, 'notification_type' => 'general', 'title' => 'Administrator account created', 'message' => 'Your HIUSA administrator account has been created by the Student Affairs Office. Sign in using the credentials provided by SAO and change your password from your profile if needed.', 'is_read' => false, 'sent_at' => now()]);
            $this->audit($request, 'administrator_created', $admin, ['administrator_id' => $admin->school_id, 'organization_id' => $organization->id], 'SAO created an organization Admin account.');

            return $admin;
        });

        return response()->json($admin->load('organization:id,name,acronym'), 201);
    }

    public function updateAdmin(Request $request, User $user)
    {
        if ($user->role !== 'ADMIN' || ! Organization::whereKey($user->organization_id)->where('organization_type', '!=', 'SYSTEM_ADMINISTRATION')->exists()) {
            return response()->json(['message' => 'Only administrator accounts are managed here.'], 422);
        }
        if ($request->hasAny(['password', 'password_confirmation', 'password_hash'])) {
            return response()->json(['message' => 'SAO cannot set administrator passwords. Initiate a secure password reset instead.'], 422);
        }

        $this->normalizeAdminInput($request);
        $data = $request->validate(['organization_id' => ['sometimes', 'integer', Rule::exists('organizations', 'id')->where('is_active', true)], 'first_name' => ['sometimes', 'required', 'string', 'max:60'], 'last_name' => ['sometimes', 'required', 'string', 'max:60'], 'email' => ['sometimes', 'required', 'email', 'max:255', Rule::unique('users', 'email')->ignore($user->school_id, 'school_id')], 'contact_number' => ['nullable', 'string', 'max:30', 'regex:/^[0-9+\\-\\s()]{7,30}$/'], 'position_title' => ['nullable', 'string', 'max:100'], 'account_status' => ['sometimes', 'in:active,inactive,disabled']]);
        if (isset($data['organization_id'])) {
            $organization = Organization::whereKey($data['organization_id'])->where('organization_type', '!=', 'SYSTEM_ADMINISTRATION')->first();
            if (! $organization) {
                return response()->json(['message' => 'Choose an active student organization.'], 422);
            }
            $data['department'] = $organization->college;
        }

        $leavesCurrentOrganization = isset($data['organization_id']) && (int) $data['organization_id'] !== (int) $user->organization_id;
        $deactivatesAccount = isset($data['account_status']) && $data['account_status'] !== 'active';
        $currentOrganizationIsActive = Organization::whereKey($user->organization_id)->where('is_active', true)->exists();
        if ($user->account_status === 'active' && $currentOrganizationIsActive && ($leavesCurrentOrganization || $deactivatesAccount)) {
            $hasAnotherActiveAdmin = User::where('organization_id', $user->organization_id)
                ->where('role', 'ADMIN')
                ->where('account_status', 'active')
                ->whereKeyNot($user->school_id)
                ->exists();
            if (! $hasAnotherActiveAdmin) {
                return response()->json(['message' => 'Add another active administrator before transferring or deactivating this organization\'s last active administrator.'], 422);
            }
        }

        $old = $user->toArray();
        DB::transaction(function () use ($data, $old, $request, $user) {
            $user->update($data);
            if (($data['account_status'] ?? $user->account_status) !== 'active') {
                $user->tokens()->delete();
            }
            $fresh = $user->fresh();
            $action = match (true) {
                ($old['account_status'] ?? null) !== $fresh->account_status && $fresh->account_status === 'active' => 'administrator_activated',
                ($old['account_status'] ?? null) !== $fresh->account_status => 'administrator_deactivated',
                default => 'administrator_updated',
            };
            $this->audit($request, $action, $fresh, ['before' => $old, 'after' => $fresh->toArray()], 'SAO updated an organization Admin account.');
        });

        return response()->json($user->fresh()->load('organization:id,name,acronym'));
    }

    public function initiateAdminPasswordReset(Request $request, User $user)
    {
        if ($user->role !== 'ADMIN' || ! Organization::whereKey($user->organization_id)->where('organization_type', '!=', 'SYSTEM_ADMINISTRATION')->exists()) {
            return response()->json(['message' => 'Only administrator accounts are managed here.'], 422);
        }
        if ($user->account_status !== 'active') {
            return response()->json(['message' => 'Activate this administrator before initiating a password reset.'], 422);
        }

        $this->passwordResetService->issue($user);
        $this->audit($request, 'administrator_password_reset_initiated', $user, ['email' => $user->email], 'SAO initiated a secure password reset for an organization Admin.');

        return response()->json(['message' => 'Password reset instructions were sent to the administrator email address.']);
    }

    private function normalizeAdminInput(Request $request): void
    {
        $normalized = [];
        foreach (['first_name', 'last_name', 'email', 'contact_number', 'position_title'] as $field) {
            if ($request->exists($field) && is_string($request->input($field))) {
                $value = trim($request->string($field)->toString());
                $normalized[$field] = $value === '' ? null : ($field === 'email' ? strtolower($value) : $value);
            }
        }
        $request->merge($normalized);
    }

    private function audit(Request $request, string $action, mixed $record, array $values, string $description = ''): void
    {
        $organizationId = $record instanceof Organization ? $record->id : ($record->organization_id ?? $request->user()->organization_id);
        AuditLog::create(['organization_id' => $organizationId, 'user_id' => $request->user()->school_id, 'actor_role' => $request->user()->role, 'module' => 'system_administration', 'action' => $action, 'description' => $description, 'record_type' => get_class($record), 'record_id' => $record->getKey(), 'new_values' => $values, 'ip_address' => $request->ip(), 'created_at' => now()]);
    }
}
