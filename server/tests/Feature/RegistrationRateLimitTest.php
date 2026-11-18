<?php

namespace Tests\Feature;

use App\Mail\PasswordResetMail;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Mail;
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

    public function test_password_recovery_is_limited_per_account_across_the_hour_not_just_per_address(): void
    {
        config()->set('performance.rate_limits.password_per_minute', 100);
        config()->set('performance.rate_limits.password_per_identifier_per_hour', 5);

        for ($call = 0; $call < 5; $call++) {
            $this->assertNotSame(429, $this->postJson('/api/password/forgot', [
                'identifier' => '20000001',
            ])->getStatusCode(), "Recovery call {$call} for one account was rate limited.");
        }

        $this->postJson('/api/password/forgot', ['identifier' => '20000001'])->assertTooManyRequests();
        $this->assertNotSame(429, $this->postJson('/api/password/forgot', ['identifier' => '20000002'])->getStatusCode());
        $this->assertNotSame(429, $this->postJson('/api/password/forgot', [
            'organization_id' => 1,
            'email' => 'someone@example.edu',
        ])->getStatusCode());
    }

    public function test_every_lookup_shape_forgot_accepts_shares_one_hourly_bucket_per_account(): void
    {
        config()->set('performance.rate_limits.password_per_minute', 100);
        config()->set('performance.rate_limits.password_per_identifier_per_hour', 5);

        foreach ([
            'school id and email' => [['school_id' => 20000001, 'email' => 'a@example.edu'], ['school_id' => 20000002, 'email' => 'a@example.edu']],
            'organization and email' => [['organization_id' => 1, 'email' => 'b@example.edu'], ['organization_id' => 1, 'email' => 'c@example.edu']],
            'email alone' => [['email' => 'd@example.edu'], ['email' => 'e@example.edu']],
        ] as $shape => [$account, $other]) {
            for ($call = 0; $call < 5; $call++) {
                $this->assertNotSame(429, $this->postJson('/api/password/forgot', $account)->getStatusCode(), "{$shape} call {$call} was rate limited.");
            }

            $this->postJson('/api/password/forgot', $account)->assertTooManyRequests();
            $this->assertNotSame(429, $this->postJson('/api/password/forgot', $other)->getStatusCode(), "{$shape} locked out a different account.");
        }
    }

    public function test_the_same_account_named_by_identifier_or_school_id_shares_one_bucket(): void
    {
        config()->set('performance.rate_limits.password_per_minute', 100);
        config()->set('performance.rate_limits.password_per_identifier_per_hour', 5);

        foreach ([['identifier' => '20000001'], ['school_id' => 20000001, 'email' => 'a@example.edu'], ['identifier' => '2000-0001'], ['school_id' => 20000001, 'email' => 'a@example.edu'], ['identifier' => '20000001']] as $body) {
            $this->assertNotSame(429, $this->postJson('/api/password/forgot', $body)->getStatusCode());
        }

        $this->postJson('/api/password/forgot', ['school_id' => 20000001, 'email' => 'a@example.edu'])->assertTooManyRequests();
    }

    public function test_rotating_lookup_shapes_for_one_real_account_cannot_beat_the_hourly_limit(): void
    {
        Mail::fake();
        config(['app.frontend_url' => 'https://hiusa.example.test']);
        config()->set('performance.rate_limits.password_per_minute', 100);
        config()->set('performance.rate_limits.password_per_identifier_per_hour', 5);

        $user = User::factory()->create(['email' => 'victim@example.edu', 'school_id' => 20000001]);
        $shapes = [
            ['identifier' => 'victim@example.edu'],
            ['organization_id' => $user->organization_id, 'email' => 'victim@example.edu'],
            ['organization_id' => '+'.$user->organization_id, 'email' => 'victim@example.edu'],
            ['identifier' => '20000001'],
            ['school_id' => 20000001, 'email' => 'victim@example.edu'],
        ];

        foreach ($shapes as $call => $body) {
            $this->assertNotSame(429, $this->postJson('/api/password/forgot', $body)->getStatusCode(), "Call {$call} was rate limited.");
        }

        foreach ($shapes as $call => $body) {
            $this->postJson('/api/password/forgot', $body)->assertTooManyRequests();
        }

        Mail::assertQueued(PasswordResetMail::class, 5);
    }

    public function test_a_json_true_organization_id_cannot_move_the_bucket_to_another_account_sharing_the_email(): void
    {
        Mail::fake();
        config(['app.frontend_url' => 'https://hiusa.example.test']);
        config()->set('performance.rate_limits.password_per_minute', 100);
        config()->set('performance.rate_limits.password_per_identifier_per_hour', 5);

        // The controller's integer rule accepts JSON true as 1, so the limiter has to resolve it the same way.
        $accountA = User::factory()->create(['email' => 'dup@example.edu', 'school_id' => 20000019]);
        $this->assertSame(1, (int) $accountA->organization_id);
        $otherOrganization = Organization::factory()->create(['is_active' => true]);
        User::factory()->create(['email' => 'dup@example.edu', 'school_id' => 20000012, 'organization_id' => $otherOrganization->id]);

        $statuses = [];
        for ($call = 0; $call < 10; $call++) {
            $body = $call % 2 === 0
                ? ['organization_id' => $accountA->organization_id, 'email' => 'dup@example.edu']
                : ['organization_id' => true, 'email' => 'dup@example.edu'];
            $statuses[] = $this->postJson('/api/password/forgot', $body)->getStatusCode();
        }

        $this->assertNotContains(429, array_slice($statuses, 0, 5), 'A call inside the hourly allowance was limited.');
        $this->assertSame(429, $statuses[5]);
        $this->assertLessThanOrEqual(5, Mail::queued(PasswordResetMail::class, fn ($mail) => $mail->user->school_id === 20000019)->count());
    }

    public function test_recovery_input_that_is_not_a_scalar_is_refused_without_an_error(): void
    {
        config()->set('performance.rate_limits.password_per_minute', 100);

        foreach ([
            ['identifier' => ['a']],
            ['organization_id' => ['1'], 'email' => 'someone@example.edu'],
            ['school_id' => ['1'], 'email' => ['someone@example.edu']],
        ] as $body) {
            $this->assertSame(422, $this->postJson('/api/password/forgot', $body)->getStatusCode());
        }
    }

    public function test_reset_validation_and_reset_are_not_held_to_the_hourly_mail_limit(): void
    {
        config()->set('performance.rate_limits.password_per_minute', 100);
        config()->set('performance.rate_limits.password_per_identifier_per_hour', 5);

        $body = ['organization_id' => 1, 'email' => 'student@example.edu', 'token' => 'not-a-real-token'];

        for ($call = 0; $call < 8; $call++) {
            $this->assertNotSame(429, $this->postJson('/api/password/reset/validate', $body)->getStatusCode(), "Validate call {$call} was rate limited.");
            $this->assertNotSame(429, $this->postJson('/api/password/reset', $body + ['password' => 'x', 'password_confirmation' => 'x'])->getStatusCode(), "Reset call {$call} was rate limited.");
        }

        $this->assertNotSame(429, $this->postJson('/api/password/forgot', ['organization_id' => 1, 'email' => 'student@example.edu'])->getStatusCode());
    }

    public function test_the_per_account_hourly_limit_ships_at_five(): void
    {
        $this->assertSame(5, $this->shippedLimit('RATE_LIMIT_PASSWORD_PER_IDENTIFIER_PER_HOUR'));
    }
}
