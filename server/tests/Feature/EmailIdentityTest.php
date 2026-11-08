<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class EmailIdentityTest extends TestCase
{
    use RefreshDatabase;

    private function twoOrganizations(): array
    {
        return [Organization::factory()->create(), Organization::factory()->create()];
    }

    public function test_an_email_held_by_two_accounts_signs_in_neither(): void
    {
        [$one, $two] = $this->twoOrganizations();
        $first = User::factory()->create(['organization_id' => $one->id, 'email' => 'dean@example.edu', 'password_hash' => 'password123']);
        $second = User::factory()->create(['organization_id' => $two->id, 'email' => 'dean@example.edu', 'password_hash' => 'password123']);

        $this->postJson('/api/login', ['identifier' => 'dean@example.edu', 'password' => 'password123'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['identifier'])
            ->assertJsonMissing(['access_token']);

        $this->postJson('/api/login', ['identifier' => (string) $first->school_id, 'password' => 'password123'])->assertOk();
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/login', ['identifier' => (string) $second->school_id, 'password' => 'password123'])->assertOk();
    }

    public function test_an_email_held_by_one_account_still_signs_in_by_email(): void
    {
        User::factory()->create(['email' => 'solo@example.edu', 'password_hash' => 'password123']);

        $this->postJson('/api/login', ['identifier' => 'Solo@Example.edu', 'password' => 'password123'])->assertOk();
    }

    public function test_the_lookup_returns_nobody_when_the_email_is_shared(): void
    {
        [$one, $two] = $this->twoOrganizations();
        User::factory()->create(['organization_id' => $one->id, 'email' => 'shared@example.edu']);
        User::factory()->create(['organization_id' => $two->id, 'email' => 'shared@example.edu']);
        $solo = User::factory()->create(['email' => 'solo@example.edu']);

        $this->assertNull(User::findByIdentifier('shared@example.edu'));
        $this->assertTrue($solo->is(User::findByIdentifier('solo@example.edu')));
    }

    public function test_a_profile_cannot_take_an_email_from_another_organization(): void
    {
        [$one, $two] = $this->twoOrganizations();
        User::factory()->create(['organization_id' => $one->id, 'email' => 'dean@example.edu']);
        $student = User::factory()->student()->create(['organization_id' => $two->id]);
        Sanctum::actingAs($student);

        $this->putJson('/api/user/profile', ['email' => 'dean@example.edu'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['email']);
        $this->assertNotSame('dean@example.edu', $student->fresh()->email);
    }

    public function test_an_admin_cannot_give_a_member_an_email_from_another_organization(): void
    {
        [$one, $two] = $this->twoOrganizations();
        User::factory()->create(['organization_id' => $one->id, 'email' => 'dean@example.edu']);
        $admin = User::factory()->admin()->create(['organization_id' => $two->id]);
        $student = User::factory()->student()->create(['organization_id' => $two->id]);
        Sanctum::actingAs($admin);

        $this->putJson('/api/users/'.$student->school_id, ['email' => 'dean@example.edu'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['email']);
    }

    public function test_an_admin_cannot_add_a_member_with_an_email_from_another_organization(): void
    {
        [$one, $two] = $this->twoOrganizations();
        User::factory()->create(['organization_id' => $one->id, 'email' => 'dean@example.edu']);
        $admin = User::factory()->admin()->create(['organization_id' => $two->id]);
        Sanctum::actingAs($admin);

        $this->postJson('/api/users', [
            'school_id' => 87654321, 'first_name' => 'New', 'last_name' => 'Member', 'email' => 'dean@example.edu',
            'password' => 'password123', 'password_confirmation' => 'password123', 'role' => 'STUDENT',
        ])->assertUnprocessable()->assertJsonValidationErrors(['email']);
    }
}
