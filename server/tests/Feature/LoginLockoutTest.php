<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class LoginLockoutTest extends TestCase
{
    use RefreshDatabase;

    private function signInFrom(string $ip, int $schoolId, string $password)
    {
        return $this->withServerVariables(['REMOTE_ADDR' => $ip])
            ->postJson('/api/login', ['school_id' => $schoolId, 'password' => $password]);
    }

    public function test_a_stranger_failing_five_times_does_not_lock_the_owner_out(): void
    {
        $owner = User::factory()->student()->create(['school_id' => 990001, 'password_hash' => 'right-password']);

        for ($attempt = 0; $attempt < 5; $attempt++) {
            $this->signInFrom('203.0.113.9', $owner->school_id, 'wrong-password')->assertStatus(422);
        }

        $this->signInFrom('198.51.100.20', $owner->school_id, 'right-password')->assertOk();
    }

    public function test_the_same_address_stays_locked_after_five_failures_for_the_full_window(): void
    {
        $owner = User::factory()->student()->create(['school_id' => 990002, 'password_hash' => 'right-password']);

        for ($attempt = 0; $attempt < 5; $attempt++) {
            $this->signInFrom('203.0.113.9', $owner->school_id, 'wrong-password')->assertStatus(422);
        }

        $this->travel(2)->minutes();

        $this->signInFrom('203.0.113.9', $owner->school_id, 'right-password')
            ->assertStatus(429)
            ->assertJsonPath('message', 'Too many failed sign in attempts for this account. Please wait before trying again.');
    }

    public function test_twenty_five_failures_from_different_addresses_lock_the_account_for_everyone(): void
    {
        $owner = User::factory()->student()->create(['school_id' => 990003, 'password_hash' => 'right-password']);

        for ($attempt = 1; $attempt <= 24; $attempt++) {
            $this->signInFrom('203.0.113.'.$attempt, $owner->school_id, 'wrong-password')->assertStatus(422);
        }

        $this->signInFrom('198.51.100.20', $owner->school_id, 'right-password')->assertOk();

        $this->app['auth']->forgetGuards();
        for ($attempt = 1; $attempt <= 25; $attempt++) {
            $this->signInFrom('203.0.114.'.$attempt, $owner->school_id, 'wrong-password')->assertStatus(422);
        }

        $this->signInFrom('198.51.100.21', $owner->school_id, 'right-password')
            ->assertStatus(429)
            ->assertHeader('Retry-After');

        $this->travel(16)->minutes();

        $this->signInFrom('198.51.100.21', $owner->school_id, 'right-password')->assertOk();
    }

    public function test_an_owner_who_signed_in_before_from_an_address_still_gets_in_while_other_addresses_exceed_the_account_cap(): void
    {
        $owner = User::factory()->student()->create(['school_id' => 990005, 'password_hash' => 'right-password']);
        $this->signInFrom('198.51.100.20', $owner->school_id, 'right-password')->assertOk();

        $this->app['auth']->forgetGuards();
        for ($attempt = 1; $attempt <= 25; $attempt++) {
            $this->signInFrom('203.0.114.'.$attempt, $owner->school_id, 'wrong-password')->assertStatus(422);
        }

        $this->signInFrom('198.51.100.21', $owner->school_id, 'right-password')->assertStatus(429);
        $this->signInFrom('198.51.100.20', $owner->school_id, 'right-password')->assertOk();
    }

    public function test_an_address_the_owner_never_signed_in_from_is_refused_once_the_account_cap_is_hit(): void
    {
        $owner = User::factory()->student()->create(['school_id' => 990006, 'password_hash' => 'right-password']);

        for ($attempt = 1; $attempt <= 25; $attempt++) {
            $this->signInFrom('203.0.114.'.$attempt, $owner->school_id, 'wrong-password')->assertStatus(422);
        }

        $this->signInFrom('198.51.100.20', $owner->school_id, 'right-password')->assertStatus(429);
    }

    public function test_a_known_address_is_still_held_by_the_five_failure_limit(): void
    {
        $owner = User::factory()->student()->create(['school_id' => 990007, 'password_hash' => 'right-password']);
        $this->signInFrom('198.51.100.20', $owner->school_id, 'right-password')->assertOk();

        $this->app['auth']->forgetGuards();
        $this->travel(2)->minutes();
        for ($attempt = 0; $attempt < 5; $attempt++) {
            $this->signInFrom('198.51.100.20', $owner->school_id, 'wrong-password')->assertStatus(422);
        }

        $this->travel(2)->minutes();

        $this->signInFrom('198.51.100.20', $owner->school_id, 'right-password')->assertStatus(429);
    }

    public function test_two_spellings_that_resolve_to_one_account_share_the_failure_counter(): void
    {
        $owner = User::factory()->student()->create(['school_id' => 990004, 'email' => 'owner@example.test', 'password_hash' => 'right-password']);

        for ($attempt = 0; $attempt < 3; $attempt++) {
            $this->signInFrom('203.0.113.9', $owner->school_id, 'wrong-password')->assertStatus(422);
        }
        for ($attempt = 0; $attempt < 2; $attempt++) {
            $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.9'])
                ->postJson('/api/login', ['identifier' => ' Owner@Example.test ', 'password' => 'wrong-password'])->assertStatus(422);
        }

        $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.9'])
            ->postJson('/api/login', ['identifier' => 'owner@example.test', 'password' => 'right-password'])
            ->assertStatus(429);
    }
}
