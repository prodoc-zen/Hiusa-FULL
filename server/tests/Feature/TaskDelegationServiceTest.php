<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\SboPosition;
use App\Models\Task;
use App\Models\User;
use App\Services\TaskDelegationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class TaskDelegationServiceTest extends TestCase
{
    use RefreshDatabase;

    public function test_rankings_are_mathematically_weighted_and_ties_use_school_id(): void
    {
        $organization = Organization::factory()->create();
        SboPosition::create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'title' => 'President', 'is_active' => true]);
        $higherId = User::factory()->create(['school_id' => 900102, 'organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'position_title' => 'President', 'account_status' => 'active']);
        $lowerId = User::factory()->create(['school_id' => 900101, 'organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'position_title' => 'President', 'account_status' => 'active']);

        $result = app(TaskDelegationService::class)->recommend($organization->id, 'Coordinate the annual assembly');

        $this->assertSame($lowerId->school_id, $result['recommended_officer_id']);
        $this->assertSame([$lowerId->school_id, $higherId->school_id], array_column($result['rankings'], 'officer_id'));
        $this->assertSame(92.5, $result['rankings'][0]['final_score']);
        $this->assertSame([1, 2], array_column($result['rankings'], 'rank'));
    }

    public function test_every_officer_is_audited_and_ineligible_officers_are_not_ranked(): void
    {
        config(['services.hiusa_ai.task_max_active_tasks' => 2]);
        $organization = Organization::factory()->create();
        $admin = User::factory()->create(['organization_id' => $organization->id, 'role' => 'ADMIN']);
        foreach (['Treasurer', 'President', 'Inactive Position'] as $title) {
            SboPosition::create([
                'organization_id' => $organization->id,
                'role' => 'SBO_OFFICER',
                'title' => $title,
                'is_active' => $title !== 'Inactive Position',
            ]);
        }
        $eligible = User::factory()->create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'position_title' => 'Treasurer', 'account_status' => 'active']);
        $overloaded = User::factory()->create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'position_title' => 'President', 'account_status' => 'active']);
        $inactiveAccount = User::factory()->create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'position_title' => 'President', 'account_status' => 'inactive']);
        $missingPosition = User::factory()->create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'position_title' => null, 'account_status' => 'active']);
        $inactivePosition = User::factory()->create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'position_title' => 'Inactive Position', 'account_status' => 'active']);
        foreach (range(1, 2) as $number) {
            Task::create([
                'organization_id' => $organization->id,
                'created_by' => $admin->school_id,
                'assigned_to' => $overloaded->school_id,
                'title' => "Existing task {$number}",
                'deadline' => now()->addWeek(),
                'status' => 'pending',
            ]);
        }

        $result = app(TaskDelegationService::class)->recommend($organization->id, 'Prepare the event budget');
        $evaluations = collect($result['evaluations'])->keyBy('officer_id');

        $this->assertSame([$eligible->school_id], array_column($result['rankings'], 'officer_id'));
        $this->assertSame('eligible', $evaluations[$eligible->school_id]['eligibility_result']);
        $this->assertSame('overloaded', $evaluations[$overloaded->school_id]['eligibility_result']);
        $this->assertSame('inactive_account', $evaluations[$inactiveAccount->school_id]['eligibility_result']);
        $this->assertSame('missing_position', $evaluations[$missingPosition->school_id]['eligibility_result']);
        $this->assertSame('inactive_position', $evaluations[$inactivePosition->school_id]['eligibility_result']);
        $this->assertNull($evaluations[$overloaded->school_id]['final_score']);
    }

    public function test_configured_weights_are_normalized_before_scoring(): void
    {
        config(['services.hiusa_ai.task_weights' => ['position' => 4, 'workload' => 3, 'performance' => 3]]);
        $organization = Organization::factory()->create();
        SboPosition::create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'title' => 'Treasurer', 'is_active' => true]);
        User::factory()->create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'position_title' => 'Treasurer', 'account_status' => 'active']);

        $result = app(TaskDelegationService::class)->recommend($organization->id, 'Prepare budget records');

        $this->assertSame(['position' => 0.4, 'workload' => 0.3, 'performance' => 0.3], $result['weights']);
        $this->assertSame(91.0, $result['rankings'][0]['final_score']);
    }

    public function test_task_creation_persists_eligible_and_ineligible_candidate_evidence(): void
    {
        config(['services.hiusa_ai.enabled' => false, 'services.hiusa_ai.task_max_active_tasks' => 1]);
        $organization = Organization::factory()->create();
        $admin = User::factory()->create(['organization_id' => $organization->id, 'role' => 'ADMIN']);
        SboPosition::create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'title' => 'President', 'is_active' => true]);
        $eligible = User::factory()->create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'position_title' => 'President', 'account_status' => 'active']);
        $overloaded = User::factory()->create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'position_title' => 'President', 'account_status' => 'active']);
        Task::create([
            'organization_id' => $organization->id,
            'created_by' => $admin->school_id,
            'assigned_to' => $overloaded->school_id,
            'title' => 'Existing assignment',
            'deadline' => now()->addWeek(),
            'status' => 'pending',
        ]);
        Sanctum::actingAs($admin);

        $taskId = $this->postJson('/api/tasks', [
            'title' => 'Coordinate the event',
            'deadline' => now()->addWeek(),
            'status' => 'pending',
        ])->assertCreated()->assertJsonPath('assigned_to', $eligible->school_id)->json('id');

        $this->assertDatabaseHas('task_recommendations', [
            'task_id' => $taskId,
            'officer_id' => $eligible->school_id,
            'eligibility_result' => 'eligible',
            'rank' => 1,
        ]);
        $this->assertDatabaseHas('task_recommendations', [
            'task_id' => $taskId,
            'officer_id' => $overloaded->school_id,
            'eligibility_result' => 'overloaded',
            'rank' => null,
        ]);
    }

    public function test_task_creation_returns_a_clear_error_when_every_officer_is_overloaded(): void
    {
        config(['services.hiusa_ai.enabled' => false, 'services.hiusa_ai.task_max_active_tasks' => 1]);
        $organization = Organization::factory()->create();
        $admin = User::factory()->create(['organization_id' => $organization->id, 'role' => 'ADMIN']);
        SboPosition::create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'title' => 'President', 'is_active' => true]);
        $officer = User::factory()->create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'position_title' => 'President', 'account_status' => 'active']);
        Task::create([
            'organization_id' => $organization->id,
            'created_by' => $admin->school_id,
            'assigned_to' => $officer->school_id,
            'title' => 'Existing assignment',
            'deadline' => now()->addWeek(),
            'status' => 'pending',
        ]);
        Sanctum::actingAs($admin);

        $this->postJson('/api/tasks', [
            'title' => 'Another assignment',
            'deadline' => now()->addWeek(),
            'status' => 'pending',
        ])->assertUnprocessable()
            ->assertJsonPath('message', 'No eligible SBO Officer is currently available. All configured officers may be at workload capacity.');

        $this->assertDatabaseCount('task_recommendations', 0);
    }
}
