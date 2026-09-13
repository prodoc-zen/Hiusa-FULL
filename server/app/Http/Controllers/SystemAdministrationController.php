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
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/** SAO-only administration and read-only university oversight. */
class SystemAdministrationController extends Controller
{
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
                'pending_approvals' => ApprovalRequest::whereIn('organization_id', $selectedIds)->where('status', 'pending')->count(),
            ],
            'financials' => [
                'income' => (float) (clone $transactionBase)->where('type', 'income')->sum('amount'),
                'expenses' => (float) (clone $transactionBase)->where('type', 'expense')->sum('amount'),
                'net' => (float) (clone $transactionBase)->where('type', 'income')->sum('amount') - (float) (clone $transactionBase)->where('type', 'expense')->sum('amount'),
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
        if (($filters['status'] ?? 'all') !== 'all') $query->where('is_active', $filters['status'] === 'active');
        return response()->json($query->orderBy('name')->paginate($filters['per_page'] ?? 20));
    }

    public function storeOrganization(Request $request)
    {
        $data = $request->validate(['name' => ['required', 'string', 'max:255', 'unique:organizations,name'], 'acronym' => ['required', 'string', 'max:50', 'unique:organizations,acronym'], 'college' => ['nullable', 'string', 'max:255'], 'description' => ['nullable', 'string', 'max:3000'], 'logo_url' => ['nullable', 'url', 'max:2048'], 'is_active' => ['sometimes', 'boolean']]);
        $organization = Organization::create([...$data, 'slug' => Str::slug($data['name']), 'organization_type' => 'STUDENT_ORGANIZATION', 'is_active' => $data['is_active'] ?? true]);
        $this->audit($request, 'organization_created', $organization, $organization->toArray());
        return response()->json($organization, 201);
    }

    public function updateOrganization(Request $request, Organization $organization)
    {
        if ($organization->organization_type === 'SYSTEM_ADMINISTRATION') return response()->json(['message' => 'The SAO system organization is not managed as an SBO.'], 403);
        $data = $request->validate(['name' => ['sometimes', 'required', 'string', 'max:255', Rule::unique('organizations', 'name')->ignore($organization->id)], 'acronym' => ['sometimes', 'required', 'string', 'max:50', Rule::unique('organizations', 'acronym')->ignore($organization->id)], 'college' => ['nullable', 'string', 'max:255'], 'description' => ['nullable', 'string', 'max:3000'], 'logo_url' => ['nullable', 'url', 'max:2048'], 'is_active' => ['sometimes', 'boolean']]);
        $old = $organization->toArray();
        if (isset($data['name'])) $data['slug'] = Str::slug($data['name']);
        $organization->update($data);
        $this->audit($request, 'organization_updated', $organization, ['before' => $old, 'after' => $organization->fresh()->toArray()]);
        return response()->json($organization->fresh());
    }

    public function admins(Request $request)
    {
        $filters = $request->validate(['organization_id' => ['nullable', 'integer', 'exists:organizations,id'], 'search' => ['nullable', 'string', 'max:120'], 'status' => ['nullable', 'in:active,inactive,disabled,all'], 'per_page' => ['nullable', 'integer', 'min:1', 'max:100']]);
        $query = User::with('organization:id,name,acronym,college')->where('role', 'ADMIN');
        if (! empty($filters['organization_id'])) $query->where('organization_id', $filters['organization_id']);
        if (($filters['status'] ?? 'all') !== 'all') $query->where('account_status', $filters['status']);
        if (! empty($filters['search'])) $query->where(fn ($q) => $q->where('first_name', 'like', '%'.$filters['search'].'%')->orWhere('last_name', 'like', '%'.$filters['search'].'%')->orWhere('email', 'like', '%'.$filters['search'].'%')->orWhere('school_id', 'like', '%'.$filters['search'].'%'));
        return response()->json($query->orderBy('last_name')->paginate($filters['per_page'] ?? 20));
    }

    public function storeAdmin(Request $request)
    {
        $data = $request->validate(['organization_id' => ['required', 'integer', Rule::exists('organizations', 'id')->where('is_active', true)], 'school_id' => ['required', 'integer', 'min:1', 'max:99999999', 'unique:users,school_id'], 'first_name' => ['required', 'string', 'max:60'], 'last_name' => ['required', 'string', 'max:60'], 'email' => ['required', 'email', 'max:255', 'unique:users,email'], 'password' => ['required', 'string', 'min:8', 'confirmed'], 'contact_number' => ['nullable', 'string', 'max:30'], 'position_title' => ['nullable', 'string', 'max:100']]);
        $organization = Organization::whereKey($data['organization_id'])->where('organization_type', '!=', 'SYSTEM_ADMINISTRATION')->first();
        if (! $organization) return response()->json(['message' => 'Choose an active student organization.'], 422);
        $admin = User::create([...$data, 'password_hash' => Hash::make($data['password']), 'role' => 'ADMIN', 'account_status' => 'active', 'is_member' => true, 'department' => $organization->college]);
        unset($admin->password);
        Notification::create(['organization_id' => $organization->id, 'user_id' => $admin->school_id, 'notification_type' => 'general', 'title' => 'Administrator account created', 'message' => 'Your HIUSA administrator account has been created by the Student Affairs Office.', 'is_read' => false, 'sent_at' => now()]);
        $this->audit($request, 'administrator_created', $admin, ['administrator_id' => $admin->school_id, 'organization_id' => $organization->id]);
        return response()->json($admin->load('organization:id,name,acronym'), 201);
    }

    public function updateAdmin(Request $request, User $user)
    {
        if ($user->role !== 'ADMIN') return response()->json(['message' => 'Only administrator accounts are managed here.'], 422);
        $data = $request->validate(['organization_id' => ['sometimes', 'integer', 'exists:organizations,id'], 'first_name' => ['sometimes', 'required', 'string', 'max:60'], 'last_name' => ['sometimes', 'required', 'string', 'max:60'], 'email' => ['sometimes', 'required', 'email', 'max:255', Rule::unique('users', 'email')->ignore($user->school_id, 'school_id')], 'contact_number' => ['nullable', 'string', 'max:30'], 'position_title' => ['nullable', 'string', 'max:100'], 'account_status' => ['sometimes', 'in:active,inactive,disabled']]);
        if (isset($data['organization_id'])) {
            $organization = Organization::whereKey($data['organization_id'])->where('organization_type', '!=', 'SYSTEM_ADMINISTRATION')->first();
            if (! $organization) return response()->json(['message' => 'Choose a student organization.'], 422);
            $data['department'] = $organization->college;
        }
        $old = $user->toArray(); $user->update($data); if (($data['account_status'] ?? 'active') !== 'active') $user->tokens()->delete();
        $this->audit($request, 'administrator_updated', $user, ['before' => $old, 'after' => $user->fresh()->toArray()]);
        return response()->json($user->fresh()->load('organization:id,name,acronym'));
    }

    private function audit(Request $request, string $action, mixed $record, array $values): void
    {
        AuditLog::create(['organization_id' => $request->user()->organization_id, 'user_id' => $request->user()->school_id, 'module' => 'system_administration', 'action' => $action, 'record_type' => get_class($record), 'record_id' => $record->getKey(), 'new_values' => $values, 'ip_address' => $request->ip(), 'created_at' => now()]);
    }
}
