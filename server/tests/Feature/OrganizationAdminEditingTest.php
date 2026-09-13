<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\SboPosition;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OrganizationAdminEditingTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_can_edit_an_admin_only_inside_their_organization(): void
    {
        $organization = Organization::factory()->create();
        $otherOrganization = Organization::factory()->create();
        $actor = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $colleague = User::factory()->admin()->create(['organization_id' => $organization->id, 'position_title' => 'Secretary']);
        $foreignAdmin = User::factory()->admin()->create(['organization_id' => $otherOrganization->id]);
        SboPosition::create(['organization_id' => $organization->id, 'role' => 'ADMIN', 'title' => 'Vice President - Internal', 'is_active' => true]);

        Sanctum::actingAs($actor);

        $this->putJson('/api/users/'.$colleague->school_id, [
            'first_name' => 'Edited',
            'role' => 'ADMIN',
            'position_title' => 'Vice President - Internal',
        ])->assertOk()
            ->assertJsonPath('first_name', 'Edited')
            ->assertJsonPath('role', 'ADMIN')
            ->assertJsonPath('position_title', 'Vice President - Internal');

        $this->putJson('/api/users/'.$foreignAdmin->school_id, ['first_name' => 'Leaked'])
            ->assertNotFound();

        $this->putJson('/api/users/'.$colleague->school_id, ['role' => 'STUDENT'])
            ->assertForbidden();
        $this->putJson('/api/users/'.$colleague->school_id, ['account_status' => 'disabled'])
            ->assertForbidden();

        $this->assertDatabaseHas('audit_logs', [
            'organization_id' => $organization->id,
            'module' => 'users',
            'action' => 'updated',
            'record_id' => $colleague->school_id,
        ]);
    }
}
