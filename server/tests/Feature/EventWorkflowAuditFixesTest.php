<?php

namespace Tests\Feature;

use App\Models\AiOutput;
use App\Models\AuditLog;
use App\Models\Event;
use App\Models\Organization;
use App\Models\SboPosition;
use App\Models\Task;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Database\Events\TransactionBeginning;
use Illuminate\Http\Client\Factory as HttpFactory;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class EventWorkflowAuditFixesTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private Event $event;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.groq.key' => 'test-groq-key', 'services.hiusa_ai.task_max_active_tasks' => 20]);
        $this->admin = User::factory()->create(['organization_id' => Organization::factory(), 'role' => 'ADMIN', 'account_status' => 'active']);
        $this->event = Event::factory()->create([
            'organization_id' => $this->admin->organization_id,
            'created_by' => $this->admin->school_id,
            'status' => 'planning',
            'requires_budget' => false,
            'start_time' => now()->addDays(30),
            'end_time' => now()->addDays(30)->addHours(3),
        ]);
        Sanctum::actingAs($this->admin);
    }

    private function officer(string $position): User
    {
        SboPosition::firstOrCreate(['organization_id' => $this->admin->organization_id, 'role' => 'SBO_OFFICER', 'title' => $position], ['is_active' => true]);

        return User::factory()->create(['organization_id' => $this->admin->organization_id, 'role' => 'SBO_OFFICER', 'account_status' => 'active', 'position_title' => $position]);
    }

    private function template(): array
    {
        Http::swap(new HttpFactory);
        Http::fake(['*' => Http::response(['error' => 'down'], 503)]);
        $response = $this->postJson("/api/events/{$this->event->id}/generate-plan", [])->assertCreated();

        return [$response->json('ai_output.id'), $response->json('workflow.tasks'), $response];
    }

    private function assign(array $tasks, int $officerId): array
    {
        return array_map(fn (array $task) => [...$task, 'assigned_to' => $officerId], $tasks);
    }

    public function test_a_cancelled_event_gets_no_plan_and_no_confirm(): void
    {
        $officer = $this->officer('President');
        [$outputId, $tasks] = $this->template();
        $this->event->update(['status' => 'cancelled']);

        $this->postJson("/api/events/{$this->event->id}/generate-plan", [])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'This event is cancelled, so a to-do list cannot be drafted for it.');
        $this->postJson("/api/events/{$this->event->id}/workflows/{$outputId}/confirm", ['tasks' => $this->assign($tasks, $officer->school_id)])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'This event is cancelled, so its to-do list cannot be saved.');
        $this->assertDatabaseCount('tasks', 0);
    }

    public function test_cancelled_events_are_not_reported_as_schedule_conflicts(): void
    {
        $this->officer('President');
        foreach (['cancelled' => 'Cancelled clash', 'planning' => 'Live clash'] as $status => $title) {
            Event::factory()->create([
                'organization_id' => $this->admin->organization_id,
                'title' => $title,
                'status' => $status,
                'start_time' => $this->event->start_time->copy()->addHour(),
                'end_time' => $this->event->end_time->copy()->addHour(),
            ]);
        }

        [, , $response] = $this->template();

        $this->assertSame(['Overlaps with Live clash'], $response->json('workflow.scheduling_conflicts'));
        $this->assertSame(['Live clash'], collect($response->json('ai_output.structured_input.schedule_conflicts'))->pluck('title')->all());
    }

    public function test_confirm_ranks_every_task_from_the_same_starting_state(): void
    {
        $officer = $this->officer('President');
        [$outputId, $tasks, $preview] = $this->template();
        $count = count($tasks);

        $this->postJson("/api/events/{$this->event->id}/workflows/{$outputId}/confirm", ['tasks' => $this->assign($tasks, $officer->school_id)])
            ->assertCreated();

        $saved = Task::where('event_id', $this->event->id)->orderBy('sequence')->get();
        $this->assertCount($count, $saved);
        foreach ($saved as $index => $task) {
            $expected = $preview->json("workflow.tasks.{$index}.recommendation.rankings.0");
            $this->assertEquals($expected['final_score'], $task->final_score);
            $this->assertSame(0, $task->delegation_snapshot['rankings'][0]['active_tasks']);
        }
        $this->assertSame($count, \DB::table('audit_logs')->where('action', 'accepted_recommendation')->count());
        $this->assertSame(0, \DB::table('audit_logs')->where('action', 'overrode_recommendation')->count());
    }

    public function test_confirm_names_the_officer_whose_open_task_limit_the_plan_would_exceed(): void
    {
        config(['services.hiusa_ai.task_max_active_tasks' => 2]);
        $officer = $this->officer('President');
        [$outputId, $tasks] = $this->template();

        $response = $this->postJson("/api/events/{$this->event->id}/workflows/{$outputId}/confirm", ['tasks' => $this->assign($tasks, $officer->school_id)])
            ->assertUnprocessable();

        $this->assertStringContainsString($officer->first_name, $response->json('message'));
        $this->assertStringContainsString('can take 2 more open tasks but was given '.count($tasks), $response->json('message'));
        $this->assertDatabaseCount('tasks', 0);
        $this->assertSame('pending', AiOutput::find($outputId)->decision_status);
    }

    public function test_the_role_is_matched_without_regard_to_case_and_stored_as_the_position_title(): void
    {
        $officer = $this->officer('President');
        [$outputId, $tasks, $preview] = $this->template();
        $this->assertContains('President', $preview->json('allowed_positions'));
        $tasks = array_map(fn (array $task) => [...$task, 'recommended_role' => $task['recommended_role'] ? strtolower($task['recommended_role']) : null], $this->assign($tasks, $officer->school_id));

        $this->postJson("/api/events/{$this->event->id}/workflows/{$outputId}/confirm", ['tasks' => $tasks])->assertCreated();

        $roles = Task::where('event_id', $this->event->id)->whereNotNull('preferred_role')->pluck('preferred_role')->unique()->all();
        $this->assertSame(['President'], $roles);
    }

    public function test_one_bad_explanation_does_not_discard_the_valid_ones(): void
    {
        $officer = $this->officer('President');
        [$outputId, $tasks] = $this->template();
        Http::swap(new HttpFactory);
        Http::fake(function ($request) {
            $input = json_decode((string) $request->data()['input'], true);

            return Http::response(['model' => 'test-model', 'output_text' => json_encode(['explanations' => collect($input['recommendations'])->values()->map(fn ($row, $index) => [
                'task_id' => $row['task_id'],
                'explanation' => $index === 0 ? 'Ranked 99 with a score of 12345.' : "Officer {$row['officer_id']} ranked {$row['rank']} with a total score of {$row['total_score']}.",
            ])->all()])]);
        });

        $this->postJson("/api/events/{$this->event->id}/workflows/{$outputId}/confirm", ['tasks' => $this->assign($tasks, $officer->school_id)])->assertCreated();

        $count = count($tasks);
        $this->assertSame($count - 1, AiOutput::where('feature_type', 'TASK_EXPLANATION')->where('status', 'completed')->count());
        $this->assertSame(1, AiOutput::where('feature_type', 'TASK_EXPLANATION')->where('status', 'failed')->count());
        $audit = \DB::table('audit_logs')->where('action', 'task_explanations_generated')->first();
        $this->assertSame($count - 1, json_decode($audit->new_values, true)['generated_count']);
        $this->assertSame(1, json_decode($audit->new_values, true)['failed_count']);
    }

    public function test_a_draft_cannot_be_confirmed_when_the_event_already_has_an_accepted_list(): void
    {
        $officer = $this->officer('President');
        [$firstId] = $this->template();
        [$secondId, $tasks] = $this->template();
        AiOutput::whereKey($firstId)->update(['decision_status' => 'accepted']);

        $this->postJson("/api/events/{$this->event->id}/workflows/{$secondId}/confirm", ['tasks' => $this->assign($tasks, $officer->school_id)])
            ->assertStatus(409);
        $this->assertDatabaseCount('tasks', 0);
    }

    public function test_confirming_twice_creates_one_task_set(): void
    {
        $officer = $this->officer('President');
        [$outputId, $tasks] = $this->template();
        $payload = ['tasks' => $this->assign($tasks, $officer->school_id)];

        $this->postJson("/api/events/{$this->event->id}/workflows/{$outputId}/confirm", $payload)->assertCreated();
        $this->postJson("/api/events/{$this->event->id}/workflows/{$outputId}/confirm", $payload)->assertStatus(409);

        $this->assertSame(count($tasks), Task::where('event_id', $this->event->id)->count());
    }

    public function test_removing_a_draft_that_was_saved_in_the_meantime_is_refused_and_leaves_it_accepted(): void
    {
        [$outputId] = $this->template();
        AiOutput::retrieved(function (AiOutput $output) {
            if ($output->decision_status === 'pending') {
                DB::table('ai_outputs')->where('id', $output->id)->update(['decision_status' => 'accepted']);
            }
        });

        $this->patchJson("/api/events/{$this->event->id}/workflows/{$outputId}/discard")->assertStatus(409);

        $this->assertSame('accepted', AiOutput::find($outputId)->decision_status);
        $this->assertSame(0, AuditLog::where('action', 'workflow_discarded')->count());
    }

    public function test_confirm_locks_the_event_before_any_draft(): void
    {
        $officer = $this->officer('President');
        [$outputId, $tasks] = $this->template();
        $statements = [];
        $recording = false;
        DB::listen(function ($query) use (&$statements, &$recording) {
            if ($recording) {
                $statements[] = $query->sql;
            }
        });
        $this->app['events']->listen(TransactionBeginning::class, function () use (&$recording) {
            $recording = true;
        });

        $this->postJson("/api/events/{$this->event->id}/workflows/{$outputId}/confirm", ['tasks' => $this->assign($tasks, $officer->school_id)])->assertCreated();

        $firstEvent = collect($statements)->search(fn ($sql) => str_contains($sql, 'from "events"'));
        $firstDraft = collect($statements)->search(fn ($sql) => str_contains($sql, 'from "ai_outputs"'));
        $this->assertNotFalse($firstEvent);
        $this->assertLessThan($firstDraft, $firstEvent);
    }

    public function test_the_template_says_the_suggested_plan_failed_checks_when_the_model_answered(): void
    {
        Http::swap(new HttpFactory);
        Http::fake(['*' => Http::response(['model' => 'test-model', 'output_text' => json_encode(['overview' => 'Thin plan.'])])]);
        $rejected = $this->postJson("/api/events/{$this->event->id}/generate-plan", ['requirements' => 'Bring the band.'])->assertCreated();

        $this->assertStringContainsString('did not pass the checks', $rejected->json('workflow.overview'));
        $this->assertStringNotContainsString('not available', $rejected->json('workflow.overview'));
        $this->assertSame('event-workflow-template-v1', $rejected->json('ai_output.context_version'));
        $this->assertSame('Bring the band.', $rejected->json('ai_output.structured_input.requirements'));

        [, , $unavailable] = $this->template();
        $this->assertStringContainsString('not available right now', $unavailable->json('workflow.overview'));
    }
}
