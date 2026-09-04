<?php

namespace Tests\Feature;

use App\Models\AiOutput;
use App\Models\ApprovalRequest;
use App\Models\Budget;
use App\Models\Event;
use App\Models\FinancialForecast;
use App\Models\Organization;
use App\Models\SboPosition;
use App\Models\Task;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class EventPlanningWorkflowTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_reviews_structured_workflow_before_tasks_are_created_and_assigned(): void
    {
        config(['services.groq.key' => 'test-groq-key']);

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
        SboPosition::create(['organization_id' => $admin->organization_id, 'role' => 'SBO_OFFICER', 'title' => 'Business Manager', 'is_active' => true]);
        $officer = User::factory()->create(['organization_id' => $admin->organization_id, 'role' => 'SBO_OFFICER', 'account_status' => 'active', 'position_title' => 'Business Manager']);
        $workflow = $this->workflowPayload($event);
        Http::fake(function ($request) use ($workflow) {
            if (data_get($request->data(), 'text.format.name') === 'hiusa_task_recommendation_explanations') {
                $input = json_decode((string) $request->data()['input'], true);

                return Http::response([
                    'id' => 'resp_explanations',
                    'model' => 'test-model',
                    'output_text' => json_encode([
                        'explanations' => collect($input['recommendations'])->map(fn ($row) => [
                            'task_id' => $row['task_id'],
                            'explanation' => "Officer {$row['officer_id']} ranked {$row['rank']} with a total score of {$row['total_score']}.",
                        ])->all(),
                    ]),
                ]);
            }

            return Http::response(['id' => 'resp_test', 'model' => 'test-model', 'output_text' => json_encode($workflow)]);
        });

        Sanctum::actingAs($admin);

        $response = $this->postJson("/api/events/{$event->id}/generate-plan", [
            'requirements' => 'Plan registration, suppliers, room setup, safety, and backup actions.',
        ])->assertCreated()
            ->assertJsonPath('ai_output.feature_type', 'EVENT_WORKFLOW')
            ->assertJsonPath('ai_output.model_name', 'test-model')
            ->assertJsonPath('workflow.tasks.0.recommendation.recommended_officer_id', $officer->school_id)
            ->assertJsonCount(0, 'tasks');

        foreach (['Timeline:', 'Resource Checklist:', 'Logistics Checklist:', 'Possible Delays or Conflicts:'] as $section) {
            $this->assertStringContainsString($section, $response->json('plan'));
        }

        $event->refresh();
        $this->assertSame('Expected venue and catering costs.', $event->planning_details['budget_notes']);
        $this->assertSame('Catering confirmation two weeks before the event.', $event->planning_details['vendor_deadlines']);
        $this->assertSame('Confirm room access and sound system.', $event->planning_details['logistics_checklist']);
        $this->assertSame($response->json('plan'), $event->planning_details['draft_plan']);
        $this->assertDatabaseCount('tasks', 0);

        $outputId = $response->json('ai_output.id');
        $this->postJson("/api/events/{$event->id}/workflows/{$outputId}/confirm", [
            'tasks' => $response->json('workflow.tasks'),
        ])->assertCreated()->assertJsonCount(3, 'tasks');

        $tasks = Task::where('event_id', $event->id)->orderBy('sequence')->get();
        $this->assertCount(3, $tasks);
        $this->assertNull($tasks[0]->depends_on_task_id);
        $this->assertSame($tasks[0]->id, $tasks[1]->depends_on_task_id);
        $this->assertSame($tasks[1]->id, $tasks[2]->depends_on_task_id);
        $this->assertTrue($tasks->every(fn (Task $task) => $task->assigned_to === $officer->school_id));
        $this->assertSame('accepted', AiOutput::find($outputId)->decision_status);
        $this->assertDatabaseCount('task_recommendations', 3);
        $this->assertDatabaseCount('notifications', 3);
        $this->assertSame(3, AiOutput::where('feature_type', 'TASK_EXPLANATION')->where('status', 'completed')->count());
        $this->assertTrue($tasks->every(fn (Task $task) => str_contains($task->fresh()->ai_recommendation_note, 'total score')));

        Sanctum::actingAs($officer);
        $this->patchJson("/api/tasks/{$tasks[1]->id}/status", ['status' => 'in_progress'])
            ->assertUnprocessable()->assertJsonPath('message', 'This task is blocked until its dependency is completed.');
        $this->patchJson("/api/tasks/{$tasks[0]->id}/status", ['status' => 'in_progress'])->assertOk();
        $this->patchJson("/api/tasks/{$tasks[0]->id}/status", ['status' => 'completed'])->assertOk();
        $this->getJson('/api/tasks')->assertOk()->assertJsonPath('data.1.workflow_status', 'ready');
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

    public function test_admin_officer_override_is_applied_and_audited(): void
    {
        config(['services.groq.key' => 'test-groq-key']);
        $admin = User::factory()->create(['organization_id' => Organization::factory(), 'role' => 'ADMIN']);
        $event = Event::factory()->create([
            'organization_id' => $admin->organization_id,
            'created_by' => $admin->school_id,
            'start_time' => now()->addDays(30),
            'end_time' => now()->addDays(30)->addHours(3),
        ]);
        foreach (['Business Manager', 'President'] as $position) {
            SboPosition::create(['organization_id' => $admin->organization_id, 'role' => 'SBO_OFFICER', 'title' => $position, 'is_active' => true]);
        }
        User::factory()->create(['organization_id' => $admin->organization_id, 'role' => 'SBO_OFFICER', 'account_status' => 'active', 'position_title' => 'Business Manager']);
        User::factory()->create(['organization_id' => $admin->organization_id, 'role' => 'SBO_OFFICER', 'account_status' => 'active', 'position_title' => 'President']);
        Http::fake(['*' => Http::response(['model' => 'test-model', 'output_text' => json_encode($this->workflowPayload($event))])]);
        Sanctum::actingAs($admin);

        $draft = $this->postJson("/api/events/{$event->id}/generate-plan", ['requirements' => 'Create an editable workflow.'])->assertCreated();
        $tasks = $draft->json('workflow.tasks');
        $recommended = $tasks[0]['recommendation']['recommended_officer_id'];
        $alternate = collect($tasks[0]['recommendation']['rankings'])->first(fn ($row) => $row['officer_id'] !== $recommended);
        $tasks[0]['assigned_to'] = $alternate['officer_id'];

        $confirmed = $this->postJson("/api/events/{$event->id}/workflows/{$draft->json('ai_output.id')}/confirm", ['tasks' => $tasks])
            ->assertCreated()
            ->assertJsonPath('tasks.0.assigned_to', $alternate['officer_id']);

        $this->assertDatabaseHas('audit_logs', [
            'module' => 'task_delegation',
            'action' => 'overrode_recommendation',
            'record_type' => Task::class,
            'record_id' => $confirmed->json('tasks.0.id'),
        ]);
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

    public function test_unavailable_or_invalid_groq_output_is_reported_without_fake_workflow_tasks(): void
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

        $this->postJson("/api/events/{$event->id}/generate-plan", [
            'requirements' => 'Require a complete plan.',
        ])->assertServiceUnavailable();

        $this->assertDatabaseCount('tasks', 0);
        $this->assertDatabaseHas('ai_outputs', ['feature_type' => 'EVENT_WORKFLOW', 'status' => 'failed']);
    }

    public function test_integrated_event_workflow_continues_through_attendance_budget_forecast_and_report(): void
    {
        config(['services.groq.key' => 'test-groq-key', 'services.hiusa_ai.enabled' => false]);
        $organization = Organization::factory()->create();
        $admin = User::factory()->create(['organization_id' => $organization->id, 'role' => 'ADMIN']);
        $departmentHead = User::factory()->create(['organization_id' => $organization->id, 'role' => 'DEPARTMENT_HEAD']);
        $officer = User::factory()->create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'position_title' => 'Business Manager', 'account_status' => 'active']);
        $student = User::factory()->student()->create(['organization_id' => $organization->id]);
        SboPosition::create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'title' => 'Business Manager', 'is_active' => true]);

        Sanctum::actingAs($admin);
        $eventId = $this->postJson('/api/events', [
            'title' => 'Full Lifecycle Event',
            'description' => 'Exercises planning, delegation, attendance, and finance.',
            'start_time' => now()->addDays(30),
            'end_time' => now()->addDays(30)->addHours(3),
            'location' => 'Main Hall',
            'requires_budget' => true,
            'planning_details' => [
                'event_type' => 'General Assembly',
                'expected_participants' => 100,
                'requirements' => 'Registration, logistics, documentation, and finance closeout.',
                'resources' => 'Main hall, sound system, and volunteers.',
                'budget_notes' => 'Supplies and venue costs.',
                'proposed_budget_amount' => 1000,
                'budget_warning_threshold' => 200,
            ],
        ])->assertCreated()->json('id');
        $event = Event::findOrFail($eventId);
        $budget = Budget::where('event_id', $event->id)->firstOrFail();

        Sanctum::actingAs($departmentHead);
        $eventApproval = ApprovalRequest::where('entity_type', 'event')->where('entity_id', $event->id)->firstOrFail();
        $budgetApproval = ApprovalRequest::where('entity_type', 'budget')->where('entity_id', $budget->id)->firstOrFail();
        $this->patchJson("/api/approval-requests/{$eventApproval->id}", ['status' => 'approved'])->assertOk();
        $this->patchJson("/api/approval-requests/{$budgetApproval->id}", ['status' => 'approved'])->assertOk();
        $event->refresh();

        Http::fake(['*' => Http::response(['model' => 'test-model', 'output_text' => json_encode($this->workflowPayload($event))])]);
        Sanctum::actingAs($admin);

        $draft = $this->postJson("/api/events/{$event->id}/generate-plan", ['requirements' => 'Create the full operational workflow.'])->assertCreated();
        $created = $this->postJson("/api/events/{$event->id}/workflows/{$draft->json('ai_output.id')}/confirm", ['tasks' => $draft->json('workflow.tasks')])->assertCreated();
        $createdTaskIds = collect($created->json('tasks'))->pluck('id');

        Sanctum::actingAs($officer);
        foreach ($createdTaskIds as $taskId) {
            $this->patchJson("/api/tasks/{$taskId}/status", ['status' => 'in_progress', 'progress_percent' => 50, 'progress_note' => 'Preparation started.'])->assertOk();
            $this->patchJson("/api/tasks/{$taskId}/status", ['status' => 'completed', 'progress_note' => 'Task completed.'])->assertOk();
        }
        $this->getJson('/api/tasks')->assertOk()->assertJsonCount(3, 'data');
        Sanctum::actingAs($admin);
        $this->postJson("/api/events/{$event->id}/attendance", ['user_id' => $student->school_id, 'method' => 'manual', 'status' => 'present'])->assertCreated();

        foreach ([2 => [600, 300], 1 => [800, 400]] as $monthsAgo => [$income, $expense]) {
            Transaction::create(['organization_id' => $organization->id, 'recorded_by' => $admin->school_id, 'type' => 'income', 'category' => 'Historical', 'description' => 'Forecast history', 'amount' => $income, 'transaction_date' => now()->subMonths($monthsAgo)]);
            Transaction::create(['organization_id' => $organization->id, 'recorded_by' => $admin->school_id, 'type' => 'expense', 'category' => 'Historical', 'description' => 'Forecast history', 'amount' => $expense, 'transaction_date' => now()->subMonths($monthsAgo)]);
        }
        $this->postJson('/api/transactions', ['budget_id' => $budget->id, 'event_id' => $event->id, 'type' => 'expense', 'amount' => 150, 'category' => 'Events', 'description' => 'Event supplies', 'transaction_date' => $event->start_time->toDateString()])->assertCreated();
        $this->assertSame('850.00', $budget->fresh()->remaining_amount);
        $this->postJson('/api/forecasts/generate', ['months' => 12])->assertCreated()->assertJsonPath('model_details.algorithm', 'ordinary_least_squares');
        $this->postJson("/api/budgets/{$budget->id}/advice")->assertOk();
        $this->postJson('/api/financial-reports/generate', ['report_type' => 'event', 'event_id' => $event->id])->assertCreated()->assertJsonPath('totals.expense', 150);

        $this->assertDatabaseHas('financial_reports', ['event_id' => $event->id]);
        $this->assertDatabaseHas('attendance', ['event_id' => $event->id, 'user_id' => $student->school_id]);
        $this->assertSame(3, Task::where('event_id', $event->id)->where('status', 'completed')->count());
        $this->assertDatabaseHas('audit_logs', ['module' => 'ai_workflows', 'action' => 'workflow_confirmed', 'record_id' => $event->id]);
    }

    public function test_event_creation_builds_a_linked_budget_and_exposes_real_financial_summary(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->create(['organization_id' => $organization->id, 'role' => 'ADMIN']);
        Sanctum::actingAs($admin);

        $created = $this->postJson('/api/events', [
            'title' => 'Integrated Leadership Summit',
            'description' => 'A planning and governance summit.',
            'start_time' => now()->addMonth()->toISOString(),
            'end_time' => now()->addMonth()->addHours(4)->toISOString(),
            'location' => 'University Hall',
            'requires_budget' => true,
            'planning_details' => [
                'event_type' => 'Leadership Summit',
                'expected_participants' => 250,
                'requirements' => 'Registration, accessibility, safety, and documentation.',
                'resources' => 'Hall, sound system, registration volunteers.',
                'budget_notes' => 'Venue, meals, materials, and emergency reserve.',
                'proposed_budget_amount' => 2500,
                'budget_warning_threshold' => 500,
            ],
        ])->assertCreated()
            ->assertJsonPath('planning_details.event_type', 'Leadership Summit')
            ->assertJsonPath('planning_details.expected_participants', 250)
            ->assertJsonPath('financial_summary.allocated_budget', 2500)
            ->assertJsonCount(1, 'budgets');

        $eventId = $created->json('id');
        $budget = Budget::where('event_id', $eventId)->firstOrFail();
        $this->assertSame($budget->id, $created->json('planning_details.proposed_budget_id'));
        $this->assertDatabaseHas('approval_requests', ['entity_type' => 'event', 'entity_id' => $eventId, 'status' => 'pending']);
        $this->assertDatabaseHas('approval_requests', ['entity_type' => 'budget', 'entity_id' => $budget->id, 'status' => 'pending']);

        ApprovalRequest::where('entity_type', 'budget')->where('entity_id', $budget->id)->update(['status' => 'approved']);
        $transactionBase = [
            'budget_id' => $budget->id,
            'event_id' => $eventId,
            'category' => 'Events',
            'transaction_date' => now()->toDateString(),
        ];
        $this->postJson('/api/transactions', [...$transactionBase, 'type' => 'expense', 'amount' => 600, 'description' => 'Venue deposit'])->assertCreated();
        $this->postJson('/api/transactions', [...$transactionBase, 'type' => 'income', 'amount' => 100, 'description' => 'Partner contribution'])->assertCreated();
        $budget->update(['overspending_risk' => 'medium', 'safe_spending_limit' => 1200, 'advice_generated_at' => now()]);
        FinancialForecast::factory()->create([
            'organization_id' => $organization->id,
            'forecast_period' => now()->addMonth()->format('Y-m'),
            'predicted_income' => 900,
            'predicted_expense' => 1100,
            'predicted_balance' => -200,
        ]);

        $this->getJson("/api/events/{$eventId}")->assertOk()
            ->assertJsonPath('financial_summary.allocated_budget', 2500)
            ->assertJsonPath('financial_summary.spent', 600)
            ->assertJsonPath('financial_summary.income', 100)
            ->assertJsonPath('financial_summary.remaining_budget', 2000)
            ->assertJsonPath('financial_summary.risk', 'medium')
            ->assertJsonPath('financial_summary.latest_forecast.predicted_balance', '-200.00');
    }

    public function test_event_rejects_a_proposed_budget_when_budgeting_is_not_enabled(): void
    {
        $admin = User::factory()->create(['organization_id' => Organization::factory(), 'role' => 'ADMIN']);
        Sanctum::actingAs($admin);

        $this->postJson('/api/events', [
            'title' => 'Invalid Budget Event',
            'start_time' => now()->addMonth()->toISOString(),
            'end_time' => now()->addMonth()->addHours(2)->toISOString(),
            'requires_budget' => false,
            'planning_details' => ['proposed_budget_amount' => 1000],
        ])->assertUnprocessable()
            ->assertJsonPath('message', 'Enable budget allocation before entering a proposed budget.');

        $this->assertDatabaseCount('events', 0);
        $this->assertDatabaseCount('budgets', 0);
    }

    public function test_editing_event_inputs_preserves_server_owned_workflow_history(): void
    {
        $admin = User::factory()->create(['organization_id' => Organization::factory(), 'role' => 'ADMIN']);
        $event = Event::factory()->create([
            'organization_id' => $admin->organization_id,
            'created_by' => $admin->school_id,
            'status' => 'planning',
            'planning_details' => [
                'event_type' => 'Assembly',
                'requirements' => 'Original requirements',
                'draft_ai_output_id' => 41,
                'draft_plan' => 'Persisted generated plan',
            ],
        ]);
        Sanctum::actingAs($admin);

        $this->putJson("/api/events/{$event->id}", [
            'description' => 'Updated description',
            'planning_details' => [
                'event_type' => 'Assembly',
                'requirements' => 'Updated requirements',
            ],
        ])->assertOk()
            ->assertJsonPath('planning_details.requirements', 'Updated requirements')
            ->assertJsonPath('planning_details.draft_ai_output_id', 41)
            ->assertJsonPath('planning_details.draft_plan', 'Persisted generated plan');
    }

    private function workflowPayload(Event $event): array
    {
        return [
            'overview' => 'Prepare and operate the event using verified requirements.',
            'preparation_phases' => ['Confirm scope', 'Prepare logistics', 'Close records'],
            'timeline' => ['Approve scope', 'Set up the venue', 'Reconcile records'],
            'resources' => ['Registration materials', 'Venue equipment'],
            'logistics' => ['Confirm room access', 'Assign setup owners'],
            'risks' => ['Supplier delay'],
            'scheduling_conflicts' => [],
            'tasks' => [
                ['key' => 'scope', 'title' => 'Confirm event scope', 'description' => 'Confirm approved requirements.', 'phase' => 'pre_event', 'priority' => 'high', 'deadline' => $event->start_time->copy()->subDays(10)->toISOString(), 'depends_on_key' => null, 'recommended_role' => 'Business Manager'],
                ['key' => 'setup', 'title' => 'Complete venue logistics setup', 'description' => 'Prepare venue equipment.', 'phase' => 'event_day', 'priority' => 'critical', 'deadline' => $event->start_time->copy()->addHour()->toISOString(), 'depends_on_key' => 'scope', 'recommended_role' => 'Business Manager'],
                ['key' => 'close', 'title' => 'Document event closeout', 'description' => 'Record completion details.', 'phase' => 'post_event', 'priority' => 'medium', 'deadline' => $event->end_time->copy()->addDay()->toISOString(), 'depends_on_key' => 'setup', 'recommended_role' => 'Business Manager'],
            ],
        ];
    }
}
