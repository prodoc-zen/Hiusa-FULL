<?php

namespace App\Http\Controllers;

use App\Models\AccountProfile;
use App\Models\AuditLog;
use App\Models\Organization;
use App\Models\User;
use App\Services\AccountProfileDeletionService;
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
            'profiles' => $request->user()->accountProfiles()->with('organization:id,name,acronym,college,parent_organization_id,is_active')
                ->orderBy('id')->get(),
        ]);
    }

    public function switch(Request $request, AccountProfile $profile)
    {
        $user = $request->user();
        if ($profile->user_school_id !== $user->school_id || $profile->account_status !== 'active'
            || ! $profile->organization()->where('is_active', true)->exists()) {
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
        if (! trim($organization->college ?? '')) {
            throw ValidationException::withMessages(['organization_id' => ['Assign a college to this organization before adding existing users.']]);
        }

        return $organization;
    }

    private function eligibleUsers(Organization $organization): Builder
    {
        // The primary organization identifies the college even for legacy users without a department.
        return User::where('role', '!=', 'SUPER_ADMIN')
            ->whereHas('organization', fn ($query) => $query->where('college', $organization->college)
                ->where('organization_type', 'STUDENT_ORGANIZATION'))
            ->where(fn ($query) => $query->whereNull('department')->orWhere('department', '')->orWhere('department', $organization->college))
            ->whereHas('accountProfiles', fn ($query) => $query->where('account_status', 'active')
                ->whereHas('organization', fn ($query) => $query->where('college', $organization->college)->where('is_active', true)));
    }

    public function organizations(Request $request)
    {
        $request->validate(['include_inactive' => ['nullable', 'boolean']]);

        return response()->json($this->managedOrganizations($request->user(), ! $request->boolean('include_inactive'))->orderBy('name')
            ->get(['id', 'name', 'acronym', 'college', 'parent_organization_id', 'is_active']));
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
        foreach (preg_split('/\s+/', trim($data['search'] ?? ''), -1, PREG_SPLIT_NO_EMPTY) as $term) {
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
        foreach (preg_split('/\s+/', trim($data['search'] ?? ''), -1, PREG_SPLIT_NO_EMPTY) as $term) {
            $query->where(fn ($query) => $query->where('first_name', 'like', '%'.$term.'%')
                ->orWhere('last_name', 'like', '%'.$term.'%')->orWhere('email', 'like', '%'.$term.'%')
                ->orWhere('school_id', 'like', '%'.$term.'%'));
        }

        return response()->json($query->orderBy('last_name')->orderBy('first_name')->orderBy('school_id')
            ->paginate($data['per_page'] ?? 20, ['school_id', 'first_name', 'last_name', 'email', 'department', 'program']));
    }

    public function invite(Request $request)
    {
        $actor = $request->user();
        $roles = ['STUDENT', 'SBO_OFFICER'];
        if ($actor->role === 'SUPER_ADMIN') {
            $roles[] = 'ADMIN';
        }
        $data = $request->validate([
            'school_id' => ['required', 'integer', 'min:1', 'max:99999999'],
            'role' => ['required', Rule::in($roles)],
            'organization_id' => ['sometimes', 'required', 'integer'],
        ]);

        $profile = DB::transaction(function () use ($request, $actor, $data) {
            $organization = $this->targetOrganization($request, $data['organization_id'] ?? $actor->organization_id, true);
            $user = $this->eligibleUsers($organization)->lockForUpdate()->find($data['school_id']);
            if (! $user) {
                throw ValidationException::withMessages(['school_id' => ['Choose an active existing user from this organization’s college.']]);
            }
            abort_if($user->accountProfiles()->where('organization_id', $organization->id)->exists(), 409, 'This account already belongs to the organization.');
            $profile = $user->accountProfiles()->create([
                'organization_id' => $organization->id, 'role' => $data['role'], 'account_status' => 'active',
            ]);
            AuditLog::create([
                'organization_id' => $organization->id, 'user_id' => $actor->school_id, 'actor_role' => $actor->role,
                'module' => 'users', 'action' => 'organization_membership_added', 'record_type' => AccountProfile::class,
                'record_id' => $profile->id, 'new_values' => ['user_school_id' => $user->school_id, 'role' => $data['role']],
                'description' => 'Added an existing user to the organization.', 'ip_address' => $request->ip(), 'created_at' => now(),
            ]);

            return $profile;
        });

        return response()->json($profile->load('organization:id,name,acronym,college,parent_organization_id'), 201);
    }
}
