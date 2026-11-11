<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\SboPosition;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class WorkflowOfficerPreviewTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_planning_to_do_with_a_best_officer_role_nobody_holds_still_lists_every_eligible_officer(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->create(['organization_id' => $organization->id, 'role' => 'ADMIN']);
        foreach (['Treasurer', 'Secretary'] as $title) {
            SboPosition::create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'title' => $title, 'is_active' => true]);
        }
        $treasurer = User::factory()->create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'position_title' => 'Treasurer', 'account_status' => 'active']);
        Sanctum::actingAs($admin);

        $this->postJson('/api/tasks/recommendation', ['title' => 'Print programs', 'task_type' => 'workflow', 'preferred_role' => 'Secretary'])
            ->assertOk()
            ->assertJsonPath('delegation.rankings.0.officer_id', $treasurer->school_id);
    }

    public function test_a_standalone_task_still_requires_the_position_it_names(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->create(['organization_id' => $organization->id, 'role' => 'ADMIN']);
        foreach (['Treasurer', 'Secretary'] as $title) {
            SboPosition::create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'title' => $title, 'is_active' => true]);
        }
        User::factory()->create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'position_title' => 'Treasurer', 'account_status' => 'active']);
        Sanctum::actingAs($admin);

        $this->postJson('/api/tasks/recommendation', ['title' => 'Print programs', 'preferred_role' => 'Secretary'])
            ->assertOk()
            ->assertJsonCount(0, 'delegation.rankings');
    }
}
