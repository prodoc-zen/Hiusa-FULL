<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Sits after the role check on a finance write route that an officer may use. The Admin passes as before; an SBO
 * officer passes only when their position has its "Can handle finance" switch on. Every other role is the role
 * middleware's to decide, so a student reading their own accounts on a shared route is not touched here.
 */
class EnsureFinanceWriter
{
    public const MESSAGE = 'Your position cannot handle finance. Ask your Admin.';

    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (! $user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        if ($user->role === 'SBO_OFFICER' && ! $user->canHandleFinance()) {
            return response()->json(['message' => self::MESSAGE], 403);
        }

        return $next($request);
    }
}
