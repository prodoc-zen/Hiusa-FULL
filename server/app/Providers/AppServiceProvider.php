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

        RateLimiter::for('public', fn (Request $request) => Limit::perMinute(
            config('performance.rate_limits.public_per_minute'),
        )->by($request->ip())->response($tooManyRequests));

        RateLimiter::for('authenticated', function (Request $request) use ($tooManyRequests) {
            $userKey = $request->user()
                ? $request->user()->organization_id.':'.$request->user()->getAuthIdentifier()
                : $request->ip();
            $perMinute = $request->isMethodSafe()
                ? config('performance.rate_limits.read_per_minute')
                : config('performance.rate_limits.write_per_minute');

            return Limit::perMinute($perMinute)->by($userKey)->response($tooManyRequests);
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
    }
}
