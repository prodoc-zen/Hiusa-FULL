<?php

use App\Http\Middleware\CacheApiResponse;
use App\Http\Middleware\EnsureRole;
use App\Http\Middleware\LogRequestDetails;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Production sets this to "*" because the container is reachable only
        // through Caddy. Local/direct servers trust no proxy by default.
        if ($trustedProxies = getenv('TRUSTED_PROXIES')) {
            $middleware->trustProxies(at: $trustedProxies);
        }

        $middleware->redirectGuestsTo(fn (Request $request) => $request->is('api/*') ? null : '/login');
        $middleware->append(LogRequestDetails::class);

        $middleware->alias([
            'cache.api' => CacheApiResponse::class,
            'role' => EnsureRole::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->render(function (AuthenticationException $exception, Request $request) {
            if ($request->is('api/*')) {
                return response()->json(['message' => 'Unauthenticated.'], 401);
            }

            return null;
        });
    })->create();
