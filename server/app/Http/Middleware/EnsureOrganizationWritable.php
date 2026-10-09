<?php

namespace App\Http\Middleware;

use App\Models\AccountProfile;
use App\Models\Organization;
use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Refuses SAO writes aimed at an organization that is not active, so an
 * archived (or still pending) organization stays frozen. The target is the
 * route's organization, the organization of the route's user, the organization
 * of the route's account profile when the SAO deletes it, or the organization_id
 * in the body (the destination of an admin transfer counts too).
 */
class EnsureOrganizationWritable
{
    public function handle(Request $request, Closure $next): Response
    {
        $routeOrganization = $request->route('organization');
        $routeUser = $request->route('user');
        $routeProfile = $request->route('profile');
        $ids = array_filter([
            $routeOrganization instanceof Organization ? $routeOrganization->id : $routeOrganization,
            $routeUser instanceof User ? $routeUser->getRawOriginal('organization_id') : null,
            $routeProfile instanceof AccountProfile && $request->user()?->role === 'SUPER_ADMIN' ? $routeProfile->organization_id : null,
            $request->input('organization_id'),
        ], fn ($id) => is_numeric($id));

        $blocked = Organization::whereIn('id', $ids)->where('lifecycle_status', '!=', 'active')->first();
        if ($blocked) {
            return response()->json(['message' => $blocked->isArchived() ? 'Archived organizations are read only.' : 'Only active organizations can be changed.'], 409);
        }

        return $next($request);
    }
}
