<?php

namespace Tests\Feature;

use App\Console\Commands\MarkOverdueTasks;
use App\Models\AccountProfile;
use App\Models\AuditLog;
use App\Models\Event;
use App\Models\Organization;
use App\Models\SboPosition;
use App\Models\Task;
use App\Models\User;
use App\Services\TaskDelegationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class TasksAiAuditFixesTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.hiusa_ai.enabled' => false]);
        $this->organization = Organization::factory()->create();
        $this->admin = User::factory()->create(['organization_id' => $this->organization->id, 'role' => 'ADMIN', 'account_status' => 'active']);
        foreach (['President', 'Secretary', 'Treasurer'] as $title) {
            SboPosition::create(['organization_id' => $this->organization->id, 'role' => 'SBO_OFFICER', 'title' => $title, 'is_active' => true]);
        }
        Sanctum::actingAs($this->admin);
    }

    private function officer(string $title = 'Secretary'): User
    {
        return User::factory()->create(['organization_id' => $this->organization->id, 'role' => 'SBO_OFFICER', 'position_title' => $title, 'account_status' => 'active']);
    }

    private function task(array $attributes = []): Task
    {
        return Task::create([
            'organization_id' => $this->organization->id,
            'created_by' => $this->admin->school_id,
            'title' => 'Prepare minutes',
            'deadline' => now()->addWeek(),
            'status' => 'pending',
            ...$attributes,
        ]);
    }

    public function test_officers_seated_through_an_account_profile_are_eligible_and_scored_with_the_profile_role(): void
    {
        $handedOver = User::factory()->create(['organization_id' => $this->organization->id, 'role' => 'STUDENT', 'position_title' => null, 'account_status' => 'active']);
        AccountProfile::where('user_school_id', $handedOver->school_id)->where('organization_id', $this->organization->id)
            ->update(['role' => 'SBO_OFFICER', 'position_title' => 'Treasurer']);
        $elsewhere = User::factory()->create(['organization_id' => Organization::factory(), 'role' => 'STUDENT', 'position_title' => null, 'account_status' => 'active']);
        AccountProfile::create(['user_school_id' => $elsewhere->school_id, 'organization_id' => $this->organization->id, 'role' => 'SBO_OFFICER', 'account_status' => 'active', 'position_title' => 'President']);
        $steppedDown = $this->officer('Secretary');
        AccountProfile::where('user_school_id', $steppedDown->school_id)->where('organization_id', $this->organization->id)->update(['role' => 'STUDENT', 'position_title' => null]);

        $ranked = $this->postJson('/api/tasks/recommendation', ['title' => 'Prepare the budget'])->assertOk()->json('delegation.rankings');
        $this->assertEqualsCanonicalizing([$handedOver->school_id, $elsewhere->school_id], array_column($ranked, 'officer_id'));
        $this->assertSame($handedOver->school_id, $ranked[0]['officer_id']);

        $planner = app(TaskDelegationService::class)->recommend($this->organization->id, 'Prepare the budget');
        $this->assertEqualsCanonicalizing([$handedOver->school_id, $elsewhere->school_id], array_column($planner['rankings'], 'officer_id'));

        $this->postJson('/api/tasks', ['title' => 'Prepare the budget', 'deadline' => now()->addWeek()->toDateString(), 'status' => 'pending', 'task_kind' => 'standalone', 'assigned_to' => $handedOver->school_id])
            ->assertCreated()->assertJsonPath('assigned_to', $handedOver->school_id);
        $this->postJson('/api/tasks', ['title' => 'Prepare the budget', 'deadline' => now()->addWeek()->toDateString(), 'status' => 'pending', 'task_kind' => 'standalone', 'assigned_to' => $steppedDown->school_id])
            ->assertUnprocessable();
    }

    public function test_the_engine_is_sent_the_profile_role_and_position_of_a_seated_officer(): void
    {
        config(['services.hiusa_ai.enabled' => true]);
        Http::fake(['*' => Http::response([], 500)]);
        $seated = User::factory()->create(['organization_id' => $this->organization->id, 'role' => 'STUDENT', 'position_title' => null, 'account_status' => 'active']);
        AccountProfile::where('user_school_id', $seated->school_id)->where('organization_id', $this->organization->id)
            ->update(['role' => 'SBO_OFFICER', 'position_title' => 'Treasurer']);

        $this->postJson('/api/tasks/recommendation', ['title' => 'Prepare the budget'])->assertOk();

        Http::assertSent(function ($request) use ($seated) {
            $officer = collect($request['officers'] ?? [])->firstWhere('officer_id', $seated->school_id);

            return $officer !== null && $officer['role'] === 'SBO_OFFICER' && $officer['position_title'] === 'Treasurer' && $officer['policy_eligible'] === true;
        });
    }

    public function test_a_date_only_deadline_is_stored_at_the_end_of_that_day(): void
    {
        $officer = $this->officer();
        $date = now()->addDays(5)->toDateString();

        $id = $this->postJson('/api/tasks', ['title' => 'Prepare minutes', 'deadline' => $date, 'status' => 'pending', 'task_kind' => 'standalone', 'assigned_to' => $officer->school_id])
            ->assertCreated()->json('id');

        $this->assertSame($date.' 23:59:59', Task::find($id)->deadline->format('Y-m-d H:i:s'));
    }

    public function test_the_overdue_command_leaves_a_task_due_today_until_the_day_has_ended(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-11-20 00:05:00', config('app.timezone')));
        $legacyDueToday = $this->task(['title' => 'Due today, stored as a bare date', 'deadline' => '2026-11-20 00:00:00']);
        $legacyDueYesterday = $this->task(['title' => 'Due yesterday, stored as a bare date', 'deadline' => '2026-11-19 00:00:00']);
        $endOfYesterday = $this->task(['title' => 'Due yesterday at end of day', 'deadline' => '2026-11-19 23:59:59']);
        $timedEarlier = $this->task(['title' => 'Due at a time already past', 'deadline' => '2026-11-19 14:00:00']);
        $dueTonight = $this->task(['title' => 'Due tonight', 'deadline' => '2026-11-20 23:59:59']);

        $this->artisan(MarkOverdueTasks::class)->assertSuccessful();

        $this->assertSame('pending', $legacyDueToday->fresh()->status);
        $this->assertSame('pending', $dueTonight->fresh()->status);
        $this->assertSame('overdue', $legacyDueYesterday->fresh()->status);
        $this->assertSame('overdue', $endOfYesterday->fresh()->status);
        $this->assertSame('overdue', $timedEarlier->fresh()->status);
        Carbon::setTestNow();
    }

    public function test_an_overdue_task_can_be_renamed_or_reassigned_while_keeping_its_deadline(): void
    {
        $current = $this->officer('Secretary');
        $next = $this->officer('Treasurer');
        $task = $this->task(['assigned_to' => $current->school_id, 'status' => 'overdue', 'deadline' => now()->subDays(3)->setTime(17, 0)]);
        $stored = $task->deadline->format('Y-m-d\TH:i');

        $this->putJson('/api/tasks/'.$task->id, ['title' => 'Prepare the minutes', 'deadline' => $stored, 'assigned_to' => $next->school_id])
            ->assertOk()->assertJsonPath('title', 'Prepare the minutes')->assertJsonPath('assigned_to', $next->school_id);
        $this->assertSame($stored, $task->fresh()->deadline->format('Y-m-d\TH:i'));

        $this->putJson('/api/tasks/'.$task->id, ['deadline' => now()->subDay()->format('Y-m-d\TH:i')])
            ->assertUnprocessable()->assertJsonValidationErrors('deadline');
    }

    public function test_editing_a_workflow_task_keeps_its_time_and_the_phase_window(): void
    {
        $officer = $this->officer();
        $event = Event::factory()->create([
            'organization_id' => $this->organization->id,
            'created_by' => $this->admin->school_id,
            'status' => 'approved',
            'start_time' => now()->addDays(10)->setTime(9, 0),
            'end_time' => now()->addDays(10)->setTime(17, 0),
        ]);
        $task = $this->task(['assigned_to' => $officer->school_id, 'event_id' => $event->id, 'phase' => 'event_day', 'deadline' => now()->addDays(10)->setTime(14, 0)]);

        $this->putJson('/api/tasks/'.$task->id, ['deadline' => now()->addDays(10)->format('Y-m-d')])
            ->assertUnprocessable()->assertJsonPath('errors.deadline.0', 'The deadline for this task must be during the event.');
        $this->putJson('/api/tasks/'.$task->id, ['deadline' => now()->addDays(9)->setTime(23, 0)->format('Y-m-d\TH:i')])
            ->assertUnprocessable();
        $this->putJson('/api/tasks/'.$task->id, ['title' => 'Run registration', 'deadline' => now()->addDays(10)->setTime(14, 0)->format('Y-m-d\TH:i')])
            ->assertOk();
        $this->assertSame('14:00', $task->fresh()->deadline->format('H:i'));
        $this->putJson('/api/tasks/'.$task->id, ['deadline' => now()->addDays(10)->setTime(15, 30)->format('Y-m-d\TH:i')])->assertOk();
        $this->assertSame('15:30', $task->fresh()->deadline->format('H:i'));
    }

    public function test_reassigning_a_task_requires_an_eligible_officer_and_records_the_real_recommendation(): void
    {
        config(['services.hiusa_ai.task_max_active_tasks' => 2]);
        $current = $this->officer('Secretary');
        $full = $this->officer('Treasurer');
        $free = $this->officer('President');
        foreach (range(1, 2) as $number) {
            $this->task(['title' => "Busy work {$number}", 'assigned_to' => $full->school_id]);
        }
        $task = $this->task(['assigned_to' => $current->school_id]);

        $this->putJson('/api/tasks/'.$task->id, ['assigned_to' => $full->school_id])
            ->assertUnprocessable()->assertJsonPath('errors.assigned_to.0', fn ($message) => str_contains($message, 'eligible'));
        $this->assertSame($current->school_id, $task->fresh()->assigned_to);

        $this->putJson('/api/tasks/'.$task->id, ['assigned_to' => $free->school_id])->assertOk()->assertJsonPath('assigned_to', $free->school_id);

        $fresh = $task->fresh();
        $this->assertContains($free->school_id, array_column($fresh->delegation_snapshot['rankings'], 'officer_id'));
        $this->assertNotContains($full->school_id, array_column($fresh->delegation_snapshot['rankings'], 'officer_id'));
        $this->assertGreaterThan(1, count($fresh->delegation_snapshot['rankings']));
        $this->assertSame(
            $fresh->delegation_snapshot['rankings'][0]['officer_id'],
            $fresh->delegation_snapshot['recommended_officer_id']
        );
        $this->assertTrue(DB::table('task_recommendations')->where('task_id', $task->id)->where('officer_id', $free->school_id)->exists());
        $this->assertTrue(AuditLog::where('action', 'task_delegated')->where('record_id', $task->id)->exists());
    }

    public function test_a_put_cannot_change_status_progress_or_completion(): void
    {
        $officer = $this->officer();
        $first = $this->task(['assigned_to' => $officer->school_id, 'status' => 'pending']);
        $blocked = $this->task(['assigned_to' => $officer->school_id, 'status' => 'pending', 'depends_on_task_id' => $first->id]);

        $this->putJson('/api/tasks/'.$blocked->id, ['status' => 'completed'])->assertUnprocessable()->assertJsonValidationErrors('status');
        $this->putJson('/api/tasks/'.$blocked->id, ['progress_percent' => 90])->assertUnprocessable()->assertJsonValidationErrors('progress_percent');
        $this->putJson('/api/tasks/'.$blocked->id, ['completed_at' => now()->toDateTimeString()])->assertUnprocessable()->assertJsonValidationErrors('completed_at');
        $this->assertSame('pending', $blocked->fresh()->status);

        $this->patchJson('/api/tasks/'.$blocked->id.'/status', ['status' => 'completed'])->assertUnprocessable();
    }

    public function test_a_task_cannot_be_created_already_completed_or_overdue(): void
    {
        $officer = $this->officer();
        foreach (['completed', 'overdue'] as $status) {
            $this->postJson('/api/tasks', ['title' => 'Prepare minutes', 'deadline' => now()->addWeek()->toDateString(), 'status' => $status, 'task_kind' => 'standalone', 'assigned_to' => $officer->school_id])
                ->assertUnprocessable()->assertJsonValidationErrors('status');
        }
        $this->assertSame(0, Task::count());
    }

    public function test_a_chosen_category_decides_the_task_area_over_title_keywords(): void
    {
        $service = app(TaskDelegationService::class);

        $this->assertSame('logistics', $service->inferArea('Print the attendance report', 'logistics'));
        $this->assertSame('publicity', $service->inferArea('Budget poster', 'Publicity'));
        $this->assertSame('finance', $service->inferArea('Budget poster', 'workflow'));
        $this->assertSame('finance', $service->inferArea('Budget poster', null));

        $this->officer('Secretary');
        $this->postJson('/api/tasks/recommendation', ['title' => 'Print the attendance report', 'category' => 'logistics'])
            ->assertOk()->assertJsonPath('delegation.task_area', 'logistics');
    }

    public function test_workflow_delegation_snapshots_read_like_standalone_ones(): void
    {
        $this->officer();

        $result = app(TaskDelegationService::class)->recommend($this->organization->id, 'Prepare the venue', 'workflow');

        $this->assertSame('php-service', $result['engine']);
        $this->assertContains('officer must be marked available', $result['eligibility_rules']);
        $this->assertContains('active task count must be below 5', $result['eligibility_rules']);
        $this->assertTrue(array_is_list($result['eligibility_rules']));
    }

    public function test_scoring_runs_a_bounded_number_of_queries_however_many_officers_there_are(): void
    {
        foreach (range(1, 12) as $number) {
            $officer = $this->officer(['President', 'Secretary', 'Treasurer'][$number % 3]);
            $this->task(['assigned_to' => $officer->school_id, 'status' => 'completed']);
        }

        DB::flushQueryLog();
        DB::enableQueryLog();
        $result = app(TaskDelegationService::class)->recommend($this->organization->id, 'Prepare the venue', 'workflow');
        $queries = count(DB::getQueryLog());
        DB::disableQueryLog();

        $this->assertCount(12, $result['rankings']);
        $this->assertLessThanOrEqual(6, $queries);
    }
}
