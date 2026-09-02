<?php

namespace App\Providers;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Response headers appropriate for a JSON API served to a separate frontend.
 * Deliberately no Content-Security-Policy here: this API only ever serves
 * JSON, and a CSP written for an HTML app would be wrong on every response.
 */
class SecurityHeadersMiddleware
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        $response->headers->set('X-Content-Type-Options', 'nosniff');
        $response->headers->set('X-Frame-Options', 'DENY');
        $response->headers->set('Referrer-Policy', 'same-origin');

        return $response;
    }
}
