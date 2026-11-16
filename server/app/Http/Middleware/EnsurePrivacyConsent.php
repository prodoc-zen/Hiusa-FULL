<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Keeps a person's data away from the language model until they have agreed to the current Data Privacy Notice: no
 * agreement on record, or an agreement to an older version, answers 403 with a code the client turns into the notice.
 */
class EnsurePrivacyConsent
{
    public const CODE = 'privacy_consent_required';

    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (! $user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        if ($user->privacy_accepted_at === null || $user->privacy_notice_version !== (string) config('hiusa.privacy_notice_version')) {
            return response()->json(['success' => false, 'code' => self::CODE, 'message' => 'Please accept the privacy notice first.'], 403);
        }

        return $next($request);
    }
}
