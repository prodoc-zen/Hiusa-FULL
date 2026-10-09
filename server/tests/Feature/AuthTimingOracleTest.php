<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Hashing\HashManager;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

class AuthTimingOracleTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        Cache::flush();
    }

    private function countingHasher(): object
    {
        $hasher = new class($this->app) extends HashManager
        {
            public int $makes = 0;

            public int $checks = 0;

            public function make(#[\SensitiveParameter] $value, array $options = [])
            {
                $this->makes++;

                return parent::make($value, $options);
            }

            public function check(#[\SensitiveParameter] $value, $hashedValue, array $options = [])
            {
                $this->checks++;

                return parent::check($value, $hashedValue, $options);
            }
        };

        Hash::swap($hasher);

        return $hasher;
    }

    public function test_login_runs_the_password_check_for_an_unknown_school_id(): void
    {
        $hasher = $this->countingHasher();

        $this->postJson('/api/login', ['school_id' => 66666666, 'password' => 'whatever-password'])
            ->assertStatus(422)
            ->assertJsonPath('errors.school_id.0', 'The provided credentials are incorrect.');

        $this->assertSame(1, $hasher->checks);
    }

    public function test_login_answers_identically_for_unknown_ids_and_wrong_passwords(): void
    {
        $user = User::factory()->create(['password_hash' => bcrypt('correct-horse')]);

        $wrong = $this->postJson('/api/login', ['school_id' => $user->school_id, 'password' => 'nope-nope']);
        $unknown = $this->postJson('/api/login', ['school_id' => 66666666, 'password' => 'nope-nope']);

        $this->assertSame($wrong->getStatusCode(), $unknown->getStatusCode());
        $this->assertSame($wrong->json(), $unknown->json());
    }

    public function test_forgot_password_does_equivalent_hashing_work_when_nothing_is_issued(): void
    {
        Mail::fake();
        $organization = Organization::factory()->create();

        $hasher = $this->countingHasher();

        $this->postJson('/api/password/forgot', [
            'organization_id' => $organization->id,
            'email' => 'missing@example.com',
        ])->assertOk();

        $this->assertSame(1, $hasher->makes);
        Mail::assertNothingOutgoing();
    }

    public function test_forgot_password_hashes_exactly_once_when_a_token_is_issued(): void
    {
        Mail::fake();
        $user = User::factory()->create(['email' => 'present@example.com', 'account_status' => 'active']);

        $hasher = $this->countingHasher();

        $this->postJson('/api/password/forgot', [
            'organization_id' => $user->organization_id,
            'email' => 'present@example.com',
        ])->assertOk();

        $this->assertSame(1, $hasher->makes);
    }

    public function test_forgot_password_answers_alike_for_unknown_inactive_and_active_organizations(): void
    {
        Mail::fake();
        $active = Organization::factory()->create(['is_active' => true]);
        $inactive = Organization::factory()->create(['is_active' => false]);
        User::factory()->create(['organization_id' => $active->id, 'email' => 'someone@example.com', 'account_status' => 'active']);

        $responses = collect([$active->id, $inactive->id, 987654])->map(
            fn ($organizationId) => $this->postJson('/api/password/forgot', [
                'organization_id' => $organizationId,
                'email' => 'someone@example.com',
            ])
        );

        $responses->each->assertOk();
        $this->assertCount(1, $responses->map(fn ($response) => $response->getContent())->unique());
    }

    public function test_reset_validation_answers_alike_for_unknown_and_inactive_organizations(): void
    {
        $inactive = Organization::factory()->create(['is_active' => false]);
        $active = Organization::factory()->create(['is_active' => true]);

        $bodies = collect([$inactive->id, $active->id, 987654])->map(function ($organizationId) {
            $response = $this->postJson('/api/password/reset/validate', [
                'organization_id' => $organizationId,
                'email' => 'someone@example.com',
                'token' => 'a-token',
            ]);

            $this->assertSame(422, $response->getStatusCode());

            return $response->getContent();
        });

        $this->assertCount(1, $bodies->unique());
    }

    public function test_reset_validation_does_not_validate_a_token_for_an_inactive_organization(): void
    {
        $inactive = Organization::factory()->create(['is_active' => false]);
        $user = User::factory()->create(['organization_id' => $inactive->id, 'email' => 'dormant@example.com']);

        DB::table('password_reset_tokens')->insert([
            'organization_id' => $inactive->id,
            'email' => $user->email,
            'token' => Hash::make('real-token'),
            'created_at' => now(),
        ]);

        $this->postJson('/api/password/reset/validate', [
            'organization_id' => $inactive->id,
            'email' => $user->email,
            'token' => 'real-token',
        ])->assertUnprocessable()
            ->assertJsonPath('message', 'Password reset token is invalid or expired.');
    }
}
