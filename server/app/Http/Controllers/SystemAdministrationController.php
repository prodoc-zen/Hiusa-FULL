<?php

namespace App\Http\Controllers;

use App\Models\AccountProfile;
use App\Models\ApprovalRequest;
use App\Models\AuditLog;
use App\Models\College;
use App\Models\Election;
use App\Models\Event;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\User;
use App\Services\PasswordResetService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/** SAO-only administration and read-only university oversight. */
class SystemAdministrationController extends Controller
{
    private const ACTIVE_HEAD_EXISTS = 'This college already has an active Department Head. Deactivate the current one first.';

    public function __construct(private readonly PasswordResetService $passwordResetService) {}

    public function overview(Request $request)
    {
        $organizationId = $request->integer('organization_id') ?: null;
        $organizationIds = Organization::student()->pluck('id');
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
                'admins' => AccountProfile::whereIn('organization_id', $selectedIds)->activeAdministrators()->count(),
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
        $filters = $request->validate(['search' => ['nullable', 'string', 'max:120'], 'status' => ['nullable', 'in:active,inactive,all'], 'lifecycle_status' => ['nullable', 'in:pending,returned,active,archived,all'], 'per_page' => ['nullable', 'integer', 'min:1', 'max:100']]);
        $query = Organization::withCount('accountProfiles as users_count')->with(['catalogCollege', 'administrators:users.school_id,account_profiles.organization_id,users.first_name,users.last_name,users.email,account_profiles.account_status', 'parentOrganization:id,name,acronym'])
            ->withCount(['accountProfiles as administrators_count' => fn ($query) => $query->activeAdministrators()])
            ->student();
        if (! empty($filters['search'])) {
            $query->where(fn ($q) => $q->where('name', 'like', '%'.$filters['search'].'%')->orWhere('acronym', 'like', '%'.$filters['search'].'%')->orWhere('college', 'like', '%'.$filters['search'].'%'));
        }
        if (($filters['status'] ?? 'all') !== 'all') {
            $query->where('is_active', $filters['status'] === 'active');
        }

        if (($filters['lifecycle_status'] ?? 'all') !== 'all') {
            $query->where('lifecycle_status', $filters['lifecycle_status']);
        }

        return response()->json($query->orderBy('name')->paginate($filters['per_page'] ?? 20)
            ->through(fn ($organization) => $organization->setAttribute('college_is_active', $organization->collegeAllowsAccess())->unsetRelation('catalogCollege')));
    }

