<?php

namespace Tests\Feature;

use App\Models\Event;
use App\Models\Organization;
use App\Models\Task;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class TaskSearchAndProgressTest extends TestCase
{
    use RefreshDatabase;

    public function test_search_looks_across_every_page_not_just_the_one_on_screen(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->create(['organization_id' => $organization->id, 'role' => 'ADMIN']);
        $officer = User::factory()->create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'first_name' => 'Marco', 'last_name' => 'Dela Cruz', 'position_title' => 'Treasurer']);
        $event = Event::factory()->create(['organization_id' => $organization->id, 'title' => 'Sports Fest', 'created_by' => $admin->school_id]);
        foreach (range(1, 12) as $day) {
            Task::create(['organization_id' => $organization->id, 'created_by' => $admin->school_id, 'title' => "Filler {$day}", 'deadline' => now()->addDays($day), 'status' => 'pending']);
        }
        $late = Task::create(['organization_id' => $organization->id, 'created_by' => $admin->school_id, 'title' => 'Bulk poster', 'deadline' => now()->addDays(40), 'status' => 'pending']);
        $assigned = Task::create(['organization_id' => $organization->id, 'created_by' => $admin->school_id, 'assigned_to' => $officer->school_id, 'event_id' => $event->id, 'title' => 'Count cash', 'deadline' => now()->addDays(41), 'status' => 'pending']);
        Sanctum::actingAs($admin);

        $this->getJson('/api/tasks?per_page=10&search=bulk')->assertOk()
            ->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $late->id)->assertJsonPath('total', 1);
        $this->getJson('/api/tasks?per_page=10&search=marco+dela')->assertOk()
            ->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $assigned->id);
        $this->getJson('/api/tasks?per_page=10&search=sports')->assertOk()
            ->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $assigned->id);
        $this->getJson('/api/tasks?per_page=10&search=qqzzx')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/tasks?per_page=10&search=100%25')->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_search_never_shows_another_organizations_tasks_or_an_officers_colleagues_tasks(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->create(['organization_id' => $organization->id, 'role' => 'ADMIN']);
        $officer = User::factory()->create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER']);
        $colleague = User::factory()->create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER']);
        $otherAdmin = User::factory()->create(['organization_id' => Organization::factory(), 'role' => 'ADMIN']);
        $own = Task::create(['organization_id' => $organization->id, 'created_by' => $admin->school_id, 'assigned_to' => $officer->school_id, 'title' => 'Poster mine', 'deadline' => now()->addWeek(), 'status' => 'pending']);
        Task::create(['organization_id' => $organization->id, 'created_by' => $admin->school_id, 'assigned_to' => $colleague->school_id, 'title' => 'Poster theirs', 'deadline' => now()->addWeek(), 'status' => 'pending']);
        Task::create(['organization_id' => $otherAdmin->organization_id, 'created_by' => $otherAdmin->school_id, 'title' => 'Poster elsewhere', 'deadline' => now()->addWeek(), 'status' => 'pending']);

        Sanctum::actingAs($officer);
        $this->getJson('/api/tasks?search=poster')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $own->id);
    }

    public function test_a_progress_update_cannot_reach_100_until_the_task_is_completed(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->create(['organization_id' => $organization->id, 'role' => 'ADMIN']);
        $task = Task::create(['organization_id' => $organization->id, 'created_by' => $admin->school_id, 'assigned_to' => $admin->school_id, 'title' => 'Print tickets', 'deadline' => now()->addWeek(), 'status' => 'in_progress', 'progress_percent' => 40]);
        Sanctum::actingAs($admin);

        $this->patchJson("/api/tasks/{$task->id}/status", ['status' => 'in_progress', 'progress_percent' => 100, 'progress_note' => 'Almost'])
            ->assertUnprocessable()->assertJsonValidationErrors('progress_percent');
        $this->assertSame(40, $task->fresh()->progress_percent);
        $this->patchJson("/api/tasks/{$task->id}/status", ['status' => 'in_progress', 'progress_percent' => 99, 'progress_note' => 'Nearly done'])
            ->assertOk()->assertJsonPath('progress_percent', 99);
        $this->patchJson("/api/tasks/{$task->id}/status", ['status' => 'completed', 'progress_percent' => 100, 'progress_note' => 'Done'])
            ->assertOk()->assertJsonPath('progress_percent', 100)->assertJsonPath('status', 'completed');
    }
}
