<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsurePasswordChanged
{
    public function handle(Request $request, Closure $next): Response
    {
        if ($request->user()?->must_change_password && ! $this->isAllowed($request)) {
            return response()->json([
                'message' => 'You must change your password before continuing.',
                'error_code' => 'PASSWORD_CHANGE_REQUIRED',
            ], 403);
        }

        return $next($request);
    }

    private function isAllowed(Request $request): bool
    {
        return ($request->isMethod('GET') && $request->is('api/user'))
            || ($request->isMethod('PUT') && $request->is('api/user/password'))
            || ($request->isMethod('POST') && $request->is('api/logout'));
    }
}
