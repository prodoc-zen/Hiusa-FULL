<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

class LoginThrottleTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        Cache::flush();
    }

    private function attempt(int $schoolId, string $password, string $ip, array $extra = [])
    {
        return $this->withServerVariables(['REMOTE_ADDR' => $ip])->postJson('/api/login', [
            'school_id' => $schoolId,
            'password' => $password,
        ] + $extra);
    }

    public function test_one_account_is_throttled_across_ips_and_random_organization_ids(): void
    {
        $user = User::factory()->create(['password_hash' => bcrypt('correct-horse')]);

        for ($i = 1; $i <= 5; $i++) {
            $this->attempt($user->school_id, 'wrong-'.$i, '10.0.0.'.$i, ['organization_id' => 1000 + $i])
                ->assertStatus(422);
        }

        $this->attempt($user->school_id, 'correct-horse', '10.0.0.99', ['organization_id' => 5000])
            ->assertTooManyRequests()
            ->assertJsonStructure(['message']);
    }

    public function test_unknown_school_ids_are_throttled_the_same_way(): void
    {
        for ($i = 1; $i <= 5; $i++) {
            $this->attempt(77777777, 'wrong-'.$i, '10.1.0.'.$i)->assertStatus(422);
        }

        $this->attempt(77777777, 'wrong-6', '10.1.0.50')->assertTooManyRequests();
    }

    public function test_other_school_ids_are_unaffected_by_a_throttled_account(): void
    {
        $locked = User::factory()->create(['password_hash' => bcrypt('correct-horse')]);
        $other = User::factory()->create(['password_hash' => bcrypt('other-secret')]);

        for ($i = 1; $i <= 5; $i++) {
            $this->attempt($locked->school_id, 'wrong-'.$i, '10.2.0.'.$i)->assertStatus(422);
        }

        $this->attempt($locked->school_id, 'correct-horse', '10.2.0.60')->assertTooManyRequests();
        $this->attempt($other->school_id, 'other-secret', '10.2.0.61')->assertOk();
    }

    public function test_a_correct_login_under_the_limit_works_and_clears_the_failure_counter(): void
    {
        $user = User::factory()->create(['password_hash' => bcrypt('correct-horse')]);

        for ($i = 1; $i <= 4; $i++) {
            $this->attempt($user->school_id, 'wrong-'.$i, '10.3.0.'.$i)->assertStatus(422);
        }

        $this->attempt($user->school_id, 'correct-horse', '10.3.0.10')->assertOk();

        $this->travel(61)->seconds();

        for ($i = 1; $i <= 4; $i++) {
            $this->attempt($user->school_id, 'wrong-again-'.$i, '10.3.0.'.(20 + $i))->assertStatus(422);
        }
    }

    public function test_the_failure_backoff_lasts_fifteen_minutes_and_then_lifts(): void
    {
        $user = User::factory()->create(['password_hash' => bcrypt('correct-horse')]);

        for ($i = 1; $i <= 5; $i++) {
            $this->attempt($user->school_id, 'wrong-'.$i, '10.4.0.'.$i)->assertStatus(422);
        }

        $this->travel(5)->minutes();
        $this->attempt($user->school_id, 'correct-horse', '10.4.0.50')->assertTooManyRequests();

        $this->travel(11)->minutes();
        $this->attempt($user->school_id, 'correct-horse', '10.4.0.51')->assertOk();
    }
}
