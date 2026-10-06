<?php

namespace App\Services;

use App\Models\AccountProfile;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

class AccountProfileDeletionService
{
    public function organizationsFor(User $actor): Builder
    {
        abort_unless(in_array($actor->role, ['SUPER_ADMIN', 'ADMIN'], true), 403);
        $query = Organization::where('organization_type', 'STUDENT_ORGANIZATION');
        if ($actor->role !== 'SUPER_ADMIN') {
            $college = Organization::whereKey($actor->organization_id)->value('college');
            $query->where('college', $college)->where(fn ($query) => $query
                ->where('id', $actor->organization_id)->orWhere('parent_organization_id', $actor->organization_id));
        }

        return $query;
    }

    public function permissionFailure(User $actor, AccountProfile $profile): ?string
    {
        if ($actor->school_id === $profile->user_school_id) {
            return 'You cannot delete your own profile.';
        }
        if ($profile->role === 'SUPER_ADMIN' || $profile->user->getRawOriginal('role') === 'SUPER_ADMIN') {
            return 'The SAO account cannot be deleted.';
        }
        if ($profile->role === 'ADMIN' && $actor->role !== 'SUPER_ADMIN') {
            return 'Only SAO can delete an Admin profile.';
        }

        return null;
    }

    public function remove(User $actor, AccountProfile $requestedProfile): array
    {
        try {
            return DB::transaction(function () use ($actor, $requestedProfile) {
                $organization = $this->organizationsFor($actor)->lockForUpdate()->findOrFail($requestedProfile->organization_id);
                $user = User::whereKey($requestedProfile->user_school_id)->lockForUpdate()->firstOrFail();
                $profile = $user->accountProfiles()->whereKey($requestedProfile->id)->lockForUpdate()->firstOrFail();
                $profile->setRelation('user', $user);
                if ($reason = $this->permissionFailure($actor, $profile)) {
                    abort(403, $reason);
                }
                if ($profile->role === 'ADMIN' && $profile->account_status === 'active' && $user->getRawOriginal('account_status') === 'active') {
                    $otherAdmin = AccountProfile::where('organization_id', $organization->id)->where('role', 'ADMIN')
                        ->where('account_status', 'active')->whereKeyNot($profile->id)
                        ->whereHas('user', fn ($query) => $query->where('account_status', 'active'))->exists();
                    abort_unless($otherAdmin, 422, 'Assign another active Admin before deleting the last one.');
                }

                $profiles = $user->accountProfiles()->with('organization:id,is_active')->orderBy('id')->get();
                $remaining = $profiles->where('id', '!=', $profile->id);
                $isPrimary = (int) $user->getRawOriginal('organization_id') === (int) $profile->organization_id;
                if ($remaining->isEmpty()) {
                    foreach (['events' => 'created_by', 'tasks' => 'created_by', 'orders' => 'student_id', 'approval_requests' => 'requested_by', 'candidates' => 'user_id', 'votes' => 'voter_id', 'venue_bookings' => 'requested_by', 'compliance_requirement_types' => 'created_by', 'organization_compliance_submissions' => 'submitted_by'] as $table => $column) {
                        abort_if(DB::table($table)->where($column, $user->school_id)->exists(), 409,
                            'This user has linked operational records. Deactivate the account instead of deleting its final profile.');
                    }
                    $user->tokens()->delete();
                    $user->delete();
                } else {
                    $user->tokens()->where(fn ($query) => $query->where('account_profile_id', $profile->id)
                        ->when($isPrimary, fn ($query) => $query->orWhereNull('account_profile_id')))->delete();
                    if ($isPrimary) {
                        $replacement = $remaining->sortByDesc(fn ($item) => $item->account_status === 'active' && $item->organization?->is_active)->first();
                        // Bypass the User update hook, which would overwrite the replacement's existing profile.
                        DB::table('users')->where('school_id', $user->school_id)->update([
                            'organization_id' => $replacement->organization_id,
                            'role' => $replacement->role,
                            'account_status' => $replacement->account_status,
                            'position_title' => $replacement->position_title,
                        ]);
                    }
                    $profile->delete();
                }

                return ['school_id' => $user->school_id, 'organization_id' => $organization->id,
                    'account_deleted' => $remaining->isEmpty(), 'remaining_profiles' => $remaining->count()];
            });
        } catch (QueryException $exception) {
            if (! in_array((string) $exception->getCode(), ['23000', '23503'], true)) {
                throw $exception;
            }
            abort(409, 'This user has linked records. Deactivate the account instead of deleting its final profile.');
        }
    }
}
