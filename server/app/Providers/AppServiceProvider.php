<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // Keyed on user id, not IP: a campus network puts many students behind one
        // shared/NAT'd IP, and throttling by IP would treat the whole campus as
        // one caller. Guests (only relevant to the /organizations lookup) fall
        // back to IP since there is no user id yet.
        RateLimiter::for('api-read', function (Request $request) {
            return Limit::perMinute(120)->by($request->user()?->id ?: $request->ip());
        });

        RateLimiter::for('api-write', function (Request $request) {
            return Limit::perMinute(30)->by($request->user()?->id ?: $request->ip());
        });

        // AI generation routes proxy to an LLM with a long timeout - a much
        // tighter, clearly separate limit so one account can't rack up expensive
        // third-party calls or tie up the request-handling workers.
        RateLimiter::for('ai-generation', function (Request $request) {
            return Limit::perMinute(5)->by($request->user()?->id ?: $request->ip());
        });

        // Double-voting is already prevented at the schema level, so this limit is
        // purely about load during an election window, not integrity - generous
        // enough that a student submitting a multi-position ballot never trips it.
        RateLimiter::for('voting', function (Request $request) {
            return Limit::perMinute(20)->by($request->user()?->id ?: $request->ip());
        });
    }
}
