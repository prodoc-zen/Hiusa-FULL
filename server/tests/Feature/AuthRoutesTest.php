<?php

namespace Tests\Feature;

use App\Mail\PasswordResetMail;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

class AuthRoutesTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_can_register_without_explicit_role(): void
    {
        $organization = Organization::factory()->create();

        $response = $this->postJson('/api/register', [
            'organization_id' => $organization->id,
            'school_id' => 1001,
            'first_name' => 'Ada',
            'last_name' => 'Lovelace',
            'email' => 'ada@example.com',
            'password' => 'password123',
            'password_confirmation' => 'password123',
        ]);

        $response
            ->assertCreated()
            ->assertJsonPath('user.email', 'ada@example.com')
            ->assertJsonPath('user.role', 'STUDENT')
            ->assertJsonStructure(['access_token', 'token_type', 'user']);

        $this->assertDatabaseHas('users', [
            'school_id' => 1001,
            'email' => 'ada@example.com',
            'role' => 'STUDENT',
        ]);
    }

    public function test_user_can_login_and_access_authenticated_user_route(): void
    {
        $user = User::factory()->create([
            'email' => 'student@example.com',
            'school_id' => 10020030,
            'password_hash' => 'password123',
        ]);

        $login = $this->postJson('/api/login', [
            'organization_id' => $user->organization_id,
            'school_id' => 10020030,
            'password' => 'password123',
        ]);

        $login
            ->assertOk()
            ->assertJsonStructure(['access_token', 'token_type', 'user']);

        $this->withToken($login->json('access_token'))
            ->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('email', 'student@example.com');
    }

    public function test_login_infers_role_from_school_id(): void
    {
        $admin = User::factory()->create([
            'role' => 'ADMIN',
            'school_id' => 99887766,
            'password_hash' => 'password123',
        ]);

        $this->postJson('/api/login', [
            'organization_id' => $admin->organization_id,
            'school_id' => 99887766,
            'password' => 'password123',
        ])
            ->assertOk()
            ->assertJsonPath('user.role', 'ADMIN')
            ->assertJsonStructure(['access_token', 'token_type', 'user']);
    }

    public function test_inactive_user_cannot_login(): void
    {
        $user = User::factory()->create([
            'email' => 'inactive@example.com',
            'school_id' => 11002200,
            'password_hash' => 'password123',
            'account_status' => 'disabled',
        ]);

        $this->postJson('/api/login', [
            'organization_id' => $user->organization_id,
            'school_id' => 11002200,
            'password' => 'password123',
        ])
            ->assertForbidden()
            ->assertJsonPath('account_status', 'disabled');
    }

    public function test_inactive_organization_cannot_be_used_for_authentication(): void
    {
        $organization = Organization::factory()->create(['is_active' => false]);
        $user = User::factory()->create([
            'organization_id' => $organization->id,
            'school_id' => 11002201,
            'password_hash' => 'password123',
        ]);

        $this->postJson('/api/login', [
            'organization_id' => $organization->id,
            'school_id' => $user->school_id,
            'password' => 'password123',
        ])->assertUnprocessable();
    }

    public function test_user_can_recover_account_and_set_new_password(): void
    {
        Mail::fake();

        $user = User::factory()->create([
            'email' => 'recover@example.com',
            'password_hash' => 'old-password',
            'account_status' => 'active',
        ]);

        $request = $this->postJson('/api/password/forgot', [
            'organization_id' => $user->organization_id,
            'email' => 'recover@example.com',
        ]);

        $request
            ->assertOk()
            ->assertJsonStructure(['message'])
            ->assertJsonMissing(['reset_url'])
            ->assertJsonMissing(['token']);

        $resetUrl = null;

        Mail::assertSent(PasswordResetMail::class, function (PasswordResetMail $mail) use (&$resetUrl) {
            $resetUrl = $mail->resetUrl;

            return $mail->hasTo('recover@example.com')
                && str_contains($mail->resetUrl, '/reset-password?')
                && $mail->expiresInMinutes === 60;
        });

        parse_str((string) parse_url($resetUrl, PHP_URL_QUERY), $resetQuery);
        $token = $resetQuery['token'] ?? null;

        $this->assertNotEmpty($token);

        $this->postJson('/api/password/reset/validate', [
            'organization_id' => $user->organization_id,
            'email' => 'recover@example.com',
            'token' => $token,
        ])->assertOk();

        $this->postJson('/api/password/reset', [
            'organization_id' => $user->organization_id,
            'email' => 'recover@example.com',
            'token' => $token,
            'password' => 'new-password',
            'password_confirmation' => 'new-password',
        ])->assertOk();

        $this->postJson('/api/login', [
            'organization_id' => $user->organization_id,
            'school_id' => $user->school_id,
            'password' => 'new-password',
        ])->assertOk();

        $this->assertDatabaseMissing('password_reset_tokens', [
            'organization_id' => $user->organization_id,
            'email' => 'recover@example.com',
        ]);

        $this->postJson('/api/password/reset/validate', [
            'organization_id' => $user->organization_id,
            'email' => 'recover@example.com',
            'token' => $token,
        ])->assertUnprocessable();
    }

    public function test_expired_password_reset_token_is_rejected(): void
    {
        $user = User::factory()->create([
            'email' => 'expired-reset@example.com',
            'account_status' => 'active',
        ]);

        DB::table('password_reset_tokens')->insert([
            'organization_id' => $user->organization_id,
            'email' => $user->email,
            'token' => Hash::make('expired-token'),
            'created_at' => now()->subMinutes(61),
        ]);

        $this->postJson('/api/password/reset/validate', [
            'organization_id' => $user->organization_id,
            'email' => $user->email,
            'token' => 'expired-token',
        ])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'Password reset token is invalid or expired.');
    }

    public function test_password_recovery_does_not_reveal_whether_an_account_exists(): void
    {
        Mail::fake();
        $organization = Organization::factory()->create();

        $this->postJson('/api/password/forgot', [
            'organization_id' => $organization->id,
            'email' => 'missing@example.com',
        ])->assertOk()
            ->assertJsonStructure(['message']);

        Mail::assertNothingSent();
    }

    public function test_all_roles_can_update_their_own_profile(): void
    {
        foreach (['ADMIN', 'SBO_OFFICER', 'STUDENT', 'DEPARTMENT_HEAD'] as $role) {
            $this->flushHeaders();
            $this->app['auth']->forgetGuards();

            $user = User::factory()->create([
                'role' => $role,
                'email' => strtolower($role).'@example.com',
            ]);

            $this->withToken($user->createToken('profile-test')->plainTextToken)
                ->putJson('/api/user/profile', [
                    'first_name' => 'Updated',
                    'last_name' => str_replace('_', '', ucwords(strtolower($role), '_')),
                    'email' => 'updated-'.strtolower($role).'@example.com',
                ])
                ->assertOk()
                ->assertJsonPath('first_name', 'Updated')
                ->assertJsonPath('email', 'updated-'.strtolower($role).'@example.com');
        }
    }

    public function test_all_roles_can_change_their_password(): void
    {
        foreach (['ADMIN', 'SBO_OFFICER', 'STUDENT', 'DEPARTMENT_HEAD'] as $role) {
            $this->flushHeaders();
            $this->app['auth']->forgetGuards();

            $user = User::factory()->create([
                'role' => $role,
                'email' => 'password-'.strtolower($role).'@example.com',
                'password_hash' => Hash::make('current-password'),
            ]);

            $this->assertTrue(Hash::check('current-password', $user->password_hash), $role.' password fixture is invalid.');

            $response = $this->withToken($user->createToken('password-test')->plainTextToken)
                ->putJson('/api/user/password', [
                    'current_password' => 'current-password',
                    'password' => 'updated-password',
                    'password_confirmation' => 'updated-password',
                ]);

            $this->assertTrue($response->isOk(), $role.': '.json_encode($response->json()));

            $this->postJson('/api/login', [
                'organization_id' => $user->organization_id,
                'school_id' => $user->school_id,
                'password' => 'updated-password',
            ])->assertOk();

            $this->app['auth']->forgetGuards();
        }

        $this->flushHeaders();
    }

    public function test_no_prefix_auth_aliases_accept_requests(): void
    {
        $user = User::factory()->create([
            'email' => 'alias@example.com',
            'school_id' => 44332211,
            'password_hash' => 'password123',
        ]);

        $this->postJson('/login', [
            'organization_id' => $user->organization_id,
            'school_id' => 44332211,
            'password' => 'password123',
        ])
            ->assertOk()
            ->assertJsonStructure(['access_token', 'token_type', 'user']);
    }

    public function test_auth_routes_accept_cors_preflight_requests(): void
    {
        $this->withHeaders([
            'Origin' => 'http://localhost:5173',
            'Access-Control-Request-Method' => 'POST',
            'Access-Control-Request-Headers' => 'content-type',
        ])->options('/api/login')
            ->assertNoContent()
            ->assertHeader('Access-Control-Allow-Origin', 'http://localhost:5173');

        $this->withHeaders([
            'Origin' => 'http://localhost:5173',
            'Access-Control-Request-Method' => 'POST',
            'Access-Control-Request-Headers' => 'content-type',
        ])->options('/login')
            ->assertNoContent()
            ->assertHeader('Access-Control-Allow-Origin', 'http://localhost:5173');
    }
}
