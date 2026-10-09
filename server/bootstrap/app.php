<?php

use App\Http\Middleware\CacheApiResponse;
use App\Http\Middleware\EnsureOrganizationWritable;
use App\Http\Middleware\EnsureRole;
use App\Http\Middleware\LogRequestDetails;
use App\Http\Middleware\SecurityHeadersMiddleware;
use App\Http\Middleware\UseAccountProfile;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
        // Wave B slice S2 (event registrations) is not allowed to touch
        // routes/api.php, which another slice owns this wave. `then` runs in
        // the same routing-boot pass right after the api file loads, so this
        // group gets the same 'api' middleware + '/api' prefix withRouting()
        // already applies to $api above.
        then: function () {
            Route::middleware('api')->prefix('api')->group(__DIR__.'/../routes/api_event_registrations.php');
        },
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Production sets this to "*" because the container is reachable only
        // through Caddy. Local/direct servers trust no proxy by default.
        if ($trustedProxies = getenv('TRUSTED_PROXIES')) {
            $middleware->trustProxies(at: $trustedProxies);
        }

        $middleware->redirectGuestsTo(fn (Request $request) => $request->is('api/*') ? null : '/login');
        $middleware->append(LogRequestDetails::class);
        // Global, not api(append: ...): Authenticate and ThrottleRequests both sit
        // ahead of api-group middleware in Laravel's priority sort, so registering
        // this there left 401s, 404s and 429s without the headers. Appending it to
        // the whole stack puts it outside that sort entirely.
        $middleware->append(SecurityHeadersMiddleware::class);

        $middleware->alias([
            'cache.api' => CacheApiResponse::class,
            'role' => EnsureRole::class,
            'org.writable' => EnsureOrganizationWritable::class,
            'account.profile' => UseAccountProfile::class,
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
