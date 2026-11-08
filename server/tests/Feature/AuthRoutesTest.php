<?php

namespace Tests\Feature;

use App\Mail\PasswordResetMail;
use App\Models\College;
use App\Models\Organization;
use App\Models\StudentRegistryEntry;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

class AuthRoutesTest extends TestCase
{
    public function test_unauthenticated_api_requests_return_json_even_without_accept_header(): void
    {
        $this->get('/api/events')
            ->assertUnauthorized()
            ->assertJsonPath('message', 'Unauthenticated.');
    }

    use RefreshDatabase;

    public function test_student_can_register_with_school_id_and_birth_date(): void
    {
        $college = College::create(['name' => 'College of Computer Studies', 'code' => 'CCS', 'is_active' => true]);
        Organization::factory()->create(['organization_type' => 'COLLEGE', 'college_id' => $college->id, 'college' => $college->name]);
        StudentRegistryEntry::create([
            'school_id' => 1001, 'first_name' => 'Ada', 'last_name' => 'Lovelace', 'birth_date' => '2005-12-10',
            'college_id' => $college->id, 'program' => 'BS Computer Science', 'year_level' => '2nd Year',
        ]);

        $response = $this->postJson('/api/register', [
            'school_id' => 1001,
            'birth_date' => '2005-12-10',
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
            'first_name' => 'Ada',
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

    public function test_authenticated_sessions_expire_after_four_hours(): void
    {
        $user = User::factory()->create(['password_hash' => 'password123']);
        $token = $this->postJson('/api/login', ['school_id' => $user->school_id, 'password' => 'password123'])
            ->assertOk()->assertJsonPath('session_expires_in_seconds', 14400)->json('access_token');

        $this->withToken($token)->getJson('/api/user')->assertOk();
        $this->travel(239)->minutes();
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->getJson('/api/user')->assertOk();
        $this->travel(2)->minutes();
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->getJson('/api/user')->assertUnauthorized();
    }

    public function test_login_infers_role_from_school_id(): void
    {
        $admin = User::factory()->create([
            'role' => 'ADMIN',
            'school_id' => 99887766,
            'password_hash' => 'password123',
        ]);

        $this->postJson('/api/login', [
            'school_id' => 99887766,
            'password' => 'password123',
        ])
            ->assertOk()
            ->assertJsonPath('user.role', 'ADMIN')
            ->assertJsonStructure(['access_token', 'token_type', 'user']);
    }

    public function test_sao_can_login_with_school_id_and_receives_the_super_admin_role(): void
    {
        $sao = Organization::where('slug', 'student-affairs-office')->firstOrFail();
        $director = User::factory()->create([
            'organization_id' => $sao->id,
            'role' => 'SUPER_ADMIN',
            'school_id' => 99000001,
            'email' => 'director@sao.example',
            'password_hash' => 'password123',
        ]);

        $this->postJson('/api/login', [
            'organization_id' => $sao->id,
            'school_id' => $director->school_id,
            'password' => 'password123',
        ])->assertOk()
            ->assertJsonPath('user.role', 'SUPER_ADMIN')
            ->assertJsonMissing(['password_hash']);
    }

    public function test_a_person_can_sign_in_with_their_email_in_any_case(): void
    {
        $user = User::factory()->departmentHead()->create([
            'email' => 'dean.reyes@example.edu',
            'password_hash' => 'password123',
        ]);

        foreach (['dean.reyes@example.edu', '  Dean.Reyes@Example.EDU '] as $identifier) {
            $this->postJson('/api/login', ['identifier' => $identifier, 'password' => 'password123'])
                ->assertOk()
                ->assertJsonPath('user.school_id', $user->school_id)
                ->assertJsonMissing(['password_hash']);
        }
    }

    public function test_a_person_can_sign_in_with_the_identifier_field_holding_a_school_id(): void
    {
        $user = User::factory()->create(['school_id' => 2100142, 'password_hash' => 'password123']);

        $this->postJson('/api/login', ['identifier' => 'ID-2100142', 'password' => 'password123'])
            ->assertOk()
            ->assertJsonPath('user.school_id', $user->school_id);
    }

    public function test_email_and_school_id_failures_share_one_generic_error_and_never_say_which_was_wrong(): void
    {
        $user = User::factory()->create(['email' => 'real@example.edu', 'password_hash' => 'password123']);

        foreach (['real@example.edu', (string) $user->school_id] as $identifier) {
            $this->postJson('/api/login', ['identifier' => $identifier, 'password' => 'wrong-password'])
                ->assertUnprocessable()
                ->assertJsonPath('errors.identifier.0', 'The provided credentials are incorrect.');
        }

        $this->postJson('/api/login', ['identifier' => 'nobody@example.edu', 'password' => 'wrong-password'])
            ->assertUnprocessable()
            ->assertJsonPath('errors.identifier.0', 'The provided credentials are incorrect.');
        $this->postJson('/api/login', ['identifier' => 'real@example.edu'])->assertUnprocessable()->assertJsonValidationErrors(['password']);
        $this->postJson('/api/login', ['password' => 'password123'])->assertUnprocessable()->assertJsonValidationErrors(['identifier']);
    }

    public function test_the_failure_counter_follows_the_normalized_identifier(): void
    {
        $user = User::factory()->create(['email' => 'lockme@example.edu', 'password_hash' => 'password123']);

        for ($attempt = 0; $attempt < 5; $attempt++) {
            $this->postJson('/api/login', ['identifier' => $attempt % 2 ? ' LockMe@Example.edu' : 'lockme@example.edu', 'password' => 'wrong-password'])
                ->assertUnprocessable();
        }

        $this->postJson('/api/login', ['identifier' => 'LOCKME@example.edu', 'password' => 'password123'])
            ->assertStatus(429);
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
        ])->assertForbidden()->assertJsonPath('message', 'This organization is not active. Contact the Student Affairs Office.');
    }

    public function test_a_member_of_an_unavailable_organization_is_told_why_only_after_the_password_is_correct(): void
    {
        $messages = [
            'archived' => 'Your organization has been archived by the Student Affairs Office and is read only. Contact the Student Affairs Office to restore it.',
            'pending' => 'Your organization is still waiting for approval by the Student Affairs Office.',
            'returned' => 'Your organization registration was returned by the Student Affairs Office. Contact your Department Head.',
        ];

        foreach ($messages as $status => $message) {
            $organization = Organization::factory()->create(['is_active' => false, 'lifecycle_status' => $status]);
            $user = User::factory()->create(['organization_id' => $organization->id, 'password_hash' => 'password123']);

            $this->postJson('/api/login', ['school_id' => $user->school_id, 'password' => 'password123'])
                ->assertForbidden()
                ->assertJsonPath('message', $message)
                ->assertJsonPath('organization_status', $status);

            $this->postJson('/api/login', ['school_id' => $user->school_id, 'password' => 'wrong-password'])
                ->assertUnprocessable()
                ->assertJsonValidationErrors(['identifier']);
        }
    }

    public function test_login_does_not_require_an_organization(): void
    {
        $user = User::factory()->create(['role' => 'STUDENT', 'password_hash' => 'password123']);

        $this->postJson('/api/login', [
            'school_id' => $user->school_id,
            'password' => 'password123',
        ])->assertOk()->assertJsonPath('user.organization_id', $user->organization_id);
    }

    public function test_recovery_takes_one_field_that_is_an_email_or_a_school_id(): void
    {
        Mail::fake();
        config(['app.frontend_url' => 'https://hiusa.example.test']);
        $user = User::factory()->departmentHead()->create(['email' => 'dean@example.edu', 'school_id' => 95000001]);

        foreach (['Dean@Example.edu', '95000001'] as $identifier) {
            $this->postJson('/api/password/forgot', ['identifier' => $identifier])
                ->assertOk()
                ->assertJsonStructure(['message']);
        }

        Mail::assertQueued(PasswordResetMail::class, 2);
        Mail::assertQueued(PasswordResetMail::class, fn ($mail) => $mail->hasTo('dean@example.edu'));
    }

    public function test_recovery_for_an_unknown_identifier_looks_identical_and_sends_nothing(): void
    {
        Mail::fake();
        $known = User::factory()->create(['email' => 'known@example.edu']);

        $found = $this->postJson('/api/password/forgot', ['identifier' => 'known@example.edu'])->assertOk();
        $missing = $this->postJson('/api/password/forgot', ['identifier' => 'missing@example.edu'])->assertOk();
        $badId = $this->postJson('/api/password/forgot', ['identifier' => '12345678'])->assertOk();

        $this->assertSame($found->json(), $missing->json());
        $this->assertSame($found->json(), $badId->json());
        Mail::assertQueued(PasswordResetMail::class, 1);
        $this->postJson('/api/password/forgot', [])->assertUnprocessable();
    }

    public function test_user_can_recover_account_and_set_new_password(): void
    {
        Mail::fake();
        config(['app.frontend_url' => 'https://hiusa.example.test']);

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

        Mail::assertQueued(PasswordResetMail::class, function (PasswordResetMail $mail) use (&$resetUrl) {
            $resetUrl = $mail->resetUrl;

            return $mail->hasTo('recover@example.com')
                && str_starts_with($mail->resetUrl, 'https://hiusa.example.test/reset-password?')
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

    public function test_every_supported_role_can_request_an_organization_scoped_password_reset(): void
    {
        Mail::fake();

        foreach (['SUPER_ADMIN', 'ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'] as $index => $role) {
            $user = User::factory()->create([
                'role' => $role,
                'email' => 'recovery-role-'.$index.'@example.test',
                'account_status' => 'active',
            ]);

            $this->postJson('/api/password/forgot', [
                'organization_id' => $user->organization_id,
                'email' => $user->email,
            ])->assertOk();

            $this->assertDatabaseHas('password_reset_tokens', [
                'organization_id' => $user->organization_id,
                'email' => $user->email,
            ]);
        }

        Mail::assertQueued(PasswordResetMail::class, 5);
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

        Mail::assertNothingOutgoing();
    }

    public function test_all_roles_can_update_their_own_profile(): void
    {
        foreach (['SUPER_ADMIN', 'ADMIN', 'SBO_OFFICER', 'STUDENT', 'DEPARTMENT_HEAD'] as $role) {
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
        foreach (['SUPER_ADMIN', 'ADMIN', 'SBO_OFFICER', 'STUDENT', 'DEPARTMENT_HEAD'] as $role) {
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
