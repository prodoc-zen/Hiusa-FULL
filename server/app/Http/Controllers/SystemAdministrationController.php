<?php

namespace App\Http\Controllers;

use App\Models\ApprovalRequest;
use App\Models\AuditLog;
use App\Models\Election;
use App\Models\Event;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\SboPosition;
use App\Models\User;
use App\Services\AccountProfileDeletionService;
use App\Services\PasswordResetService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
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
                    ->where('required_role', 'SUPER_ADMIN')
                    ->where('entity_type', 'financial_report')
                    ->where(fn ($assigned) => $assigned->whereNull('assigned_approver')->orWhere('assigned_approver', $request->user()->school_id))
                    ->where('status', 'pending')
                    ->count(),
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
        ]);
    }

    public function organizations(Request $request)
    {
        $filters = $request->validate(['search' => ['nullable', 'string', 'max:120'], 'status' => ['nullable', 'in:active,inactive,all'], 'per_page' => ['nullable', 'integer', 'min:1', 'max:100']]);
        $query = Organization::withCount('accountProfiles as users_count')->with(['administrators:school_id,organization_id,first_name,last_name,email,account_status', 'parentOrganization:id,name,acronym'])
            ->withCount(['accountProfiles as administrators_count' => fn ($query) => $query->where('role', 'ADMIN')])
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
        $data = $request->validate(['name' => ['required', 'string', 'max:255', 'unique:organizations,name'], 'acronym' => ['required', 'string', 'max:50', 'unique:organizations,acronym'], 'college' => ['nullable', 'string', 'max:255', Rule::requiredIf($request->filled('parent_organization_id'))], 'parent_organization_id' => ['nullable', 'integer', Rule::exists('organizations', 'id')->where('organization_type', 'STUDENT_ORGANIZATION')->whereNull('parent_organization_id')->where('is_active', true)], 'description' => ['nullable', 'string', 'max:3000'], 'logo_url' => ['nullable', 'url', 'max:2048'], 'color' => ['nullable', 'regex:/^#[0-9a-fA-F]{6}$/'], 'is_active' => ['sometimes', 'boolean']]);
        $organization = Organization::create([...$data, 'slug' => Str::slug($data['name']), 'organization_type' => 'STUDENT_ORGANIZATION', 'is_active' => $data['is_active'] ?? true]);
        $this->audit($request, 'organization_created', $organization, $organization->toArray(), 'SAO registered a student organization.');

        return response()->json($organization, 201);
    }

    public function updateOrganization(Request $request, Organization $organization)
    {
        if ($organization->organization_type === 'SYSTEM_ADMINISTRATION') {
            return response()->json(['message' => 'The SAO system organization is not managed as an SBO.'], 403);
        }
        $data = $request->validate(['name' => ['sometimes', 'required', 'string', 'max:255', Rule::unique('organizations', 'name')->ignore($organization->id)], 'acronym' => ['sometimes', 'required', 'string', 'max:50', Rule::unique('organizations', 'acronym')->ignore($organization->id)], 'college' => ['sometimes', 'required', 'string', 'max:255'], 'parent_organization_id' => ['nullable', 'integer', Rule::exists('organizations', 'id')->where('organization_type', 'STUDENT_ORGANIZATION')->whereNull('parent_organization_id')->where('is_active', true)->where('id', '!=', $organization->id)], 'description' => ['nullable', 'string', 'max:3000'], 'logo_url' => ['nullable', 'url', 'max:2048'], 'color' => ['nullable', 'regex:/^#[0-9a-fA-F]{6}$/'], 'is_active' => ['sometimes', 'boolean']]);
        if ($organization->suborganizations()->exists() && array_key_exists('parent_organization_id', $data) && $data['parent_organization_id']) {
            return response()->json(['message' => 'An organization with suborganizations cannot become a suborganization.'], 422);
        }
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

    public function uploadOrganizationLogo(Request $request, Organization $organization)
    {
        abort_if($organization->organization_type === 'SYSTEM_ADMINISTRATION', 403);
        $request->validate(['logo' => ['required', 'image', 'mimes:jpeg,png,webp', 'max:2048']]);
        $path = $request->file('logo')->store('organization-logos', 'public');
        $oldUrl = $organization->logo_url;
        try {
            $organization->update(['logo_url' => Storage::disk('public')->url($path)]);
            $this->audit($request, 'organization_logo_updated', $organization, ['logo_url' => $organization->logo_url]);
        } catch (\Throwable $error) {
            Storage::disk('public')->delete($path);
            throw $error;
        }
        $oldPath = is_string($oldUrl) ? parse_url($oldUrl, PHP_URL_PATH) : null;
        if (is_string($oldPath) && str_starts_with($oldPath, '/storage/')) {
            Storage::disk('public')->delete(substr($oldPath, strlen('/storage/')));
        }

        return response()->json($organization->fresh());
    }

    public function admins(Request $request)
    {
        $filters = $request->validate(['organization_id' => ['nullable', 'integer', 'exists:organizations,id'], 'search' => ['nullable', 'string', 'max:120'], 'status' => ['nullable', 'in:active,inactive,disabled,all'], 'per_page' => ['nullable', 'integer', 'min:1', 'max:100']]);
        $query = User::with('organization:id,name,acronym,college,parent_organization_id')
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
        abort(403, 'Organization administrators are appointed by their own organization. The first administrator is created through an endorsed registration application.');
    }

    public function updateAdmin(Request $request, User $user)
    {
        if ($request->filled('organization_id') && $request->integer('organization_id') !== (int) $user->organization_id) {
            abort(403, 'Administrator appointments in another organization must be handled by that organization.');
        }
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
            $this->ensureAdminPosition((int) ($data['organization_id'] ?? $user->organization_id), $data['position_title'] ?? $user->position_title);
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

    public function destroyAdmin(Request $request, User $user)
    {
        if ($user->role !== 'ADMIN' || $user->school_id === $request->user()->school_id) {
            return response()->json(['message' => 'Only another organization Admin can be removed here.'], 403);
        }

        $organizationId = $user->getRawOriginal('organization_id');
        $profile = $user->accountProfiles()->where('organization_id', $organizationId)->firstOrFail();
        $result = app(AccountProfileDeletionService::class)->remove($request->user(), $profile);

        $this->audit($request, 'administrator_deleted', $user, [
            'administrator_id' => $user->school_id,
            'organization_id' => $organizationId,
        ], 'SAO removed an organization administrator account.');

        return response()->json(['message' => 'Administrator profile removed.', ...$result]);
    }

    /** Active members whose primary organization is this one, to pick an administrator successor from. */
    public function organizationMembers(Request $request, Organization $organization)
    {
        $filters = $request->validate(['search' => ['nullable', 'string', 'max:120']]);
        if ($organization->organization_type === 'SYSTEM_ADMINISTRATION') {
            return response()->json(['message' => 'Choose a student organization.'], 422);
        }

        $members = User::where('organization_id', $organization->id)
            ->where('account_status', 'active')
            ->whereIn('role', self::SUCCESSOR_ROLES)
            ->when(! empty($filters['search']), fn ($query) => $query->where(fn ($q) => $q
                ->where('first_name', 'like', '%'.$filters['search'].'%')
                ->orWhere('last_name', 'like', '%'.$filters['search'].'%')
                ->orWhere('email', 'like', '%'.$filters['search'].'%')
                ->orWhere('school_id', 'like', '%'.$filters['search'].'%')))
            ->orderBy('last_name')
            ->orderBy('first_name')
            ->limit(20)
            ->get(['school_id', 'first_name', 'last_name', 'email', 'role', 'position_title']);

        return response()->json($members);
    }

    public function handoverAdmin(Request $request, User $user)
    {
        abort(403, 'Administrator appointments must be handled by the organization.');
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

    private function ensureAdminPosition(int $organizationId, ?string $title): void
    {
        if (! $title) {
            return;
        }

        SboPosition::firstOrCreate(
            ['organization_id' => $organizationId, 'role' => 'ADMIN', 'title' => $title],
            ['is_active' => true]
        );
    }

    private function audit(Request $request, string $action, mixed $record, array $values, string $description = ''): void
    {
        $organizationId = $record instanceof Organization ? $record->id : ($record->organization_id ?? $request->user()->organization_id);
        AuditLog::create(['organization_id' => $organizationId, 'user_id' => $request->user()->school_id, 'actor_role' => $request->user()->role, 'module' => 'system_administration', 'action' => $action, 'description' => $description, 'record_type' => get_class($record), 'record_id' => $record->getKey(), 'new_values' => $values, 'ip_address' => $request->ip(), 'created_at' => now()]);
    }
}