    public function storeUnifiedOrganization(Request $request)
    {
        foreach (['name', 'acronym'] as $field) {
            if (is_string($request->input($field))) {
                $request->merge([$field => trim($request->input($field))]);
            }
        }
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255', Rule::unique('organizations', 'name')],
            'acronym' => ['required', 'string', 'max:50', Rule::unique('organizations', 'acronym')],
            'description' => ['nullable', 'string', 'max:3000'],
            'college_id' => ['prohibited'], 'college' => ['prohibited'], 'parent_organization_id' => ['prohibited'],
            'organization_type' => ['prohibited'], 'is_active' => ['prohibited'], 'lifecycle_status' => ['prohibited'],
        ]);
        $organization = DB::transaction(function () use ($request, $data) {
            $organization = Organization::create([
                ...$data, 'slug' => Str::slug($data['name']).'-'.Str::lower(Str::random(6)),
                'college' => null, 'college_id' => null, 'parent_organization_id' => null,
                'is_university_wide' => true, 'organization_type' => 'STUDENT_ORGANIZATION',
                'lifecycle_status' => 'active', 'is_active' => true,
                'reviewed_by' => $request->user()->school_id, 'reviewed_at' => now(),
            ]);
            $this->audit($request, 'unified_organization_created', $organization, $organization->only(['id', 'name', 'acronym', 'is_university_wide']), 'SAO created an organization open to students from every college.');

            return $organization;
        });

        return response()->json($organization, 201);
    }

    public function updateOrganization(Request $request, Organization $organization)
    {
        if ($organization->organization_type === 'SYSTEM_ADMINISTRATION') {
            return response()->json(['message' => 'The SAO system organization is not managed as an SBO.'], 403);
        }
        if ($organization->organization_type === 'COLLEGE') {
            return response()->json(['message' => 'College home organizations are managed through their college.'], 403);
        }
        if (! $organization->isWritable()) {
            return response()->json(['message' => $organization->isArchived() ? 'Archived organizations cannot be edited.' : 'Only active organizations can be edited.'], 409);
        }
        $parentUnchanged = $organization->parent_organization_id !== null && (int) $request->input('parent_organization_id') === $organization->parent_organization_id;
        $parentRule = $parentUnchanged
            ? ['nullable', 'integer']
            : ['nullable', 'integer', Rule::exists('organizations', 'id')->where('organization_type', 'STUDENT_ORGANIZATION')->whereNull('parent_organization_id')->where('is_active', true)->where('id', '!=', $organization->id)];
        $data = $request->validate(['name' => ['sometimes', 'required', 'string', 'max:255', Rule::unique('organizations', 'name')->ignore($organization->id)], 'acronym' => ['sometimes', 'required', 'string', 'max:50', Rule::unique('organizations', 'acronym')->ignore($organization->id)], 'parent_organization_id' => $parentRule, 'description' => ['nullable', 'string', 'max:3000'], 'logo_url' => ['nullable', 'url', 'max:2048'], 'color' => ['nullable', 'regex:/^#[0-9a-fA-F]{6}$/']]);
        if (! $parentUnchanged && $organization->suborganizations()->exists() && array_key_exists('parent_organization_id', $data) && $data['parent_organization_id']) {
            return response()->json(['message' => 'An organization with suborganizations cannot become a suborganization.'], 422);
        }
        if (! $parentUnchanged && ! empty($data['parent_organization_id'])) {
            $parent = Organization::findOrFail($data['parent_organization_id']);
            if ((bool) $parent->is_university_wide !== (bool) $organization->is_university_wide || $parent->college_id !== $organization->college_id || $parent->college !== $organization->college) {
                throw ValidationException::withMessages(['parent_organization_id' => ['Choose a parent with the same college and university-wide scope.']]);
            }
        }
        $old = $organization->toArray();
        if (isset($data['name'])) {
            $data['slug'] = Str::slug($data['name']);
        }
        $organization->update($data);
        $fresh = $organization->fresh();
        $this->audit($request, 'organization_updated', $fresh, ['before' => $old, 'after' => $fresh->toArray()], 'SAO updated a student organization.');

        return response()->json($fresh);
    }

    public function uploadOrganizationLogo(Request $request, Organization $organization)
    {
        abort_if($organization->organization_type !== 'STUDENT_ORGANIZATION', 403);
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

    public function updateDepartmentHead(Request $request, User $user)
    {
        $home = $this->collegeHomeOfHead($user);
        if (! $home) {
            return response()->json(['message' => 'Department Head not found.'], 404);
        }
        if ($request->hasAny(['password', 'password_confirmation', 'password_hash'])) {
            return response()->json(['message' => 'SAO cannot set Department Head passwords. Initiate a secure password reset instead.'], 422);
        }

        $this->normalizeAdminInput($request);
        $data = $request->validate(['first_name' => ['sometimes', 'required', 'string', 'max:60'], 'last_name' => ['sometimes', 'required', 'string', 'max:60'], 'email' => ['sometimes', 'required', 'email', 'max:100', Rule::unique('users', 'email')->ignore($user->school_id, 'school_id')], 'account_status' => ['sometimes', 'in:active,inactive,disabled']]);

        $conflict = DB::transaction(function () use ($data, $home, $request, $user) {
            College::whereKey($home->college_id)->lockForUpdate()->first();
            $user = User::whereKey($user->school_id)->lockForUpdate()->firstOrFail();
            $reactivates = ($data['account_status'] ?? null) === 'active' && $user->account_status !== 'active';
            if ($reactivates && $this->collegeHasActiveHead($home->id, $user->school_id)) {
                return response()->json(['message' => self::ACTIVE_HEAD_EXISTS], 409);
            }

            $old = $user->toArray();
            $emailChanges = isset($data['email']) && $data['email'] !== $user->email;
            $user->update($data);
            if ($emailChanges || ($data['account_status'] ?? $user->account_status) !== 'active') {
                $user->tokens()->delete();
            }
            $fresh = $user->fresh();
            $action = match (true) {
                ($old['account_status'] ?? null) !== $fresh->account_status && $fresh->account_status === 'active' => 'department_head_activated',
                ($old['account_status'] ?? null) !== $fresh->account_status => 'department_head_deactivated',
                default => 'department_head_updated',
            };
            $this->audit($request, $action, $fresh, ['before' => $old, 'after' => $fresh->toArray()], 'SAO updated a college Department Head account.');

            return null;
        });
        if ($conflict) {
            return $conflict;
        }

        return response()->json($user->fresh()->load('organization:id,name,acronym'));
    }

    public function initiateDepartmentHeadPasswordReset(Request $request, User $user)
    {
        if (! $this->collegeHomeOfHead($user)) {
            return response()->json(['message' => 'Department Head not found.'], 404);
        }
        if ($user->account_status !== 'active') {
            return response()->json(['message' => 'Activate this Department Head before initiating a password reset.'], 422);
        }

        $resetLink = $this->passwordResetService->issue($user);
        $this->audit($request, 'department_head_password_reset_initiated', $user, ['email' => $user->email], 'SAO initiated a secure password reset for a college Department Head.');

        return self::resetResponse($resetLink, 'Password reset instructions were sent to the Department Head email address.');
    }

    /** With mail off the one-time link comes back to the SAO to hand over; it is shown once and never stored. */
    public static function resetResponse(?string $resetLink, string $sentMessage): JsonResponse
    {
        if ($resetLink === null) {
            return response()->json(['message' => $sentMessage]);
        }

        return response()->json(['message' => 'The reset link is ready. It works once and expires in 60 minutes.', 'reset_link' => $resetLink])
            ->header('Cache-Control', 'no-store');
    }

    private function collegeHomeOfHead(User $user): ?Organization
    {
        if ($user->role !== 'DEPARTMENT_HEAD') {
            return null;
        }

        return Organization::whereKey($user->organization_id)->where('organization_type', 'COLLEGE')->whereNotNull('college_id')->first();
    }

    private function collegeHasActiveHead(int $homeOrganizationId, ?int $exceptSchoolId = null): bool
    {
        return User::where('organization_id', $homeOrganizationId)
            ->where('role', 'DEPARTMENT_HEAD')
            ->where('account_status', 'active')
            ->when($exceptSchoolId, fn ($query) => $query->whereKeyNot($exceptSchoolId))
            ->exists();
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
