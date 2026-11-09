<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureRole
{
    /** Not a stored role: the Department Head, or the office staff the dean delegated to, for the college's own pages. */
    public const COLLEGE_OFFICE = 'COLLEGE_OFFICE';

    public function handle(Request $request, Closure $next, string ...$roles): Response
    {
        $user = $request->user();

        if (! $user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        // Office staff stand in for the dean, so they reach only the routes the dean's pages use, never account management.
        if ($user->isCollegeOfficeStaff() && ! in_array('DEPARTMENT_HEAD', $roles, true) && ! in_array(self::COLLEGE_OFFICE, $roles, true)) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        $allowed = in_array($user->role, $roles, true) || (in_array(self::COLLEGE_OFFICE, $roles, true) && $user->isCollegeOffice());

        if (! $allowed) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        return $next($request);
    }
}
