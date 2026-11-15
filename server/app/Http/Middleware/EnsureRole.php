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
     * User::getRoleAttribute) and do everything the dean does in their own name, so the list is empty. It stays so a
     * future dean-only route has one place to go. The SAO and system routes and user management need a role staff
     * never take, so they are not listed here either.
     */
    public const DEAN_ONLY = [];

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
