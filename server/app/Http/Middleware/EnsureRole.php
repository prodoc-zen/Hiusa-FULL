<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureRole
{
    public const DEAN_ONLY_MESSAGE = 'Only the dean can do this.';

    /**
     * The one list of dean-only routes, as "METHOD uri". Office staff take the dean's role on every request (see
     * User::getRoleAttribute), so they pass every role gate the dean passes; these are the routes that still refuse
     * them: handing out applicant access, the staff and records controls, access grants on an organization, compliance
     * reminders, signing a clearance line, and replacing or deleting a submitted file. Approvals at the dean's step and
     * everything else the dean's pages read stay open.
     * The SAO and system routes and user management need a role staff never take, so they are not listed.
     */
    public const DEAN_ONLY = [
        'GET api/college/applicant-grants',
        'POST api/college/applicant-grants',
        'DELETE api/college/applicant-grants/{grant}',
        'GET api/students/registry',
        'POST api/students/registry/preview',
        'POST api/students/registry/apply',
        'PATCH api/students/registry/{entry}',
        'DELETE api/students/registry/{entry}',
        'GET api/college/staff/records',
        'GET api/college/staff/invitations',
        'POST api/college/staff/invitations',
        'POST api/college/staff/invitations/{invitation}/link',
        'DELETE api/college/staff/invitations/{invitation}',
        'DELETE api/college/staff/{user}',
        'POST api/compliance/organizations/{organization}/reminders',
        'PATCH api/clearance-signatures/{clearanceSignature}',
        'POST api/account-profiles/invite',
        'PUT api/account-profiles/{profile}',
        'DELETE api/account-profiles/{profile}',
        'POST api/compliance/submissions/{submission}/document',
        'DELETE api/compliance/submissions/{submission}',
    ];

    public function handle(Request $request, Closure $next, string ...$roles): Response
    {
        $user = $request->user();

        if (! $user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        if (! in_array($user->role, $roles, true)) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        if ($user->isCollegeOfficeStaff() && in_array($this->routeKey($request), self::DEAN_ONLY, true)) {
            return response()->json(['message' => self::DEAN_ONLY_MESSAGE], 403);
        }

        return $next($request);
    }

    private function routeKey(Request $request): string
    {
        return ($request->isMethod('HEAD') ? 'GET' : $request->method()).' '.$request->route()?->uri();
    }
}
