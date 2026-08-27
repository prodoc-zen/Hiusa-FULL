<?php

namespace Tests\Feature;

use App\Models\AiOutput;
use App\Models\Event;
use App\Models\Organization;
use App\Models\Task;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class EventPlanningWorkflowTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_can_generate_and_save_a_complete_fallback_plan_and_ordered_workflow(): void
    {
        config(['services.groq.key' => '']);

        $admin = User::factory()->create([
            'organization_id' => Organization::factory(),
            'role' => 'ADMIN',
            'account_status' => 'active',
        ]);
        $event = Event::factory()->create([
            'organization_id' => $admin->organization_id,
            'created_by' => $admin->school_id,
            'start_time' => now()->addDays(30),
            'end_time' => now()->addDays(30)->addHours(3),
            'planning_details' => [
                'budget_notes' => 'Expected venue and catering costs.',
                'vendor_deadlines' => 'Catering confirmation two weeks before the event.',
                'logistics_checklist' => 'Confirm room access and sound system.',
            ],
        ]);

        Sanctum::actingAs($admin);

        $response = $this->postJson("/api/events/{$event->id}/generate-plan", [
            'requirements' => 'Plan registration, suppliers, room setup, safety, and backup actions.',
            'create_workflow' => true,
        ])->assertCreated()
            ->assertJsonPath('ai_output.feature_type', 'event_plan')
            ->assertJsonPath('ai_output.model_name', 'deterministic-fallback')
            ->assertJsonCount(4, 'tasks');

        foreach (['Timeline:', 'Resource Checklist:', 'Logistics Checklist:', 'Possible Delays or Conflicts:'] as $section) {
            $this->assertStringContainsString($section, $response->json('plan'));
        }

        $event->refresh();
        $this->assertSame('Expected venue and catering costs.', $event->planning_details['budget_notes']);
        $this->assertSame('Catering confirmation two weeks before the event.', $event->planning_details['vendor_deadlines']);
        $this->assertSame('Confirm room access and sound system.', $event->planning_details['logistics_checklist']);
        $this->assertSame($response->json('plan'), $event->planning_details['generated_plan']);

        $deadlines = Task::where('event_id', $event->id)->orderBy('deadline')->get()->pluck('deadline');
        $this->assertCount(4, $deadlines);
        $this->assertSame($deadlines->count(), $deadlines->unique()->count());
        $this->assertTrue($deadlines->every(fn ($deadline) => $deadline->lt($event->start_time)));
        $this->assertDatabaseHas('tasks', [
            'event_id' => $event->id,
            'title' => 'Complete logistics checklist',
            'task_type' => 'workflow',
            'is_ai_generated' => true,
        ]);
        $this->assertSame(1, AiOutput::where('reference_id', $event->id)->where('feature_type', 'event_plan')->count());
    }

    public function test_non_admin_and_cross_organization_admin_cannot_generate_an_event_plan(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->create(['organization_id' => $organization, 'role' => 'ADMIN']);
        $student = User::factory()->create(['organization_id' => $organization, 'role' => 'STUDENT']);
        $otherAdmin = User::factory()->create(['organization_id' => Organization::factory(), 'role' => 'ADMIN']);
        $event = Event::factory()->create([
            'organization_id' => $organization,
            'created_by' => $admin->school_id,
        ]);

        Sanctum::actingAs($student);
        $this->postJson("/api/events/{$event->id}/generate-plan", [
            'requirements' => 'Attempt as a student.',
        ])->assertForbidden();

        Sanctum::actingAs($otherAdmin);
        $this->postJson("/api/events/{$event->id}/generate-plan", [
            'requirements' => 'Attempt across organizations.',
        ])->assertNotFound();

        $this->assertDatabaseCount('ai_outputs', 0);
        $this->assertDatabaseCount('tasks', 0);
    }

    public function test_workflow_generation_rejects_events_without_enough_future_lead_time(): void
    {
        $admin = User::factory()->create([
            'organization_id' => Organization::factory(),
            'role' => 'ADMIN',
        ]);
        $event = Event::factory()->create([
            'organization_id' => $admin->organization_id,
            'created_by' => $admin->school_id,
            'start_time' => now()->addMinutes(4),
            'end_time' => now()->addHours(2),
        ]);

        Sanctum::actingAs($admin);

        $this->postJson("/api/events/{$event->id}/generate-plan", [
            'requirements' => 'Create a last-minute workflow.',
            'create_workflow' => true,
        ])->assertUnprocessable()
            ->assertJsonPath('message', 'Workflow tasks require an event that starts at least five minutes in the future.');

        $this->assertDatabaseCount('ai_outputs', 0);
        $this->assertDatabaseCount('tasks', 0);
    }

    public function test_incomplete_groq_output_uses_the_complete_deterministic_fallback(): void
    {
        config(['services.groq.key' => 'test-groq-key']);
        Http::fake([
            '*' => Http::response([
                'model' => 'test-model',
                'output_text' => "Timeline:\n- This response omitted the required checklists.",
            ]),
        ]);

        $admin = User::factory()->create([
            'organization_id' => Organization::factory(),
            'role' => 'ADMIN',
        ]);
        $event = Event::factory()->create([
            'organization_id' => $admin->organization_id,
            'created_by' => $admin->school_id,
            'start_time' => now()->addWeek(),
            'end_time' => now()->addWeek()->addHours(2),
        ]);

        Sanctum::actingAs($admin);

        $response = $this->postJson("/api/events/{$event->id}/generate-plan", [
            'requirements' => 'Require a complete plan.',
            'create_workflow' => false,
        ])->assertCreated()
            ->assertJsonPath('ai_output.model_name', 'deterministic-fallback');

        foreach (['Timeline:', 'Resource Checklist:', 'Logistics Checklist:', 'Possible Delays or Conflicts:'] as $section) {
            $this->assertStringContainsString($section, $response->json('plan'));
        }

        $this->assertDatabaseCount('tasks', 0);
    }
}
