<?php

namespace App\Http\Controllers;

use App\Models\AccountProfile;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AccountProfileController extends Controller
{
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

    public function invite(Request $request)
    {
        $actor = $request->user();
        $data = $request->validate([
            'school_id' => ['required', 'integer', 'min:1', 'max:99999999'],
            'role' => ['required', 'in:STUDENT,SBO_OFFICER,DEPARTMENT_HEAD'],
        ]);

        $organization = Organization::find($actor->organization_id);
        if (! $organization?->parent_organization_id) {
            return response()->json(['message' => 'Existing accounts can only be invited to a suborganization.'], 403);
        }

        $user = User::find($data['school_id']);
        if (! $user || $user->getRawOriginal('role') === 'SUPER_ADMIN') {
            return response()->json(['message' => 'Account not found.'], 404);
        }

        if ((int) $user->getRawOriginal('organization_id') !== (int) $organization->parent_organization_id) {
            return response()->json(['message' => 'This account must belong to the suborganization parent organization.'], 422);
        }

        if ($user->accountProfiles()->where('organization_id', $organization->id)->exists()) {
            return response()->json(['message' => 'This account already belongs to the organization.'], 409);
        }

        $profile = DB::transaction(fn () => $user->accountProfiles()->create([
            'organization_id' => $organization->id,
            'role' => $data['role'],
            'account_status' => 'active',
        ]));

        return response()->json($profile->load('organization:id,name,acronym,college,parent_organization_id'), 201);
    }
}
