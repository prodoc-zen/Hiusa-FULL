<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ProfileReplyActiveWorkspaceTest extends TestCase
{
    use RefreshDatabase;

    private function signedInOnSecondProfile(): array
    {
        $main = Organization::factory()->create();
        $child = Organization::factory()->create(['parent_organization_id' => $main->id, 'college' => $main->college]);
        $student = User::factory()->create([
            'organization_id' => $main->id, 'role' => 'STUDENT', 'password_hash' => 'password123', 'must_change_password' => false,
        ]);
        $second = $student->accountProfiles()->create([
            'organization_id' => $child->id, 'role' => 'SBO_OFFICER', 'account_status' => 'active',
        ]);

        $token = $this->postJson('/api/login', ['school_id' => $student->school_id, 'password' => 'password123'])
            ->assertOk()->json('access_token');
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->postJson('/api/user/profiles/'.$second->id.'/switch')
            ->assertOk()->assertJsonPath('user.organization_id', $child->id);
        $this->app['auth']->forgetGuards();

        return [$student, $main, $child, $token];
    }

    public function test_saving_settings_on_a_second_profile_replies_with_that_profiles_organization_and_role(): void
    {
        [$student, , $child, $token] = $this->signedInOnSecondProfile();

        $this->withToken($token)->putJson('/api/user/profile', ['contact_number' => '09171234567'])
            ->assertOk()
            ->assertJsonPath('contact_number', '09171234567')
            ->assertJsonPath('organization_id', $child->id)
            ->assertJsonPath('role', 'SBO_OFFICER');

        $this->assertSame('09171234567', $student->fresh()->contact_number);
    }

    public function test_changing_the_password_on_a_second_profile_replies_with_that_profiles_organization_and_role(): void
    {
        [$student, , $child, $token] = $this->signedInOnSecondProfile();

        $this->withToken($token)->putJson('/api/user/password', [
            'current_password' => 'password123',
            'password' => 'new-password-456',
            'password_confirmation' => 'new-password-456',
        ])
            ->assertOk()
            ->assertJsonPath('user.organization_id', $child->id)
            ->assertJsonPath('user.role', 'SBO_OFFICER');

        $this->assertTrue(password_verify('new-password-456', $student->fresh()->password_hash));
    }

    public function test_a_single_profile_user_gets_the_same_reply_as_before(): void
    {
        $org = Organization::factory()->create();
        $student = User::factory()->create([
            'organization_id' => $org->id, 'role' => 'STUDENT', 'password_hash' => 'password123', 'must_change_password' => false,
        ]);
        $token = $this->postJson('/api/login', ['school_id' => $student->school_id, 'password' => 'password123'])->json('access_token');
        $this->app['auth']->forgetGuards();

        $this->withToken($token)->putJson('/api/user/profile', ['contact_number' => '09171234567'])
            ->assertOk()
            ->assertJsonPath('organization_id', $org->id)
            ->assertJsonPath('role', 'STUDENT');

        $this->app['auth']->forgetGuards();
        $this->withToken($token)->putJson('/api/user/password', [
            'current_password' => 'password123',
            'password' => 'new-password-456',
            'password_confirmation' => 'new-password-456',
        ])
            ->assertOk()
            ->assertJsonPath('user.organization_id', $org->id)
            ->assertJsonPath('user.role', 'STUDENT');
    }
}
