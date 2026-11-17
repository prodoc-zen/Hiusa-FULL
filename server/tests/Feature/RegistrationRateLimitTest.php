<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

class RegistrationRateLimitTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        Cache::flush();
    }

    private function shippedLimit(string $envKey): int
    {
        // The local .env and CI can override the limit, so read the default out of the config file.
        preg_match("/'{$envKey}', (\d+)/", file_get_contents(config_path('performance.php')), $shipped);

        return (int) $shipped[1];
    }

    public function test_a_classroom_of_students_signing_up_from_one_campus_address_is_not_throttled(): void
    {
        // Each sign-up is two calls (lookup, then register), so 30 students from one NAT address is 60 calls.
        config()->set('performance.rate_limits.registration_per_minute', $this->shippedLimit('RATE_LIMIT_REGISTRATION_PER_MINUTE'));

        for ($call = 0; $call < 60; $call++) {
            $this->assertNotSame(429, $this->postJson('/api/register/lookup', [
                'school_id' => 20000000 + $call,
                'birth_date' => '2004-01-01',
            ])->getStatusCode(), "Sign-up call {$call} was rate limited.");
        }

        $this->postJson('/api/register/lookup', ['school_id' => 29999999, 'birth_date' => '2004-01-01'])
            ->assertTooManyRequests();
    }

    public function test_password_recovery_allows_a_shared_address_a_realistic_burst(): void
    {
        config()->set('performance.rate_limits.password_per_minute', $this->shippedLimit('RATE_LIMIT_PASSWORD_PER_MINUTE'));

        for ($call = 0; $call < 30; $call++) {
            $this->assertNotSame(429, $this->postJson('/api/password/forgot', [
                'school_id' => 20000000 + $call,
            ])->getStatusCode(), "Password call {$call} was rate limited.");
        }

        $this->postJson('/api/password/forgot', ['school_id' => 29999999])->assertTooManyRequests();
    }
}
