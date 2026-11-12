<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class UserManagementSingleHeadTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->organization = Organization::factory()->create();
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id, 'account_status' => 'active']);
        Sanctum::actingAs($this->admin);
    }

    public function test_an_admin_cannot_create_a_second_organization_head(): void
    {
        $this->postJson('/api/users', [
            'school_id' => 87654351, 'first_name' => 'Second', 'last_name' => 'Head', 'email' => 'second.head@example.test',
            'password' => 'password123', 'password_confirmation' => 'password123', 'role' => 'ADMIN',
        ])->assertForbidden()->assertJsonPath('message', 'Only the Department Head can name another organization head.');

        $this->assertDatabaseMissing('users', ['school_id' => 87654351]);
    }

    public function test_an_admin_cannot_promote_a_member_to_organization_head(): void
    {
        $student = User::factory()->student()->create(['organization_id' => $this->organization->id, 'account_status' => 'active']);

        $this->putJson('/api/users/'.$student->school_id, ['role' => 'ADMIN'])
            ->assertForbidden()->assertJsonPath('message', 'Only the Department Head can name another organization head.');

        $this->assertSame('STUDENT', $student->fresh()->role);
    }

    public function test_a_university_wide_admin_is_told_the_sao_names_another_organization_head(): void
    {
        $unified = Organization::factory()->create(['is_university_wide' => true, 'college_id' => null, 'college' => null, 'parent_organization_id' => null]);
        Sanctum::actingAs(User::factory()->admin()->create(['organization_id' => $unified->id, 'account_status' => 'active']));
        $student = User::factory()->student()->create(['organization_id' => $unified->id, 'account_status' => 'active']);

        $this->putJson('/api/users/'.$student->school_id, ['role' => 'ADMIN'])
            ->assertForbidden()->assertJsonPath('message', 'Only the SAO can name another organization head.');
    }

    public function test_an_admin_can_still_create_and_edit_students_and_officers(): void
    {
        $this->postJson('/api/users', [
            'school_id' => 87654352, 'first_name' => 'New', 'last_name' => 'Officer', 'email' => 'new.officer@example.test',
            'password' => 'password123', 'password_confirmation' => 'password123', 'role' => 'SBO_OFFICER',
        ])->assertCreated();

        $student = User::factory()->student()->create(['organization_id' => $this->organization->id, 'account_status' => 'active']);
        $this->putJson('/api/users/'.$student->school_id, ['role' => 'SBO_OFFICER'])->assertOk();
    }
}
