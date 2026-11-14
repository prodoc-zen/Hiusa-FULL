<?php

namespace App\Http\Controllers;

use App\Models\AccountProfile;
use App\Models\AuditLog;
use App\Models\College;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\SboPosition;
use App\Models\StudentRegistryEntry;
use App\Models\User;
use App\Services\AccountProfileDeletionService;
use App\Support\AdviserPosition;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class AccountProfileController extends Controller
{
    public function __construct(private readonly AccountProfileDeletionService $profileDeletion) {}

    public function index(Request $request)
    {
        return response()->json([
            'active_profile_id' => $request->user()->currentAccessToken()?->account_profile_id
                ?? $request->user()->active_profile_id,
            'profiles' => $request->user()->accountProfiles()->with(['organization:id,name,acronym,college,college_id,organization_type,parent_organization_id,is_active', 'organization.catalogCollege'])
                ->orderBy('id')->get()->each(function ($profile) {
                    $profile->organization?->setAttribute('college_is_active', $profile->organization->collegeAllowsAccess());
                    $profile->organization?->unsetRelation('catalogCollege');
                }),
        ]);
    }

    public function switch(Request $request, AccountProfile $profile)
    {
        $user = $request->user();
        if ($profile->user_school_id !== $user->school_id || $profile->account_status !== 'active'
            || ! $profile->organization?->is_active || ! $profile->organization->collegeAllowsAccess()) {
            return response()->json(['message' => 'Account profile not available.'], 404);
        }

        $token = $user->currentAccessToken();
        if (! $token || ! $token->exists) {
            return response()->json(['message' => 'Profile switching requires a signed-in token.'], 403);
        }

        $token->forceFill(['account_profile_id' => $profile->id])->save();
        $user->activateProfile($profile->load('organization'));

        return response()->json(['user' => $user, 'active_profile_id' => $profile->id]);
    }

    private function managedOrganizations(User $actor, bool $activeOnly = true): Builder
    {
        return $this->profileDeletion->organizationsFor($actor)->when($activeOnly, fn ($query) => $query->where('is_active', true));
    }

    private function targetOrganization(Request $request, int $organizationId, bool $lock = false): Organization
    {
        $query = $this->managedOrganizations($request->user());
        if ($lock) {
            $query->lockForUpdate();
        }
        $organization = $query->findOrFail($organizationId);
        abort_unless($organization->isWritable(), 404);
        if (! $organization->is_university_wide && ! trim($organization->college ?? '')) {
            throw ValidationException::withMessages(['organization_id' => ['Assign a college to this organization before adding existing users.']]);
        }

        return $organization;
    }

    private function eligibleUsers(Organization $organization): Builder
    {
        if ($organization->is_university_wide) {
            return User::where('role', '!=', 'SUPER_ADMIN')->where('account_status', 'active')
                ->whereHas('accountProfiles', fn ($profiles) => $profiles->where('account_status', 'active')
                    ->whereHas('organization', fn ($organizations) => $organizations->where('is_active', true)->where('lifecycle_status', 'active')
                        ->whereIn('organization_type', ['STUDENT_ORGANIZATION', 'COLLEGE'])
                        ->where(fn ($colleges) => $colleges->whereHas('catalogCollege', fn ($college) => $college->where('is_active', true)->whereNull('deleted_at'))
                            ->orWhere(fn ($legacy) => $legacy->whereNull('college_id')->where(fn ($available) => $available->where('is_university_wide', true)
                                ->orWhereNotIn('college', College::withTrashed()->where(fn ($closed) => $closed->where('is_active', false)->orWhereNotNull('deleted_at'))->select('name')))))));
        }

        // Anyone with an active student profile in a college organization (home or student organization) belongs to the college.
        return User::where('role', '!=', 'SUPER_ADMIN')->where('account_status', 'active')
            ->whereHas('accountProfiles', fn ($query) => $query->where('account_status', 'active')
                ->whereIn('role', ['STUDENT', 'SBO_OFFICER', 'ADMIN'])
                ->whereHas('organization', fn ($organizations) => $organizations->where('is_active', true)
                    ->whereIn('organization_type', ['STUDENT_ORGANIZATION', 'COLLEGE'])
                    ->when($organization->college_id,
                        fn ($colleges) => $colleges->where('college_id', $organization->college_id),
                        fn ($colleges) => $colleges->where('college', $organization->college))))
            ->where(fn ($query) => $query->whereNull('department')->orWhere('department', '')->orWhere('department', $organization->college));
    }

    public function organizations(Request $request)
    {
        $request->validate(['include_inactive' => ['nullable', 'boolean']]);

        return response()->json($this->managedOrganizations($request->user(), ! $request->boolean('include_inactive'))->orderBy('name')
            ->get(['id', 'name', 'acronym', 'college', 'parent_organization_id', 'is_active', 'is_university_wide']));
    }

    public function members(Request $request)
    {
        $data = $request->validate([
            'organization_id' => ['nullable', 'integer'], 'user_school_id' => ['nullable', 'integer'],
            'search' => ['nullable', 'string', 'max:120'], 'per_page' => ['nullable', 'integer', 'min:1', 'max:50'],
        ]);
        $organizations = $this->managedOrganizations($request->user(), false);
        if (! empty($data['organization_id'])) {
            $organizations->whereKey($data['organization_id']);
            (clone $organizations)->firstOrFail();
        }
        $query = AccountProfile::whereIn('organization_id', $organizations->select('id'))
            ->with(['organization:id,name,acronym,college,is_active', 'user' => fn ($query) => $query
                ->without('organization')->select('school_id', 'organization_id', 'role', 'first_name', 'last_name', 'email')->withCount('accountProfiles')])
            ->when(! empty($data['user_school_id']), fn ($query) => $query->where('user_school_id', $data['user_school_id']));
        foreach (preg_split('/[\s,]+/', trim($data['search'] ?? ''), -1, PREG_SPLIT_NO_EMPTY) as $term) {
            $query->whereHas('user', fn ($query) => $query->where(fn ($query) => $query
                ->where('first_name', 'like', '%'.$term.'%')->orWhere('last_name', 'like', '%'.$term.'%')
                ->orWhere('email', 'like', '%'.$term.'%')->orWhere('school_id', 'like', '%'.$term.'%')));
        }
        $rows = $query->orderBy('user_school_id')->orderBy('id')->paginate($data['per_page'] ?? 20);
        $rows->getCollection()->transform(fn ($profile) => [
            'id' => $profile->id, 'organization_id' => $profile->organization_id, 'organization' => $profile->organization,
            'school_id' => $profile->user_school_id, 'first_name' => $profile->user->first_name,
            'last_name' => $profile->user->last_name, 'email' => $profile->user->email,
            'role' => $profile->role, 'account_status' => $profile->account_status,
            'position_title' => $profile->position_title, 'modules' => $profile->modules,
            'profiles_count' => $profile->user->account_profiles_count,
            'is_primary' => (int) $profile->organization_id === (int) $profile->user->getRawOriginal('organization_id'),
            'deletion_block_reason' => $this->profileDeletion->permissionFailure($request->user(), $profile),
        ]);

        return response()->json($rows);
    }

    public function destroy(Request $request, AccountProfile $profile)
    {
        return DB::transaction(function () use ($request, $profile) {
            $result = $this->profileDeletion->remove($request->user(), $profile);
            AuditLog::create([
                'organization_id' => $profile->organization_id, 'user_id' => $request->user()->school_id,
                'actor_role' => $request->user()->role, 'module' => 'users', 'action' => 'account_profile_deleted',
                'record_type' => AccountProfile::class, 'record_id' => $profile->id,
                'old_values' => ['school_id' => $profile->user_school_id, 'role' => $profile->role],
                'new_values' => $result, 'ip_address' => $request->ip(), 'created_at' => now(),
            ]);

            return response()->json(['message' => $result['account_deleted'] ? 'Final profile and user account deleted.' : 'Organization profile deleted.', ...$result]);
        });
    }

    public function candidates(Request $request)
    {
        $data = $request->validate([
            'organization_id' => ['required', 'integer'],
            'search' => ['nullable', 'string', 'max:120'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:50'],
        ]);
        $organization = $this->targetOrganization($request, $data['organization_id']);
        $query = $this->eligibleUsers($organization)->without('organization')
            ->whereDoesntHave('accountProfiles', fn ($query) => $query->where('organization_id', $organization->id));
        foreach (preg_split('/[\s,]+/', trim($data['search'] ?? ''), -1, PREG_SPLIT_NO_EMPTY) as $term) {
            $query->where(fn ($query) => $query->where('first_name', 'like', '%'.$term.'%')
                ->orWhere('last_name', 'like', '%'.$term.'%')->orWhere('email', 'like', '%'.$term.'%')
                ->orWhere('school_id', 'like', '%'.$term.'%'));
        }

        return response()->json($query->orderBy('last_name')->orderBy('first_name')->orderBy('school_id')
            ->paginate($data['per_page'] ?? 20, ['school_id', 'first_name', 'last_name', 'email', 'department', 'program']));
    }

    /** Roles the actor may hand out: nobody grants above their own level. */
    private function grantableRoles(User $actor): array
    {
        return match ($actor->role) {
            'SUPER_ADMIN', 'DEPARTMENT_HEAD', 'ADMIN' => ['ADMIN', 'SBO_OFFICER', 'STUDENT'],
            default => [],
        };
    }

    /** The SAO adds nobody below the Department Head; its one grant is the Admin of a university-wide organization, which has no dean. An organization head hands out officer and member access; Admin only into a suborganization of theirs, never beside themselves. */
    private function assertMayGrant(User $actor, string $role, Organization $organization): void
    {
        if ($actor->role === 'SUPER_ADMIN') {
            abort_unless($organization->is_university_wide, 403, 'The Department Head gives access in a college organization.');
            abort_unless($role === 'ADMIN', 403, 'The SAO names only the Admin of a university-wide organization.');
        }
        if ($role === 'ADMIN' && $actor->role === 'ADMIN' && (int) $organization->id === (int) $actor->organization_id) {
            throw ValidationException::withMessages(['role' => [$organization->is_university_wide ? 'Only the SAO can name another organization head.' : 'Only the Department Head can name another organization head.']]);
        }
    }

    private function grantRules(User $actor): array
    {
        return [
            'role' => ['required', Rule::in($this->grantableRoles($actor))],
            'position_title' => ['nullable', 'string', 'max:100'],
            'modules' => ['nullable', 'array', 'min:1'],
            'modules.*' => ['string', 'distinct', Rule::in(AccountProfile::MODULES)],
        ];
    }

    /** Position and modules for one grant: modules only apply to officers, and a full set is stored as "all". */
    private function grantDetails(array $data, Organization $organization): array
    {
        $title = trim((string) ($data['position_title'] ?? '')) ?: null;
        if ($data['role'] === 'STUDENT') {
            $title = null;
        }
        if ($title !== null) {
            $known = SboPosition::where('organization_id', $organization->id)->where('role', $data['role'])
                ->where('is_active', true)->where('title', $title)->exists();
            if (! $known) {
                throw ValidationException::withMessages(['position_title' => ['Choose a position from this organization’s list.']]);
            }
        }

        $modules = null;
        if ($data['role'] === 'SBO_OFFICER' && ! empty($data['modules'])) {
            $picked = array_values(array_intersect(AccountProfile::MODULES, $data['modules']));
            $modules = count($picked) === count(AccountProfile::MODULES) ? null : $picked;
        }

        return ['position_title' => $title, 'modules' => $modules];
    }

    public function positions(Request $request)
    {
        $data = $request->validate(['organization_id' => ['required', 'integer']]);
        $organization = $this->managedOrganizations($request->user())->findOrFail($data['organization_id']);

        return response()->json(SboPosition::where('organization_id', $organization->id)->where('is_active', true)
            ->orderBy('role')->orderBy('title')->get(['id', 'role', 'title']));
    }

    public function invite(Request $request)
    {
        $actor = $request->user();
        $data = $request->validate([
            'school_id' => ['required', 'integer', 'min:1', 'max:99999999'],
            'organization_id' => ['sometimes', 'required', 'integer'],
            ...$this->grantRules($actor),
        ]);

        $profile = DB::transaction(function () use ($request, $actor, $data) {
            $organization = $this->targetOrganization($request, $data['organization_id'] ?? $actor->organization_id, true);
            $this->assertMayGrant($actor, $data['role'], $organization);
            $details = $this->grantDetails($data, $organization);
            $user = $this->eligibleUsers($organization)->lockForUpdate()->find($data['school_id']);
            if (! $user) {
                throw ValidationException::withMessages(['school_id' => ['Choose an active student from this organization’s college.']]);
            }
            abort_if($user->accountProfiles()->where('organization_id', $organization->id)->exists(), 409, 'This account already belongs to the organization.');
            $profile = $user->accountProfiles()->create([
                'organization_id' => $organization->id, 'role' => $data['role'], 'account_status' => 'active', ...$details,
            ]);
            AuditLog::create([
                'organization_id' => $organization->id, 'user_id' => $actor->school_id, 'actor_role' => $actor->role,
                'module' => 'users', 'action' => 'organization_membership_added', 'record_type' => AccountProfile::class,
                'record_id' => $profile->id, 'new_values' => ['user_school_id' => $user->school_id, 'role' => $data['role'], ...$details],
                'description' => 'Added an existing user to the organization.', 'ip_address' => $request->ip(), 'created_at' => now(),
            ]);
            $label = $details['position_title'] ?? match ($data['role']) {
                'ADMIN' => 'Organization head', 'SBO_OFFICER' => 'Officer', default => 'Member',
            };
            Notification::create([
                'organization_id' => $organization->id, 'user_id' => $user->school_id, 'notification_type' => 'general',
                'title' => 'You have new access', 'message' => "You now have access to {$organization->name} as {$label}.",
                'reference_type' => 'organization', 'reference_id' => $organization->id, 'is_read' => false, 'sent_at' => now(),
            ]);

            return $profile;
        });

        return response()->json($profile->load('organization:id,name,acronym,college,parent_organization_id'), 201);
    }

    public function update(Request $request, AccountProfile $profile)
    {
        $actor = $request->user();
        $data = $request->validate($this->grantRules($actor));

        $profile = DB::transaction(function () use ($request, $actor, $data, $profile) {
            $organization = $this->targetOrganization($request, $profile->organization_id, true);
            $profile = AccountProfile::with('user')->lockForUpdate()->findOrFail($profile->id);
            $this->assertMayGrant($actor, $data['role'], $organization);
            if ($reason = $this->profileDeletion->permissionFailure($actor, $profile)) {
                abort(403, $reason);
            }
            if ($profile->role === 'ADMIN' && $data['role'] !== 'ADMIN' && $profile->account_status === 'active') {
                $otherAdmin = AccountProfile::where('organization_id', $organization->id)->where('role', 'ADMIN')
                    ->where('account_status', 'active')->whereKeyNot($profile->id)
                    ->whereHas('user', fn ($query) => $query->where('account_status', 'active'))->exists();
                abort_unless($otherAdmin, 422, 'Assign another active Admin before changing the last one.');
            }
            $before = $profile->only(['role', 'position_title', 'modules']);
            $profile->update(['role' => $data['role'], ...$this->grantDetails($data, $organization)]);
            AuditLog::create([
                'organization_id' => $organization->id, 'user_id' => $actor->school_id, 'actor_role' => $actor->role,
                'module' => 'users', 'action' => 'organization_access_changed', 'record_type' => AccountProfile::class,
                'record_id' => $profile->id, 'old_values' => $before, 'new_values' => $profile->only(['role', 'position_title', 'modules']),
                'ip_address' => $request->ip(), 'created_at' => now(),
            ]);
            if ($before['role'] === 'STUDENT' && in_array($data['role'], ['SBO_OFFICER', 'ADMIN'], true)) {
                $this->keepStudentWorkspace($request, $actor, $profile, $organization);
            }

            return $profile;
        });

        return response()->json($profile->only(['id', 'organization_id', 'role', 'position_title', 'modules', 'account_status']));
    }

    /**
     * Promoting a member rewrites their profile, so a person who had only that profile would lose the student side
     * of their account. They get the college-home student profile sign-up gives everyone, when the college is known.
     * Only a student the way sign-up proves it, and never a person who holds an adviser title: a faculty adviser invited
     * as a member is not a student.
     */
    private function keepStudentWorkspace(Request $request, User $actor, AccountProfile $promoted, Organization $organization): void
    {
        $person = $promoted->user;
        $isStudent = $person->getRawOriginal('role') === 'STUDENT' || StudentRegistryEntry::students()->where('school_id', $person->school_id)->exists();
        $holdsAdviserTitle = $person->accountProfiles()->where('account_status', 'active')->get(['position_title'])->contains(fn ($held) => AdviserPosition::is($held->position_title));
        if (! $isStudent || $holdsAdviserTitle) {
            return;
        }

        $hasStudentProfile = $person->accountProfiles()->where('role', 'STUDENT')->where('account_status', 'active')->whereKeyNot($promoted->id)->exists();
        $home = $organization->college_id
            ? Organization::where('organization_type', 'COLLEGE')->where('college_id', $organization->college_id)->where('is_active', true)->first()
            : null;
        if ($hasStudentProfile || ! $home || $home->id === $organization->id || $person->accountProfiles()->where('organization_id', $home->id)->exists()) {
            return;
        }

        $student = $person->accountProfiles()->create(['organization_id' => $home->id, 'role' => 'STUDENT', 'account_status' => 'active', 'position_title' => null]);
        AuditLog::create([
            'organization_id' => $home->id, 'user_id' => $actor->school_id, 'actor_role' => $actor->role,
            'module' => 'users', 'action' => 'student_profile_restored', 'record_type' => AccountProfile::class,
            'record_id' => $student->id, 'new_values' => ['user_school_id' => $person->school_id, 'role' => 'STUDENT', 'organization_id' => $home->id],
            'description' => 'Kept a student workspace for a member promoted in '.$organization->name.'.',
            'ip_address' => $request->ip(), 'created_at' => now(),
        ]);
    }
}
