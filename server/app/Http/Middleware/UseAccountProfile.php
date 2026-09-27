<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class UseAccountProfile
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        $tokenProfileId = $user?->currentAccessToken()?->account_profile_id;
        $profile = $user?->accountProfiles()->with('organization')
            ->when($tokenProfileId, fn ($query) => $query->whereKey($tokenProfileId))
            ->when(! $tokenProfileId, fn ($query) => $query->where('organization_id', $user->getRawOriginal('organization_id')))
            ->first();

        if (! $profile && ! $tokenProfileId && $user) {
            $attributes = $user->getAttributes();
            $profile = $user->accountProfiles()->firstOrCreate(
                ['organization_id' => $user->getRawOriginal('organization_id')],
                [
                    'role' => $attributes['role'],
                    'account_status' => $attributes['account_status'],
                    'position_title' => $attributes['position_title'] ?? null,
                ],
            )->load('organization');
        }

        if (! $profile || $profile->account_status !== 'active' || ! $profile->organization?->is_active || $user->account_status !== 'active') {
            return response()->json(['message' => 'This account profile is unavailable.'], 403);
        }

        $user->activateProfile($profile);

        return $next($request);
    }
}
