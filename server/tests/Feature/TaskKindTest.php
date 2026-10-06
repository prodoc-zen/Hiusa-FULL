<?php

namespace Tests\Feature;

use App\Models\Event;
use App\Models\Organization;
use App\Models\Task;
use App\Models\SboPosition;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class TaskKindTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_reviews_recommendation_and_assigns_standalone_task(): void
    {
        config(['services.hiusa_ai.enabled' => false]);
        $organization = Organization::factory()->create();
        $admin = User::factory()->create(['organization_id' => $organization->id, 'role' => 'ADMIN']);
        SboPosition::create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'title' => 'Secretary', 'is_active' => true]);
        $officer = User::factory()->create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'position_title' => 'Secretary', 'account_status' => 'active']);
        Sanctum::actingAs($admin);

        $this->postJson('/api/tasks', ['title' => 'Prepare minutes', 'deadline' => now()->addWeek(), 'status' => 'pending', 'task_kind' => 'standalone'])
            ->assertUnprocessable()->assertJsonPath('errors.assigned_to.0', 'Choose an eligible officer.');
        $this->postJson('/api/tasks/recommendation', ['title' => 'Prepare minutes', 'category' => 'documentation', 'preferred_role' => 'Secretary'])
            ->assertOk()->assertJsonPath('delegation.recommended_officer_id', $officer->school_id);
        $task = $this->postJson('/api/tasks', ['title' => 'Prepare minutes', 'deadline' => now()->addWeek(), 'status' => 'pending', 'task_kind' => 'standalone', 'category' => 'documentation', 'preferred_role' => 'Secretary', 'priority' => 'high', 'assigned_to' => $officer->school_id])
            ->assertCreated()->assertJsonPath('task_kind', 'standalone')->assertJsonPath('event_id', null)->assertJsonPath('category', 'documentation')->assertJsonPath('priority', 'high')->json();
        $this->getJson('/api/tasks?task_kind=standalone')->assertOk()->assertJsonPath('data.0.id', $task['id']);
        $this->getJson('/api/tasks?task_kind=event_related')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/tasks?priority=high')->assertOk()->assertJsonPath('data.0.id', $task['id']);
        $this->getJson('/api/tasks?priority=low')->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_event_task_requires_an_event_and_rejects_another_organizations_event(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->create(['organization_id' => $organization->id, 'role' => 'ADMIN']);
        $other = Organization::factory()->create();
        $event = Event::factory()->create(['organization_id' => $other->id]);
        Sanctum::actingAs($admin);

        $this->postJson('/api/tasks', ['title' => 'Set up registration', 'deadline' => now()->addWeek(), 'status' => 'pending', 'task_kind' => 'event_related'])
            ->assertUnprocessable()->assertJsonPath('errors.event_id.0', 'Select a related event for an event task.');
        $this->postJson('/api/tasks', ['title' => 'Set up registration', 'deadline' => now()->addWeek(), 'status' => 'pending', 'task_kind' => 'event_related', 'event_id' => $event->id])
            ->assertUnprocessable();
    }

    public function test_officer_cannot_request_recommendations(): void
    {
        $officer = User::factory()->create(['role' => 'SBO_OFFICER']);
        Sanctum::actingAs($officer);
        $this->postJson('/api/tasks/recommendation', ['title' => 'Prepare minutes'])->assertForbidden();
    }

    public function test_event_progress_counts_only_its_own_tasks(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->create(['organization_id' => $organization->id, 'role' => 'ADMIN']);
        $event = Event::factory()->create(['organization_id' => $organization->id, 'created_by' => $admin->school_id]);
        Task::create(['organization_id' => $organization->id, 'created_by' => $admin->school_id, 'event_id' => $event->id, 'title' => 'Prepare venue', 'deadline' => now()->addWeek(), 'status' => 'completed']);
        Task::create(['organization_id' => $organization->id, 'created_by' => $admin->school_id, 'title' => 'Prepare monthly report', 'deadline' => now()->addWeek(), 'status' => 'pending']);
        Sanctum::actingAs($admin);

        $this->getJson('/api/events/'.$event->id)->assertOk()->assertJsonPath('tasks_count', 1)->assertJsonPath('completed_tasks_count', 1);
    }
}
