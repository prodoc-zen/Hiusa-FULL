<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

class LogRequestDetails
{
    public function handle(Request $request, Closure $next): Response
    {
        $startedAt = microtime(true);

        /** @var Response $response */
        $response = $next($request);

        $duration = number_format((microtime(true) - $startedAt) * 1000, 2);
        $route = $request->route();
        $routeUri = $route?->uri() ?? 'unmatched';
        $action = $route?->getActionName() ?? 'unmatched';
        $userId = $request->user()?->getAuthIdentifier();

        $line = sprintf(
            '[HTTP] %s /%s -> %s %s %s %sms%s',
            $request->method(),
            ltrim($request->path(), '/'),
            $routeUri,
            $action,
            $response->getStatusCode(),
            $duration,
            $userId ? " user={$userId}" : '',
        );

        Log::info($line);

        if (app()->environment('local')) {
            $stderr = defined('STDERR') ? STDERR : fopen('php://stderr', 'wb');
            fwrite($stderr, $line.PHP_EOL);
        }

        return $response;
    }
}
