<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Keeps a view-only seat (an adviser who oversees without editing) to reading. Every request that is not a read is
 * refused unless it is one of the person's own routes below: signing out, their password, profile and notification
 * settings, switching workspace, reading notices and asking the assistant a question. The list is an allow list on
 * purpose, so a write route added later is closed to a view-only seat until somebody opens it here.
 */
class EnsureProfileCanWrite
{
    public const MESSAGE = 'This seat is view only. You can see the records but not change them.';

    private const OWN_ROUTES = [
        'POST' => [
            'api/logout', 'api/user/privacy-consent', 'api/user/profiles/{profile}/switch', 'api/announcements/{id}/view',
            'api/ai/assistant/ask', 'api/ai/assistant/chat', 'api/ai/assistant/memories',
            'api/ai/assistant/messages/{message}/feedback', 'api/ai/assistant/messages/{message}/action/cancel',
            'api/ai/outputs/{aiOutput}/outcome',
        ],
        'PUT' => ['api/user/profile', 'api/user/password', 'api/user/notification-preferences', 'api/announcements/{id}/reaction'],
        'PATCH' => ['api/notifications/read-all', 'api/notifications/{id}/read', 'api/ai/assistant/conversations/{conversation}'],
        'DELETE' => [
            'api/announcements/{id}/reaction', 'api/ai/assistant/conversations', 'api/ai/assistant/conversations/{conversation}',
            'api/ai/assistant/memories', 'api/ai/assistant/memories/{memory}',
        ],
    ];

    public function handle(Request $request, Closure $next): Response
    {
        $profile = $request->user()?->activeProfile();

        if (! $profile?->view_only || $request->isMethodSafe()) {
            return $next($request);
        }

        $uri = $request->route()?->uri() ?? '';

        if (in_array($uri, self::OWN_ROUTES[$request->method()] ?? [], true)) {
            return $next($request);
        }

        return response()->json(['message' => self::MESSAGE], 403);
    }
}
