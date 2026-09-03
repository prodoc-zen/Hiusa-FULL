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
        $tooManyRequests = fn (Request $request, array $headers) => response()->json([
            'message' => 'Too many requests. Please wait before trying again.',
        ], 429, $headers);

        $authenticatedKey = fn (Request $request) => $request->user()
            ? $request->user()->organization_id.':'.$request->user()->getAuthIdentifier()
            : $request->ip();

        RateLimiter::for('public', fn (Request $request) => Limit::perMinute(
            config('performance.rate_limits.public_per_minute'),
        )->by($request->ip())->response($tooManyRequests));

        RateLimiter::for('authenticated', function (Request $request) use ($tooManyRequests) {
            $perMinute = $request->isMethodSafe()
                ? config('performance.rate_limits.read_per_minute')
                : config('performance.rate_limits.write_per_minute');

            return Limit::perMinute($perMinute)
                ->by($request->user()->organization_id.':'.$request->user()->getAuthIdentifier())
                ->response($tooManyRequests);
        });

        RateLimiter::for('expensive', fn (Request $request) => Limit::perMinute(
            config('performance.rate_limits.expensive_per_minute'),
        )->by($request->user()->organization_id.':'.$request->user()->getAuthIdentifier())
            ->response($tooManyRequests));

        RateLimiter::for('login', function (Request $request) use ($tooManyRequests) {
            $limits = [Limit::perMinute(config('performance.rate_limits.login_per_minute'))
                ->by($request->ip())->response($tooManyRequests)];

            if ($request->filled(['organization_id', 'school_id'])) {
                $limits[] = Limit::perMinute(max(3, (int) ceil(config('performance.rate_limits.login_per_minute') / 2)))
                    ->by('account:'.$request->input('organization_id').':'.$request->input('school_id'))
                    ->response($tooManyRequests);
            }

            return $limits;
        });

        RateLimiter::for('password', function (Request $request) use ($tooManyRequests) {
            $limits = [Limit::perMinute(config('performance.rate_limits.password_per_minute'))
                ->by($request->ip())->response($tooManyRequests)];

            if ($request->filled(['organization_id', 'email'])) {
                $limits[] = Limit::perMinute(config('performance.rate_limits.password_per_minute'))
                    ->by('recovery:'.$request->input('organization_id').':'.strtolower((string) $request->input('email')))
                    ->response($tooManyRequests);
            }

            return $limits;
        });

        RateLimiter::for('registration', fn (Request $request) => Limit::perMinute(
            config('performance.rate_limits.registration_per_minute'),
        )->by($request->ip())->response($tooManyRequests));

        // Authenticated limits are keyed by organization and primary user key,
        // not IP, because many campus users can share a single NAT address.
        RateLimiter::for('api-read', fn (Request $request) => Limit::perMinute(
            config('performance.rate_limits.read_per_minute'),
        )->by($authenticatedKey($request))->response($tooManyRequests));

        RateLimiter::for('api-write', fn (Request $request) => Limit::perMinute(
            config('performance.rate_limits.write_per_minute'),
        )->by($authenticatedKey($request))->response($tooManyRequests));

        // AI generation routes proxy to an LLM with a long timeout - a much
        // tighter, clearly separate limit so one account can't rack up expensive
        // third-party calls or tie up the request-handling workers.
        RateLimiter::for('ai-generation', fn (Request $request) => Limit::perMinute(5)
            ->by($authenticatedKey($request))->response($tooManyRequests));

        // Double-voting is already prevented at the schema level, so this limit is
        // purely about load during an election window, not integrity - generous
        // enough that a student submitting a multi-position ballot never trips it.
        RateLimiter::for('voting', fn (Request $request) => Limit::perMinute(20)
            ->by($authenticatedKey($request))->response($tooManyRequests));

        // Event check-in is bursty in a way the shared api-write bucket isn't
        // built for: one officer at the door can log a student every couple of
        // seconds, which blows past 30/min well before the desk line does.
        RateLimiter::for('attendance', fn (Request $request) => Limit::perMinute(120)
            ->by($authenticatedKey($request))->response($tooManyRequests));
    }
}
