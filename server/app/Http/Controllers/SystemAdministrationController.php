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
use App\Models\SboPosition;
use App\Models\User;
use App\Services\AccountProfileDeletionService;
use App\Services\PasswordResetService;
use App\Support\FilterValues;
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
    // Department heads keep their oversight role; they never take over an organization.
    private const SUCCESSOR_ROLES = ['STUDENT', 'SBO_OFFICER', 'ADMIN'];

    private const PROFILE_ONLY_ADMIN = 'An administrator who holds the role only through an extra organization profile is changed with Manage profiles.';

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
        $data = $request->validate(['name' => ['sometimes', 'required', 'string', 'max:255', Rule::unique('organizations', 'name')->ignore($organization->id)], 'acronym' => ['sometimes', 'required', 'string', 'max:50', Rule::unique('organizations', 'acronym')->ignore($organization->id)], 'parent_organization_id' => ['nullable', 'integer', Rule::exists('organizations', 'id')->where('organization_type', 'STUDENT_ORGANIZATION')->whereNull('parent_organization_id')->where('is_active', true)->where('id', '!=', $organization->id)], 'description' => ['nullable', 'string', 'max:3000'], 'logo_url' => ['nullable', 'url', 'max:2048'], 'color' => ['nullable', 'regex:/^#[0-9a-fA-F]{6}$/']]);
        if ($organization->suborganizations()->exists() && array_key_exists('parent_organization_id', $data) && $data['parent_organization_id']) {
            return response()->json(['message' => 'An organization with suborganizations cannot become a suborganization.'], 422);
        }
        if (! empty($data['parent_organization_id'])) {
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

    public function admins(Request $request)
    {
        $filters = $request->validate(['organization_id' => ['nullable', FilterValues::rule(['nullable', 'integer', 'exists:organizations,id'])], 'search' => ['nullable', 'string', 'max:120'], 'status' => ['nullable', FilterValues::rule(['nullable', 'in:active,inactive,disabled,all'])], 'per_page' => ['nullable', 'integer', 'min:1', 'max:100']]);
        $query = AccountProfile::query()
            ->join('users', 'users.school_id', '=', 'account_profiles.user_school_id')
            ->select('account_profiles.*')
            ->with(['organization:'.implode(',', User::SERIALIZED_ORGANIZATION_COLUMNS), 'user' => fn ($user) => $user->without('organization')])
            ->where('account_profiles.role', 'ADMIN')
            ->whereHas('organization', fn ($organization) => $organization->student());
        if (! empty($filters['organization_id'])) {
            $query->whereIn('account_profiles.organization_id', FilterValues::values($filters['organization_id']));
        }
        if (($filters['status'] ?? 'all') !== 'all') {
            $query->whereIn('account_profiles.account_status', FilterValues::values($filters['status']));
        }
        if (! empty($filters['search'])) {
            $query->where(fn ($q) => $q->where('users.first_name', 'like', '%'.$filters['search'].'%')->orWhere('users.last_name', 'like', '%'.$filters['search'].'%')->orWhere('users.email', 'like', '%'.$filters['search'].'%')->orWhere('users.school_id', 'like', '%'.$filters['search'].'%'));
        }

        $admins = $query->orderBy('users.last_name')->orderBy('account_profiles.id')->paginate($filters['per_page'] ?? 20);
        $admins->getCollection()->transform(function (AccountProfile $profile) {
            $isPrimary = $profile->user->getRawOriginal('role') === 'ADMIN'
                && (int) $profile->user->getRawOriginal('organization_id') === (int) $profile->organization_id;
            $profile->user->activateProfile($profile);

            return [...$profile->user->toArray(), 'profile_id' => $profile->id, 'is_primary_profile' => $isPrimary];
        });

        return response()->json($admins);
    }

    public function storeAdmin(Request $request)
    {
        $this->normalizeAdminInput($request);
        $data = $request->validate([
            'organization_id' => ['required', 'integer', Rule::exists('organizations', 'id')->where('organization_type', 'STUDENT_ORGANIZATION')],
            'school_id' => ['required', 'integer', 'min:1', 'max:99999999', Rule::unique('users', 'school_id')],
            'first_name' => ['required', 'string', 'max:60'],
            'last_name' => ['required', 'string', 'max:60'],
            'email' => ['required', 'email', 'max:255', Rule::unique('users', 'email')],
            'contact_number' => ['nullable', 'string', 'max:30', 'regex:/^[0-9+\\-\\s()]{7,30}$/'],
            'position_title' => ['nullable', 'string', 'max:100'],
            'password' => ['required', 'string', 'min:8', 'max:72', 'confirmed'],
            'password_hash' => ['prohibited'],
            'role' => ['prohibited'],
            'account_status' => ['prohibited'],
        ]);
        $user = DB::transaction(function () use ($request, $data) {
            $organization = Organization::student()->whereKey($data['organization_id'])->lockForUpdate()->firstOrFail();
            abort_unless($organization->is_active && $organization->isWritable(), 409, 'Choose an active organization in an active college.');
            $user = User::create([
                ...collect($data)->except('password')->all(),
                'password_hash' => $data['password'],
                'role' => 'ADMIN',
                'account_status' => 'active',
                'must_change_password' => true,
                'department' => $organization->getRawOriginal('college'),
            ]);
            $this->ensureAdminPosition($organization->id, $data['position_title'] ?? null);
            $this->audit($request, 'administrator_created', $user, $user->only(['school_id', 'organization_id', 'first_name', 'last_name', 'email', 'role']), 'SAO created an organization administrator account.');

            return $user;
        });

        return response()->json($user->load('organization:id,name,acronym,college'), 201);
    }

    public function updateAdmin(Request $request, User $user)
    {
        if ($user->role !== 'ADMIN' || ! Organization::whereKey($user->organization_id)->student()->exists()) {
            return response()->json(['message' => 'Only the primary administrator account is edited here. '.self::PROFILE_ONLY_ADMIN], 422);
        }
        if ($request->hasAny(['password', 'password_confirmation', 'password_hash'])) {
            return response()->json(['message' => 'SAO cannot set administrator passwords. Initiate a secure password reset instead.'], 422);
        }

        $this->normalizeAdminInput($request);
        $data = $request->validate(['organization_id' => ['sometimes', 'integer', Rule::exists('organizations', 'id')->where('is_active', true)], 'first_name' => ['sometimes', 'required', 'string', 'max:60'], 'last_name' => ['sometimes', 'required', 'string', 'max:60'], 'email' => ['sometimes', 'required', 'email', 'max:255', Rule::unique('users', 'email')->ignore($user->school_id, 'school_id')], 'contact_number' => ['nullable', 'string', 'max:30', 'regex:/^[0-9+\\-\\s()]{7,30}$/'], 'position_title' => ['nullable', 'string', 'max:100'], 'account_status' => ['sometimes', 'in:active,inactive,disabled']]);
        if (isset($data['organization_id'])) {
            $organization = Organization::whereKey($data['organization_id'])->student()->first();
            if (! $organization) {
                return response()->json(['message' => 'Choose an active student organization.'], 422);
            }
            $data['department'] = $organization->college;
        }

        $leavesCurrentOrganization = isset($data['organization_id']) && (int) $data['organization_id'] !== (int) $user->organization_id;
        $deactivatesAccount = isset($data['account_status']) && $data['account_status'] !== 'active';
        $currentOrganizationIsActive = Organization::whereKey($user->organization_id)->where('is_active', true)->exists();
        if ($user->account_status === 'active' && $currentOrganizationIsActive && ($leavesCurrentOrganization || $deactivatesAccount)) {
            $hasAnotherActiveAdmin = AccountProfile::where('organization_id', $user->organization_id)
                ->activeAdministrators()
                ->where('user_school_id', '!=', $user->school_id)
                ->exists();
            if (! $hasAnotherActiveAdmin) {
                return response()->json(['message' => 'Add another active administrator before transferring or deactivating this organization\'s last active administrator.'], 422);
            }
        }

        $old = $user->toArray();
        DB::transaction(function () use ($data, $old, $request, $user) {
            $this->ensureAdminPosition((int) ($data['organization_id'] ?? $user->organization_id), $data['position_title'] ?? $user->position_title);
            $emailChanges = isset($data['email']) && $data['email'] !== $user->email;
            $user->update($data);
            if ($emailChanges || ($data['account_status'] ?? $user->account_status) !== 'active') {
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
            return response()->json(['message' => 'Only another organization Admin can be removed here. '.self::PROFILE_ONLY_ADMIN], 403);
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
        if ($organization->organization_type !== 'STUDENT_ORGANIZATION') {
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
        $organization = Organization::whereKey($user->organization_id)->student()->first();
        if ($user->role !== 'ADMIN' || ! $organization) {
            return response()->json(['message' => 'Only organization administrator accounts can be handed over. '.self::PROFILE_ONLY_ADMIN], 422);
        }
        abort(403, 'Administrator appointments must be handled by the organization.');
    }

    public function initiateAdminPasswordReset(Request $request, User $user)
    {
        if ($user->role !== 'ADMIN' || ! Organization::whereKey($user->organization_id)->student()->exists()) {
            return response()->json(['message' => 'Only administrator accounts are managed here.'], 422);
        }
        if ($user->account_status !== 'active') {
            return response()->json(['message' => 'Activate this administrator before initiating a password reset.'], 422);
        }

        $this->passwordResetService->issue($user);
        $this->audit($request, 'administrator_password_reset_initiated', $user, ['email' => $user->email], 'SAO initiated a secure password reset for an organization Admin.');

        return response()->json(['message' => 'Password reset instructions were sent to the administrator email address.']);
    }

    public function storeDepartmentHead(Request $request, College $college)
    {
        $home = $college->homeOrganization;
        if (! $home) {
            return response()->json(['message' => 'This college has no home organization yet.'], 422);
        }

        $mode = $request->validate(['account_mode' => ['sometimes', Rule::in(['new', 'existing'])]])['account_mode'] ?? 'new';
        if ($mode === 'existing') {
            $data = $request->validate(['school_id' => ['required', 'integer', 'min:1', 'max:99999999']]);

            $head = DB::transaction(function () use ($data, $college, $home, $request) {
                College::whereKey($college->id)->lockForUpdate()->first();
                if ($this->collegeHasActiveHead($home->id)) {
                    return response()->json(['message' => self::ACTIVE_HEAD_EXISTS], 409);
                }

                $user = User::whereKey($data['school_id'])->lockForUpdate()->first();
                $primaryOrganization = $user ? Organization::whereKey($user->getRawOriginal('organization_id'))->first() : null;
                if (! $user || $user->getRawOriginal('account_status') !== 'active'
                    || ! in_array($user->getRawOriginal('role'), ['STUDENT', 'SBO_OFFICER'], true)
                    || ! $primaryOrganization || ! $primaryOrganization->is_active
                    || $primaryOrganization->organization_type !== 'STUDENT_ORGANIZATION'
                    || $primaryOrganization->college !== $college->name
                    || ($primaryOrganization->college_id && (int) $primaryOrganization->college_id !== (int) $college->id)
                    || ($user->department && $user->department !== $college->name)
                    || ! $user->accountProfiles()->where('organization_id', $primaryOrganization->id)->where('account_status', 'active')->exists()
                    || $user->accountProfiles()->where('organization_id', $home->id)->exists()
                    || $user->accountProfiles()->where('role', 'DEPARTMENT_HEAD')->exists()) {
                    throw ValidationException::withMessages([
                        'school_id' => ['Choose an active student or officer account from this college.'],
                    ]);
                }

                $user->accountProfiles()->create([
                    'organization_id' => $home->id,
                    'role' => 'DEPARTMENT_HEAD',
                    'account_status' => 'active',
                ]);
                // Keep the existing organization profile while making the college profile the default login.
                DB::table('users')->where('school_id', $user->school_id)->update([
                    'organization_id' => $home->id,
                    'role' => 'DEPARTMENT_HEAD',
                    'position_title' => null,
                    'department' => $college->name,
                    'updated_at' => now(),
                ]);
                $user->tokens()->delete();
                Notification::create(['organization_id' => $home->id, 'user_id' => $user->school_id, 'notification_type' => 'general', 'title' => 'Department Head profile added', 'message' => "Your HIUSA Department Head profile for {$college->name} is ready. Sign in with your existing credentials to oversee organizations across the college.", 'is_read' => false, 'sent_at' => now()]);
                $this->audit($request, 'department_head_assigned', $user, ['department_head_id' => $user->school_id, 'college_id' => $college->id, 'organization_id' => $home->id], 'SAO added a college Department Head profile to an existing account.');

                return $user->fresh();
            });

            return $head instanceof JsonResponse ? $head : response()->json($head->load('organization:id,name,acronym'), 201);
        }

        $this->normalizeAdminInput($request);
        $data = $request->validate(['school_id' => ['required', 'integer', 'min:1', 'max:99999999', 'unique:users,school_id'], 'first_name' => ['required', 'string', 'max:60'], 'last_name' => ['required', 'string', 'max:60'], 'email' => ['required', 'email', 'max:100', 'unique:users,email'], 'password' => ['required', 'string', 'min:8', 'confirmed']]);

        $head = DB::transaction(function () use ($data, $college, $home, $request) {
            College::whereKey($college->id)->lockForUpdate()->first();
            if ($this->collegeHasActiveHead($home->id)) {
                return response()->json(['message' => self::ACTIVE_HEAD_EXISTS], 409);
            }
            $head = User::create([
                'organization_id' => $home->id,
                'school_id' => $data['school_id'],
                'first_name' => $data['first_name'],
                'last_name' => $data['last_name'],
                'email' => $data['email'],
                'password_hash' => $data['password'],
                'must_change_password' => true,
                'role' => 'DEPARTMENT_HEAD',
                'account_status' => 'active',
                'is_member' => true,
                'department' => $college->name,
            ]);
            Notification::create(['organization_id' => $home->id, 'user_id' => $head->school_id, 'notification_type' => 'general', 'title' => 'Department Head account created', 'message' => "Your HIUSA Department Head account for {$college->name} has been created by the Student Affairs Office. Sign in using the credentials provided by SAO and change your password from your profile if needed.", 'is_read' => false, 'sent_at' => now()]);
            $this->audit($request, 'department_head_created', $head, ['department_head_id' => $head->school_id, 'college_id' => $college->id, 'organization_id' => $home->id], 'SAO created a college Department Head account.');

            return $head;
        });
        if ($head instanceof JsonResponse) {
            return $head;
        }

        return response()->json($head->load('organization:id,name,acronym'), 201);
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

        $this->passwordResetService->issue($user);
        $this->audit($request, 'department_head_password_reset_initiated', $user, ['email' => $user->email], 'SAO initiated a secure password reset for a college Department Head.');

        return response()->json(['message' => 'Password reset instructions were sent to the Department Head email address.']);
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
