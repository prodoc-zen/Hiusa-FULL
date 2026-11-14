<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\Task;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class TaskWaitingFilterTest extends TestCase
{
    use RefreshDatabase;

    private function task(Organization $organization, User $officer, string $title, string $status, ?Task $after = null): Task
    {
        return Task::create([
            'organization_id' => $organization->id,
            'created_by' => $officer->school_id,
            'assigned_to' => $officer->school_id,
            'title' => $title,
            'deadline' => now()->addWeek(),
            'status' => $status,
            'depends_on_task_id' => $after?->id,
        ]);
    }

    public function test_waiting_lists_only_unfinished_tasks_whose_earlier_task_is_not_done(): void
    {
        $organization = Organization::factory()->create();
        $officer = User::factory()->create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'position_title' => 'Secretary', 'account_status' => 'active']);
        $first = $this->task($organization, $officer, 'Run the event', 'pending');
        $done = $this->task($organization, $officer, 'Book the venue', 'completed');
        $waiting = $this->task($organization, $officer, 'Settle expenses', 'pending', $first);
        $this->task($organization, $officer, 'Collect feedback', 'pending', $done);
        $this->task($organization, $officer, 'Write the report', 'completed', $first);
        Sanctum::actingAs($officer);

        $this->getJson('/api/tasks?status=pending&waiting=1&per_page=1')
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $waiting->id)
            ->assertJsonPath('data.0.workflow_status', 'blocked');
        $this->getJson('/api/tasks?status=pending&per_page=1')->assertOk()->assertJsonPath('total', 3);
        $this->getJson('/api/tasks?waiting=0')->assertOk()->assertJsonPath('total', 5);
    }
}
