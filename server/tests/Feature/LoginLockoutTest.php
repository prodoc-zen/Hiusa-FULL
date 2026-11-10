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
}
