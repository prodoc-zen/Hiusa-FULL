<?php

namespace Tests\Feature;

use App\Models\Announcement;
use App\Models\ApprovalRequest;
use App\Models\Attendance;
use App\Models\Budget;
use App\Models\Candidate;
use App\Models\Election;
use App\Models\ElectionPosition;
use App\Models\Event;
use App\Models\FinancialReport;
use App\Models\Merchandise;
use App\Models\Notification;
use App\Models\Order;
use App\Models\Organization;
use App\Models\Task;
use App\Models\Transaction;
use App\Models\User;
use App\Models\Vote;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class UseCaseComplianceTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $role, ?int $organizationId = null): User
    {
        return User::factory()->create([
            'role' => $role,
            'organization_id' => $organizationId ?? Organization::factory(),
            'account_status' => 'active',
        ]);
    }

    private function authenticate(User $user): void
    {
        Sanctum::actingAs($user);
    }

    public function test_admin_user_management_is_tenant_scoped_and_protects_the_last_admin(): void
    {
        $admin = $this->user('ADMIN');
        $otherOrganization = Organization::factory()->create();
        $this->authenticate($admin);

        $created = $this->postJson('/api/users', [
            'organization_id' => $otherOrganization->id,
            'school_id' => 87654321,
            'first_name' => 'Scoped',
            'last_name' => 'Student',
            'email' => 'scoped.student@example.test',
            'password' => 'password123',
            'password_confirmation' => 'password123',
            'role' => 'STUDENT',
        ])->assertCreated();

        $created->assertJsonPath('organization_id', $admin->organization_id);
        $this->putJson("/api/users/{$created->json('school_id')}", [
            'organization_id' => $otherOrganization->id,
            'school_id' => 12345678,
            'first_name' => 'Still Scoped',
        ])->assertOk()
            ->assertJsonPath('organization_id', $admin->organization_id)
            ->assertJsonPath('school_id', 87654321);

        $this->assertDatabaseMissing('users', ['school_id' => 12345678]);

        $this->postJson("/api/users/{$created->json('school_id')}/disable")->assertOk();
        $this->assertDatabaseHas('users', ['school_id' => 87654321, 'account_status' => 'disabled']);

        $this->postJson("/api/users/{$created->json('school_id')}/reactivate")
            ->assertOk()
            ->assertJsonPath('account_status', 'active');
        $reactivatedUser = User::findOrFail($created->json('school_id'));
        $this->assertTrue(Hash::check('password123', $reactivatedUser->password_hash));

        $this->putJson("/api/users/{$admin->school_id}", ['account_status' => 'disabled'])
            ->assertUnprocessable();
        $this->postJson("/api/users/{$admin->school_id}/disable")
            ->assertUnprocessable();

        $disabledAdmin = $this->user('ADMIN', $admin->organization_id);
        $disabledAdmin->update(['account_status' => 'disabled']);
        $this->putJson("/api/users/{$admin->school_id}", ['role' => 'STUDENT'])
            ->assertUnprocessable();

        $this->assertDatabaseHas('audit_logs', [
            'module' => 'users',
            'action' => 'created',
            'record_id' => $created->json('school_id'),
        ]);
        $this->assertDatabaseHas('audit_logs', [
            'module' => 'users',
            'action' => 'reactivated',
            'record_id' => $created->json('school_id'),
        ]);
    }

    public function test_mark_all_notifications_route_updates_only_the_current_user(): void
    {
        $student = $this->user('STUDENT');
        $other = $this->user('STUDENT', $student->organization_id);
        foreach ([$student, $student, $other] as $recipient) {
            Notification::create([
                'organization_id' => $student->organization_id,
                'user_id' => $recipient->school_id,
                'title' => 'Notice',
                'message' => 'Unread notice',
                'is_read' => false,
            ]);
        }
        $futureNotification = Notification::create([
            'organization_id' => $student->organization_id,
            'user_id' => $student->school_id,
            'title' => 'Future notice',
            'message' => 'Do not mark this before delivery.',
            'scheduled_at' => now()->addDay(),
            'is_read' => false,
        ]);

        $this->authenticate($student);
        $this->patchJson('/api/notifications/read-all')->assertOk();

        $this->assertSame(1, Notification::where('user_id', $student->school_id)->where('is_read', false)->count());
        $this->assertFalse($futureNotification->fresh()->is_read);
        $this->assertSame(1, Notification::where('user_id', $other->school_id)->where('is_read', false)->count());
    }

    public function test_events_cannot_bypass_approval_and_rejections_require_remarks(): void
    {
        $admin = $this->user('ADMIN');
        $departmentHead = $this->user('DEPARTMENT_HEAD', $admin->organization_id);
        $student = $this->user('STUDENT', $admin->organization_id);
        $this->authenticate($admin);
        $eventId = $this->postJson('/api/events', [
            'title' => 'Approval Protected Event',
            'start_time' => now()->addWeek(),
            'end_time' => now()->addWeek()->addHours(2),
        ])->assertCreated()->json('id');

        $this->putJson("/api/events/{$eventId}", ['status' => 'approved'])->assertUnprocessable();
        $approval = ApprovalRequest::where('entity_type', 'event')->where('entity_id', $eventId)->firstOrFail();

        $this->authenticate($departmentHead);
        $this->patchJson("/api/approval-requests/{$approval->id}", ['status' => 'rejected'])
            ->assertUnprocessable();
        $this->patchJson("/api/approval-requests/{$approval->id}", [
            'status' => 'approved',
        ])->assertOk();

        $this->assertDatabaseHas('events', ['id' => $eventId, 'status' => 'approved']);
        $this->assertDatabaseHas('audit_logs', ['module' => 'approvals', 'action' => 'reviewed_approved']);
        $this->assertDatabaseHas('notifications', [
            'user_id' => $student->school_id,
            'notification_type' => 'event',
            'reference_id' => $eventId,
        ]);

        Task::create([
            'organization_id' => $admin->organization_id,
            'event_id' => $eventId,
            'created_by' => $admin->school_id,
            'title' => 'Private officer task',
            'status' => 'pending',
            'deadline' => now()->addWeek(),
        ]);
        Attendance::create([
            'event_id' => $eventId,
            'user_id' => $departmentHead->school_id,
            'recorded_by' => $admin->school_id,
            'method' => 'manual',
            'check_in_time' => now(),
        ]);
        $this->authenticate($student);
        $this->getJson("/api/events/{$eventId}")
            ->assertOk()
            ->assertJsonMissingPath('tasks')
            ->assertJsonMissingPath('attendance_records');
    }

    public function test_admin_can_monitor_attendance_and_linked_budget_status_per_event(): void
    {
        $admin = $this->user('ADMIN');
        $student = $this->user('STUDENT', $admin->organization_id);
        $event = Event::factory()->create([
            'organization_id' => $admin->organization_id,
            'created_by' => $admin->school_id,
            'status' => 'approved',
            'approved_at' => now(),
            'requires_budget' => true,
        ]);
        $otherEvent = Event::factory()->create([
            'organization_id' => $admin->organization_id,
            'created_by' => $admin->school_id,
            'status' => 'approved',
            'approved_at' => now(),
        ]);
        $linkedBudget = Budget::create([
            'organization_id' => $admin->organization_id,
            'event_id' => $event->id,
            'title' => 'Linked Event Budget',
            'allocated_amount' => 1000,
            'remaining_amount' => 750,
            'warning_threshold' => 200,
        ]);
        Budget::create([
            'organization_id' => $admin->organization_id,
            'event_id' => $otherEvent->id,
            'title' => 'Other Event Budget',
            'allocated_amount' => 500,
            'remaining_amount' => 500,
            'warning_threshold' => 100,
        ]);
        ApprovalRequest::create([
            'organization_id' => $admin->organization_id,
            'entity_type' => 'budget',
            'entity_id' => $linkedBudget->id,
            'requested_by' => $admin->school_id,
            'required_role' => 'DEPARTMENT_HEAD',
            'status' => 'approved',
        ]);
        Attendance::create([
            'event_id' => $event->id,
            'user_id' => $student->school_id,
            'recorded_by' => $admin->school_id,
            'method' => 'manual',
            'status' => 'present',
            'check_in_time' => now(),
        ]);

        $this->authenticate($admin);
        $this->getJson('/api/events')
            ->assertOk()
            ->assertJsonFragment([
                'id' => $linkedBudget->id,
                'approval_status' => 'approved',
            ]);
        $this->getJson("/api/events/{$event->id}")
            ->assertOk()
            ->assertJsonCount(1, 'budgets')
            ->assertJsonPath('budgets.0.id', $linkedBudget->id)
            ->assertJsonPath('budgets.0.approval_status', 'approved')
            ->assertJsonPath('attendance_summary.present', 1);

        $this->authenticate($student);
        $this->getJson("/api/events/{$event->id}")
            ->assertOk()
            ->assertJsonMissingPath('budgets')
            ->assertJsonMissingPath('attendance_summary');
    }

    public function test_only_approved_budgets_are_spendable_and_overspending_is_reversible(): void
    {
        $admin = $this->user('ADMIN');
        $departmentHead = $this->user('DEPARTMENT_HEAD', $admin->organization_id);
        $this->authenticate($admin);
        $budgetId = $this->postJson('/api/budgets', [
            'title' => 'Operations Budget',
            'allocated_amount' => 100,
            'warning_threshold' => 20,
        ])->assertCreated()->json('id');
        $transaction = [
            'budget_id' => $budgetId,
            'type' => 'expense',
            'amount' => 150,
            'category' => 'Operations',
            'description' => 'Supplies',
            'transaction_date' => now()->toDateString(),
        ];

        $this->postJson('/api/transactions', $transaction)->assertUnprocessable();
        $approval = ApprovalRequest::where('entity_type', 'budget')->where('entity_id', $budgetId)->firstOrFail();
        $this->authenticate($departmentHead);
        $this->patchJson("/api/approval-requests/{$approval->id}", ['status' => 'approved'])->assertOk();

        $this->authenticate($admin);
        $transactionId = $this->postJson('/api/transactions', $transaction)->assertCreated()->json('id');
        $this->assertDatabaseHas('budgets', ['id' => $budgetId, 'remaining_amount' => -50, 'overspending_risk' => 'high']);
        $this->deleteJson("/api/transactions/{$transactionId}")->assertOk();
        $this->assertDatabaseHas('budgets', ['id' => $budgetId, 'remaining_amount' => 100, 'overspending_risk' => 'low']);
    }

    public function test_transaction_event_must_match_its_linked_budget(): void
    {
        $admin = $this->user('ADMIN');
        $event = Event::factory()->create([
            'organization_id' => $admin->organization_id,
            'created_by' => $admin->school_id,
        ]);
        $otherEvent = Event::factory()->create([
            'organization_id' => $admin->organization_id,
            'created_by' => $admin->school_id,
        ]);
        $budget = Budget::create([
            'organization_id' => $admin->organization_id,
            'event_id' => $event->id,
            'title' => 'Event-specific Budget',
            'allocated_amount' => 1000,
            'remaining_amount' => 1000,
            'warning_threshold' => 100,
        ]);
        ApprovalRequest::create([
            'organization_id' => $admin->organization_id,
            'entity_type' => 'budget',
            'entity_id' => $budget->id,
            'requested_by' => $admin->school_id,
            'required_role' => 'DEPARTMENT_HEAD',
            'status' => 'approved',
        ]);
        $this->authenticate($admin);
        $transaction = [
            'budget_id' => $budget->id,
            'type' => 'expense',
            'amount' => 50,
            'category' => 'Events',
            'description' => 'Venue supplies',
            'transaction_date' => now()->toDateString(),
        ];

        $this->postJson('/api/transactions', [...$transaction, 'event_id' => $otherEvent->id])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'The selected budget is linked to a different event.');

        $this->postJson('/api/transactions', $transaction)
            ->assertCreated()
            ->assertJsonPath('event_id', $event->id);
    }

    public function test_approved_budget_changes_reopen_approval_before_more_spending(): void
    {
        $admin = $this->user('ADMIN');
        $departmentHead = $this->user('DEPARTMENT_HEAD', $admin->organization_id);
        $this->authenticate($admin);

        $budgetId = $this->postJson('/api/budgets', [
            'title' => 'Conference Budget',
            'allocated_amount' => 500,
            'warning_threshold' => 100,
        ])->assertCreated()->json('id');

        $approval = ApprovalRequest::where('entity_type', 'budget')->where('entity_id', $budgetId)->firstOrFail();
        $this->authenticate($departmentHead);
        $this->patchJson("/api/approval-requests/{$approval->id}", ['status' => 'approved'])->assertOk();

        $this->authenticate($admin);
        $this->putJson("/api/budgets/{$budgetId}", ['allocated_amount' => 750])->assertOk();
        $this->assertDatabaseHas('approval_requests', ['id' => $approval->id, 'status' => 'pending']);

        $this->postJson('/api/transactions', [
            'budget_id' => $budgetId,
            'type' => 'expense',
            'amount' => 25,
            'category' => 'Operations',
            'description' => 'Reopened budget spend',
            'transaction_date' => now()->toDateString(),
        ])->assertUnprocessable();
    }

    public function test_ols_forecast_is_generated_from_monthly_transactions(): void
    {
        $admin = $this->user('ADMIN');
        foreach ([
            ['date' => now()->subMonth()->startOfMonth(), 'type' => 'income', 'amount' => 1000],
            ['date' => now()->subMonth()->startOfMonth(), 'type' => 'expense', 'amount' => 600],
            ['date' => now()->startOfMonth(), 'type' => 'income', 'amount' => 1200],
            ['date' => now()->startOfMonth(), 'type' => 'expense', 'amount' => 700],
        ] as $row) {
            Transaction::create([
                'organization_id' => $admin->organization_id,
                'recorded_by' => $admin->school_id,
                'type' => $row['type'],
                'amount' => $row['amount'],
                'category' => 'General',
                'description' => 'Forecast source',
                'transaction_date' => $row['date'],
            ]);
        }

        $this->authenticate($admin);
        $response = $this->postJson('/api/forecasts/generate', ['months' => 12])
            ->assertCreated()
            ->assertJsonPath('model_details.algorithm', 'ordinary_least_squares');

        $this->assertSame('1400.00', $response->json('predicted_income'));
        $this->assertSame('800.00', $response->json('predicted_expense'));
        $this->assertDatabaseHas('ai_outputs', ['feature_type' => 'financial_summary', 'reference_id' => $response->json('id')]);
    }

    public function test_task_assignment_recommends_an_active_sbo_officer_and_calculates_scores(): void
    {
        $admin = $this->user('ADMIN');
        $busyOfficer = $this->user('SBO_OFFICER', $admin->organization_id);
        $availableOfficer = $this->user('SBO_OFFICER', $admin->organization_id);
        foreach (range(1, 3) as $number) {
            Task::create([
                'organization_id' => $admin->organization_id,
                'created_by' => $admin->school_id,
                'assigned_to' => $busyOfficer->school_id,
                'title' => "Existing task {$number}",
                'status' => 'pending',
                'deadline' => now()->addDays($number),
            ]);
        }

        $this->authenticate($admin);
        $response = $this->postJson('/api/tasks', [
            'title' => 'Recommended assignment',
            'deadline' => now()->addWeek(),
            'status' => 'pending',
        ])->assertCreated();

        $response->assertJsonPath('assigned_to', $availableOfficer->school_id);
        $this->assertGreaterThan(0, (float) $response->json('final_score'));
        $this->assertNotEmpty($response->json('ai_recommendation_note'));
    }

    public function test_event_financial_report_is_computed_summarized_and_saved(): void
    {
        $admin = $this->user('ADMIN');
        $event = Event::create([
            'organization_id' => $admin->organization_id,
            'created_by' => $admin->school_id,
            'title' => 'Financial Report Event',
            'start_time' => now()->addDay()->startOfDay(),
            'end_time' => now()->addDay()->endOfDay(),
            'status' => 'approved',
            'approved_at' => now(),
        ]);
        foreach ([['income', 1000], ['expense', 350]] as [$type, $amount]) {
            Transaction::create([
                'organization_id' => $admin->organization_id,
                'event_id' => $event->id,
                'recorded_by' => $admin->school_id,
                'type' => $type,
                'amount' => $amount,
                'category' => 'Events',
                'description' => 'Event report source',
                'transaction_date' => now(),
            ]);
        }

        $this->authenticate($admin);
        $response = $this->postJson('/api/financial-reports/generate', [
            'report_type' => 'event',
            'event_id' => $event->id,
        ])->assertCreated()
            ->assertJsonPath('totals.income', 1000)
            ->assertJsonPath('totals.expense', 350)
            ->assertJsonPath('totals.balance', 650);

        $report = FinancialReport::findOrFail($response->json('report.id'));
        $this->assertSame([$response->json('transactions.0.id'), $response->json('transactions.1.id')], $report->source_transaction_ids);
        $this->assertNotEmpty($report->summary_text);
        $this->assertDatabaseHas('ai_outputs', ['reference_type' => FinancialReport::class, 'reference_id' => $report->id]);
    }

    public function test_approved_event_changes_reopen_department_head_approval(): void
    {
        $admin = $this->user('ADMIN');
        $departmentHead = $this->user('DEPARTMENT_HEAD', $admin->organization_id);

        $this->authenticate($admin);
        $eventId = $this->postJson('/api/events', [
            'title' => 'Approved Event',
            'start_time' => now()->addWeek(),
            'end_time' => now()->addWeek()->addHours(2),
        ])->assertCreated()->json('id');

        $approval = ApprovalRequest::where('entity_type', 'event')->where('entity_id', $eventId)->firstOrFail();
        $this->authenticate($departmentHead);
        $this->patchJson("/api/approval-requests/{$approval->id}", ['status' => 'approved'])->assertOk();

        $this->authenticate($admin);
        $this->putJson("/api/events/{$eventId}", ['location' => 'New Auditorium'])
            ->assertOk()
            ->assertJsonPath('status', 'planning')
            ->assertJsonPath('approved_at', null);

        $this->assertDatabaseHas('approval_requests', ['id' => $approval->id, 'status' => 'pending']);
    }

    public function test_election_enforces_voting_period_and_prevents_duplicate_ballots(): void
    {
        $student = $this->user('STUDENT');
        $candidateUser = $this->user('STUDENT', $student->organization_id);
        $election = Election::create([
            'organization_id' => $student->organization_id,
            'title' => 'Student Election',
            'start_time' => now()->addDay(),
            'end_time' => now()->addDays(2),
            'status' => 'active',
            'approved_at' => now(),
        ]);
        $position = ElectionPosition::create(['election_id' => $election->id, 'title' => 'President', 'max_winners' => 1]);
        $candidate = Candidate::create([
            'election_id' => $election->id,
            'position_id' => $position->id,
            'user_id' => $candidateUser->school_id,
        ]);
        $ballot = ['votes' => [['position_id' => $position->id, 'candidate_id' => $candidate->id]]];

        $this->authenticate($student);
        $this->postJson("/api/elections/{$election->id}/vote", $ballot)
            ->assertUnprocessable()
            ->assertJsonPath('message', fn (string $message) => str_contains($message, 'Voting period has not started yet.'));
        $election->update(['start_time' => now()->subHour(), 'end_time' => now()->addHour()]);
        $this->postJson("/api/elections/{$election->id}/vote", $ballot)->assertOk();
        $this->postJson("/api/elections/{$election->id}/vote", $ballot)->assertUnprocessable();
    }

    public function test_approved_elections_follow_their_scheduled_opening_and_closing_times(): void
    {
        $student = $this->user('STUDENT');
        $scheduledToOpen = Election::create([
            'organization_id' => $student->organization_id,
            'title' => 'Scheduled to Open',
            'start_time' => now()->subMinute(),
            'end_time' => now()->addHour(),
            'status' => 'upcoming',
            'approved_at' => now()->subDay(),
            'results_visible' => true,
        ]);
        $scheduledToClose = Election::create([
            'organization_id' => $student->organization_id,
            'title' => 'Scheduled to Close',
            'start_time' => now()->subHours(2),
            'end_time' => now()->subMinute(),
            'status' => 'active',
            'approved_at' => now()->subDay(),
            'results_visible' => true,
        ]);
        $manuallyClosed = Election::create([
            'organization_id' => $student->organization_id,
            'title' => 'Manually Closed',
            'start_time' => now()->subMinute(),
            'end_time' => now()->addHour(),
            'status' => 'closed',
            'approved_at' => now()->subDay(),
            'results_visible' => true,
        ]);

        $this->authenticate($student);
        $this->getJson('/api/elections')
            ->assertOk()
            ->assertJsonFragment(['id' => $scheduledToOpen->id, 'status' => 'active'])
            ->assertJsonFragment(['id' => $scheduledToClose->id, 'status' => 'closed']);

        $this->assertDatabaseHas('elections', ['id' => $scheduledToOpen->id, 'status' => 'active']);
        $this->assertDatabaseHas('elections', ['id' => $scheduledToClose->id, 'status' => 'closed']);
        $this->assertDatabaseHas('elections', ['id' => $manuallyClosed->id, 'status' => 'closed']);
    }

    public function test_admin_gets_clear_error_when_opening_election_outside_voting_period(): void
    {
        $admin = $this->user('ADMIN');
        $election = Election::create([
            'organization_id' => $admin->organization_id,
            'title' => 'Future Election',
            'start_time' => now()->addDay(),
            'end_time' => now()->addDays(2),
            'status' => 'upcoming',
            'approved_at' => now(),
        ]);

        $this->authenticate($admin);
        $this->putJson("/api/elections/{$election->id}", ['status' => 'active'])
            ->assertUnprocessable()
            ->assertJsonPath('message', fn (string $message) => str_contains($message, 'Voting period has not started yet.'));

        $election->update([
            'start_time' => now()->subDays(2),
            'end_time' => now()->subDay(),
        ]);

        $this->putJson("/api/elections/{$election->id}", ['status' => 'active'])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'Voting period has already ended. Update the end time before reopening this election.');
    }

    public function test_admin_can_reopen_a_manually_closed_election_during_its_voting_period(): void
    {
        $admin = $this->user('ADMIN');
        $election = Election::create([
            'organization_id' => $admin->organization_id,
            'title' => 'Reopenable Election',
            'start_time' => now()->subHour(),
            'end_time' => now()->addHour(),
            'status' => 'closed',
            'approved_at' => now()->subDay(),
        ]);

        $this->authenticate($admin);
        $this->putJson("/api/elections/{$election->id}", ['status' => 'active'])
            ->assertOk()
            ->assertJsonPath('status', 'active');

        $this->assertDatabaseHas('audit_logs', [
            'organization_id' => $admin->organization_id,
            'user_id' => $admin->school_id,
            'module' => 'elections',
            'action' => 'status_changed',
            'record_type' => Election::class,
            'record_id' => $election->id,
        ]);
    }

    public function test_approved_election_changes_reopen_approval_and_votes_lock_details(): void
    {
        $admin = $this->user('ADMIN');
        $departmentHead = $this->user('DEPARTMENT_HEAD', $admin->organization_id);
        $student = $this->user('STUDENT', $admin->organization_id);
        $candidateUser = $this->user('STUDENT', $admin->organization_id);

        $this->authenticate($admin);
        $electionId = $this->postJson('/api/elections', [
            'title' => 'Approved Election',
            'start_time' => now()->addDay(),
            'end_time' => now()->addDays(2),
        ])->assertCreated()->json('id');

        $approval = ApprovalRequest::where('entity_type', 'election')->where('entity_id', $electionId)->firstOrFail();
        $this->authenticate($departmentHead);
        $this->patchJson("/api/approval-requests/{$approval->id}", ['status' => 'approved'])->assertOk();

        $this->authenticate($admin);
        $this->putJson("/api/elections/{$electionId}", ['title' => 'Revised Election'])
            ->assertOk()
            ->assertJsonPath('status', 'pending_approval')
            ->assertJsonPath('approved_at', null);
        $this->assertDatabaseHas('approval_requests', ['id' => $approval->id, 'status' => 'pending']);

        $this->authenticate($departmentHead);
        $this->patchJson("/api/approval-requests/{$approval->id}", ['status' => 'approved'])->assertOk();
        $election = Election::findOrFail($electionId);
        $election->update(['status' => 'active', 'start_time' => now()->subHour(), 'end_time' => now()->addHour()]);
        $position = ElectionPosition::create(['election_id' => $election->id, 'title' => 'President', 'max_winners' => 1]);
        $candidate = Candidate::create([
            'election_id' => $election->id,
            'position_id' => $position->id,
            'user_id' => $candidateUser->school_id,
        ]);

        $this->authenticate($student);
        $this->postJson("/api/elections/{$election->id}/vote", [
            'votes' => [['position_id' => $position->id, 'candidate_id' => $candidate->id]],
        ])->assertOk();

        $this->authenticate($admin);
        $this->putJson("/api/elections/{$election->id}", ['title' => 'Unsafe Rename'])->assertConflict();
    }

    public function test_pending_approval_election_can_be_edited_without_bypassing_approval(): void
    {
        $admin = $this->user('ADMIN');

        $this->authenticate($admin);
        $electionId = $this->postJson('/api/elections', [
            'title' => 'Pending Election',
            'start_time' => now()->addDay(),
            'end_time' => now()->addDays(2),
        ])->assertCreated()->assertJsonPath('status', 'pending_approval')->json('id');

        $this->putJson("/api/elections/{$electionId}", [
            'title' => 'Updated Pending Election',
            'start_time' => now()->addDays(2),
            'end_time' => now()->addDays(3),
            'status' => 'pending_approval',
        ])->assertOk()
            ->assertJsonPath('title', 'Updated Pending Election')
            ->assertJsonPath('status', 'pending_approval')
            ->assertJsonPath('approved_at', null);

        $this->assertDatabaseHas('approval_requests', [
            'entity_type' => 'election',
            'entity_id' => $electionId,
            'status' => 'pending',
        ]);
    }

    public function test_election_creation_can_save_positions_with_the_approval_request(): void
    {
        $admin = $this->user('ADMIN');

        $this->authenticate($admin);
        $electionId = $this->postJson('/api/elections', [
            'title' => 'Complete Ballot Setup',
            'start_time' => now()->addDay(),
            'end_time' => now()->addDays(2),
            'positions' => [
                ['title' => 'President', 'max_winners' => 1],
                ['title' => 'Board Member', 'max_winners' => 3],
            ],
        ])->assertCreated()
            ->assertJsonCount(2, 'positions')
            ->assertJsonPath('positions.1.max_winners', 3)
            ->json('id');

        $this->assertDatabaseHas('election_positions', [
            'election_id' => $electionId,
            'title' => 'President',
        ]);
        $this->assertDatabaseHas('approval_requests', [
            'entity_type' => 'election',
            'entity_id' => $electionId,
            'status' => 'pending',
        ]);
    }

    public function test_ballot_submission_requires_every_official_position(): void
    {
        $student = $this->user('STUDENT');
        $firstCandidateUser = $this->user('STUDENT', $student->organization_id);
        $secondCandidateUser = $this->user('STUDENT', $student->organization_id);
        $election = Election::create([
            'organization_id' => $student->organization_id,
            'title' => 'Complete Ballot Validation',
            'start_time' => now()->subHour(),
            'end_time' => now()->addHour(),
            'status' => 'active',
            'approved_at' => now(),
        ]);
        $president = ElectionPosition::create(['election_id' => $election->id, 'title' => 'President', 'max_winners' => 1]);
        $treasurer = ElectionPosition::create(['election_id' => $election->id, 'title' => 'Treasurer', 'max_winners' => 1]);
        $presidentCandidate = Candidate::create(['election_id' => $election->id, 'position_id' => $president->id, 'user_id' => $firstCandidateUser->school_id]);
        Candidate::create(['election_id' => $election->id, 'position_id' => $treasurer->id, 'user_id' => $secondCandidateUser->school_id]);

        $this->authenticate($student);
        $this->postJson("/api/elections/{$election->id}/vote", [
            'votes' => [['position_id' => $president->id, 'candidate_id' => $presidentCandidate->id]],
        ])->assertUnprocessable()
            ->assertJsonPath('message', 'Please select one candidate for every position on the official ballot.');

        $this->assertDatabaseCount('votes', 0);
    }

    public function test_manual_attendance_records_status_and_biometric_is_safely_deferred(): void
    {
        $admin = $this->user('ADMIN');
        $student = $this->user('STUDENT', $admin->organization_id);
        $event = Event::factory()->create([
            'organization_id' => $admin->organization_id,
            'created_by' => $admin->school_id,
            'status' => 'approved',
            'approved_at' => now(),
        ]);

        $this->authenticate($admin);
        $this->postJson("/api/events/{$event->id}/attendance", [
            'user_id' => $student->school_id,
            'method' => 'manual',
            'status' => 'late',
            'remarks' => 'Arrived after registration closed.',
        ])->assertCreated()->assertJsonPath('status', 'late');

        $this->getJson("/api/events/{$event->id}/attendance")
            ->assertOk()
            ->assertJsonPath('summary.late', 1)
            ->assertJsonPath('summary.present', 0)
            ->assertJsonPath('biometric_adapter.configured', false);

        $otherStudent = $this->user('STUDENT', $admin->organization_id);
        $this->postJson("/api/events/{$event->id}/attendance", [
            'user_id' => $otherStudent->school_id,
            'method' => 'biometric',
        ])->assertStatus(501);
    }

    public function test_votes_lock_election_ballot_setup(): void
    {
        $admin = $this->user('ADMIN');
        $student = $this->user('STUDENT', $admin->organization_id);
        $candidateUser = $this->user('STUDENT', $admin->organization_id);
        $secondCandidateUser = $this->user('STUDENT', $admin->organization_id);
        $thirdCandidateUser = $this->user('STUDENT', $admin->organization_id);
        $election = Election::create([
            'organization_id' => $admin->organization_id,
            'title' => 'Locked Ballot Setup',
            'start_time' => now()->subHour(),
            'end_time' => now()->addHour(),
            'status' => 'active',
            'approved_at' => now(),
        ]);
        $position = ElectionPosition::create(['election_id' => $election->id, 'title' => 'President', 'max_winners' => 1]);
        $candidate = Candidate::create([
            'election_id' => $election->id,
            'position_id' => $position->id,
            'user_id' => $candidateUser->school_id,
        ]);
        $unusedCandidate = Candidate::create([
            'election_id' => $election->id,
            'position_id' => $position->id,
            'user_id' => $secondCandidateUser->school_id,
        ]);
        Vote::create([
            'election_id' => $election->id,
            'position_id' => $position->id,
            'candidate_id' => $candidate->id,
            'voter_id' => $student->school_id,
            'vote_hash' => 'locked-setup-test',
        ]);

        $this->authenticate($admin);

        $this->postJson("/api/elections/{$election->id}/positions", [
            'title' => 'Vice President',
            'max_winners' => 1,
        ])->assertConflict();
        $this->putJson("/api/elections/{$election->id}/positions/{$position->id}", ['title' => 'President Updated'])->assertConflict();
        $this->deleteJson("/api/elections/{$election->id}/positions/{$position->id}")->assertConflict();

        $this->postJson("/api/elections/{$election->id}/candidates", [
            'user_id' => $thirdCandidateUser->school_id,
            'position_id' => $position->id,
        ])->assertConflict();
        $this->putJson("/api/elections/{$election->id}/candidates/{$unusedCandidate->id}", [
            'platform' => 'Updated after votes',
        ])->assertConflict();
        $this->deleteJson("/api/elections/{$election->id}/candidates/{$unusedCandidate->id}")->assertConflict();
    }

    public function test_candidate_create_and_update_return_student_details(): void
    {
        $admin = $this->user('ADMIN');
        $student = $this->user('STUDENT', $admin->organization_id);
        $replacementStudent = $this->user('STUDENT', $admin->organization_id);
        $election = Election::create([
            'organization_id' => $admin->organization_id,
            'title' => 'Candidate Details Election',
            'start_time' => now()->addDay(),
            'end_time' => now()->addDays(2),
            'status' => 'upcoming',
            'approved_at' => now(),
        ]);
        $president = ElectionPosition::create(['election_id' => $election->id, 'title' => 'President', 'max_winners' => 1]);
        $treasurer = ElectionPosition::create(['election_id' => $election->id, 'title' => 'Treasurer', 'max_winners' => 1]);

        $this->authenticate($admin);

        $candidateId = $this->postJson("/api/elections/{$election->id}/candidates", [
            'user_id' => $student->school_id,
            'position_id' => $president->id,
            'platform' => 'Serve the students.',
        ])->assertCreated()
            ->assertJsonPath('user.school_id', $student->school_id)
            ->assertJsonPath('user.first_name', $student->first_name)
            ->assertJsonPath('position.title', 'President')
            ->json('id');

        $this->putJson("/api/elections/{$election->id}/candidates/{$candidateId}", [
            'user_id' => $replacementStudent->school_id,
            'position_id' => $treasurer->id,
            'platform' => 'Updated platform.',
        ])->assertOk()
            ->assertJsonPath('user.school_id', $replacementStudent->school_id)
            ->assertJsonPath('user.first_name', $replacementStudent->first_name)
            ->assertJsonPath('position.title', 'Treasurer')
            ->assertJsonPath('platform', 'Updated platform.');
    }

    public function test_partylist_changes_are_recorded_in_the_election_audit_log(): void
    {
        $admin = $this->user('ADMIN');
        $this->authenticate($admin);

        $partylistId = $this->postJson('/api/partylists', [
            'name' => 'Audit Party',
            'acronym' => 'AP',
            'description' => 'Initial platform',
        ])->assertCreated()->json('id');

        $this->putJson("/api/partylists/{$partylistId}", [
            'name' => 'Audit Party Updated',
            'acronym' => 'APU',
            'description' => 'Updated platform',
        ])->assertOk();

        $this->deleteJson("/api/partylists/{$partylistId}")->assertOk();

        foreach (['partylist_added', 'partylist_updated', 'partylist_removed'] as $action) {
            $this->assertDatabaseHas('audit_logs', [
                'organization_id' => $admin->organization_id,
                'user_id' => $admin->school_id,
                'module' => 'elections',
                'action' => $action,
                'record_type' => \App\Models\Partylist::class,
                'record_id' => $partylistId,
            ]);
        }
    }

    public function test_admin_can_delete_election_before_votes_are_cast(): void
    {
        $admin = $this->user('ADMIN');

        $this->authenticate($admin);
        $electionId = $this->postJson('/api/elections', [
            'title' => 'Disposable Election',
            'start_time' => now()->addDay(),
            'end_time' => now()->addDays(2),
        ])->assertCreated()->json('id');

        $this->assertDatabaseHas('approval_requests', [
            'entity_type' => 'election',
            'entity_id' => $electionId,
        ]);

        $this->deleteJson("/api/elections/{$electionId}")->assertOk();

        $this->assertDatabaseMissing('elections', ['id' => $electionId]);
        $this->assertDatabaseMissing('approval_requests', [
            'entity_type' => 'election',
            'entity_id' => $electionId,
        ]);
    }

    public function test_admin_can_delete_election_after_votes_are_cast(): void
    {
        $admin = $this->user('ADMIN');
        $student = $this->user('STUDENT', $admin->organization_id);
        $candidateUser = $this->user('STUDENT', $admin->organization_id);
        $election = Election::create([
            'organization_id' => $admin->organization_id,
            'title' => 'Locked Election',
            'start_time' => now()->subHour(),
            'end_time' => now()->addHour(),
            'status' => 'active',
            'approved_at' => now(),
        ]);
        $position = ElectionPosition::create(['election_id' => $election->id, 'title' => 'President', 'max_winners' => 1]);
        $candidate = Candidate::create([
            'election_id' => $election->id,
            'position_id' => $position->id,
            'user_id' => $candidateUser->school_id,
        ]);
        Vote::create([
            'election_id' => $election->id,
            'position_id' => $position->id,
            'candidate_id' => $candidate->id,
            'voter_id' => $student->school_id,
            'vote_hash' => 'locked-delete-test',
        ]);

        $this->authenticate($admin);
        $this->deleteJson("/api/elections/{$election->id}")
            ->assertConflict()
            ->assertJsonPath('message', 'This election already has cast votes. Confirm deletion to permanently remove the election and all associated votes.');
        $this->deleteJson("/api/elections/{$election->id}?confirmed=1")->assertOk();

        $this->assertDatabaseMissing('elections', ['id' => $election->id]);
        $this->assertDatabaseMissing('election_positions', ['id' => $position->id]);
        $this->assertDatabaseMissing('candidates', ['id' => $candidate->id]);
        $this->assertDatabaseMissing('votes', ['vote_hash' => 'locked-delete-test']);
    }

    public function test_merchandise_payment_requires_officer_submission_and_admin_approval(): void
    {
        $admin = $this->user('ADMIN');
        $officer = $this->user('SBO_OFFICER', $admin->organization_id);
        $buyer = $this->user('STUDENT', $admin->organization_id);
        $item = Merchandise::create([
            'organization_id' => $admin->organization_id,
            'name' => 'Organization Shirt',
            'price' => 250,
            'stock_quantity' => 5,
            'is_active' => true,
        ]);

        $this->authenticate($buyer);
        $orderId = $this->postJson('/api/orders', [
            'merchandise_id' => $item->id,
            'quantity' => 2,
            'payment_method' => 'cash',
        ])->assertCreated()->assertJsonPath('claim_token', null)->json('id');
        $this->assertDatabaseHas('merchandise', ['id' => $item->id, 'stock_quantity' => 3]);
        $this->assertSame(2, Notification::where('title', 'New Merchandise Order')->count());

        $this->authenticate($officer);
        $this->patchJson("/api/orders/{$orderId}/status", ['status' => 'paid'])
            ->assertOk()
            ->assertJsonPath('status', 'pending');
        $approval = ApprovalRequest::where('entity_type', 'payment')->where('entity_id', $orderId)->firstOrFail();

        $this->authenticate($admin);
        $this->patchJson("/api/approval-requests/{$approval->id}", ['status' => 'approved'])->assertOk();
        $order = Order::findOrFail($orderId);
        $this->assertSame('paid', $order->status);
        $this->assertNotNull($order->transaction_id);

        $this->authenticate($buyer);
        $this->getJson('/api/orders?mine=1')->assertOk()->assertJsonPath('data.0.claim_token', $order->claim_token);

        $this->authenticate($officer);
        $this->postJson('/api/orders/claim', ['claim_token' => $order->claim_token])
            ->assertOk()
            ->assertJsonPath('status', 'claimed');
    }

    public function test_sbo_announcement_must_be_reviewed_before_it_is_published(): void
    {
        $admin = $this->user('ADMIN');
        $officer = $this->user('SBO_OFFICER', $admin->organization_id);
        $student = $this->user('STUDENT', $admin->organization_id);

        $this->authenticate($officer);
        $announcementId = $this->postJson('/api/announcements', [
            'title' => 'Approval Required Notice',
            'body' => 'This announcement must pass the approval queue.',
            'target_role' => 'STUDENT',
            'category' => 'general',
        ])->assertCreated()->assertJsonPath('approval_status', 'pending')->json('id');

        $this->authenticate($admin);
        $this->patchJson("/api/announcements/{$announcementId}/publish")
            ->assertOk()
            ->assertJsonPath('approval_status', 'approved')
            ->assertJsonPath('is_published', true);
        $approval = ApprovalRequest::where('entity_type', 'announcement')->where('entity_id', $announcementId)->firstOrFail();
        $this->assertSame('approved', $approval->status);

        $announcement = Announcement::findOrFail($announcementId);
        $this->assertTrue($announcement->is_published);
        $this->assertSame('approved', $announcement->approval_status);
        $this->assertDatabaseHas('notifications', [
            'user_id' => $student->school_id,
            'reference_type' => 'announcement',
            'reference_id' => $announcementId,
        ]);
    }

    public function test_department_head_can_only_view_published_targeted_announcements(): void
    {
        $departmentHead = $this->user('DEPARTMENT_HEAD');
        $admin = $this->user('ADMIN', $departmentHead->organization_id);

        $published = Announcement::create([
            'organization_id' => $departmentHead->organization_id,
            'created_by' => $admin->school_id,
            'title' => 'Published Department Notice',
            'body' => 'Visible to department heads.',
            'target_role' => 'DEPARTMENT_HEAD',
            'category' => 'general',
            'approval_status' => 'approved',
            'is_published' => true,
            'published_at' => now(),
        ]);
        Announcement::create([
            'organization_id' => $departmentHead->organization_id,
            'created_by' => $admin->school_id,
            'title' => 'Private Draft',
            'body' => 'Not yet published.',
            'target_role' => 'all',
            'category' => 'general',
            'approval_status' => 'draft',
            'is_published' => false,
        ]);

        $this->authenticate($departmentHead);
        $this->postJson('/api/announcements', [
            'title' => 'Department Notice',
            'body' => 'Department heads do not manage announcement records.',
            'target_role' => 'all',
            'category' => 'general',
            'is_published' => true,
        ])->assertForbidden();

        $this->getJson('/api/announcements')
            ->assertOk()
            ->assertJsonCount(1)
            ->assertJsonPath('0.id', $published->id);
    }

    public function test_department_head_order_history_is_personal_and_catalog_hides_inactive_items(): void
    {
        $departmentHead = $this->user('DEPARTMENT_HEAD');
        $otherBuyer = $this->user('STUDENT', $departmentHead->organization_id);
        $activeItem = Merchandise::create([
            'organization_id' => $departmentHead->organization_id,
            'name' => 'Active Item',
            'price' => 100,
            'stock_quantity' => 5,
            'is_active' => true,
        ]);
        $inactiveItem = Merchandise::create([
            'organization_id' => $departmentHead->organization_id,
            'name' => 'Inactive Item',
            'price' => 100,
            'stock_quantity' => 5,
            'is_active' => false,
        ]);
        $ownOrder = Order::create([
            'organization_id' => $departmentHead->organization_id,
            'student_id' => $departmentHead->school_id,
            'merchandise_id' => $activeItem->id,
            'quantity' => 1,
            'total_price' => 100,
            'status' => 'pending',
            'claim_token' => 'OWNORDER',
        ]);
        Order::create([
            'organization_id' => $departmentHead->organization_id,
            'student_id' => $otherBuyer->school_id,
            'merchandise_id' => $activeItem->id,
            'quantity' => 1,
            'total_price' => 100,
            'status' => 'pending',
            'claim_token' => 'OTHERORD',
        ]);

        $this->authenticate($departmentHead);
        $this->getJson('/api/orders')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $ownOrder->id)
            ->assertJsonPath('data.0.claim_token', null);
        $this->getJson('/api/merchandise')
            ->assertOk()
            ->assertJsonCount(1)
            ->assertJsonPath('0.id', $activeItem->id);

        $this->assertDatabaseHas('merchandise', ['id' => $inactiveItem->id, 'is_active' => false]);
    }

    public function test_self_check_in_requires_the_active_event_period(): void
    {
        $student = $this->user('STUDENT');
        $event = Event::factory()->create([
            'organization_id' => $student->organization_id,
            'status' => 'approved',
            'approved_at' => now(),
            'start_time' => now()->addDay(),
            'end_time' => now()->addDay()->addHours(2),
        ]);

        $this->authenticate($student);
        $this->postJson("/api/events/{$event->id}/attendance", [
            'method' => 'manual',
            'status' => 'present',
        ])->assertUnprocessable()
            ->assertJsonPath('message', 'Self check-in is only available during the scheduled event period.');

        $this->assertDatabaseMissing('attendance', [
            'event_id' => $event->id,
            'user_id' => $student->school_id,
        ]);
    }

    public function test_user_lookup_filters_candidate_and_assignment_lists_server_side(): void
    {
        $admin = $this->user('ADMIN');
        $activeStudent = $this->user('STUDENT', $admin->organization_id);
        $this->user('SBO_OFFICER', $admin->organization_id);
        $inactiveStudent = $this->user('STUDENT', $admin->organization_id);
        $inactiveStudent->update(['account_status' => 'disabled']);

        $this->authenticate($admin);
        $this->getJson('/api/users?role=STUDENT&account_status=active')
            ->assertOk()
            ->assertJsonCount(1)
            ->assertJsonPath('0.school_id', $activeStudent->school_id);
    }

    public function test_sbo_calendar_cannot_read_unapproved_event_plans(): void
    {
        $admin = $this->user('ADMIN');
        $officer = $this->user('SBO_OFFICER', $admin->organization_id);
        $planning = Event::factory()->create([
            'organization_id' => $admin->organization_id,
            'created_by' => $admin->school_id,
            'status' => 'planning',
        ]);
        $approved = Event::factory()->create([
            'organization_id' => $admin->organization_id,
            'created_by' => $admin->school_id,
            'status' => 'approved',
            'approved_at' => now(),
        ]);

        $this->authenticate($officer);
        $this->getJson('/api/events')
            ->assertOk()
            ->assertJsonCount(1)
            ->assertJsonPath('0.id', $approved->id);
        $this->getJson("/api/events/{$planning->id}")->assertForbidden();
    }

    public function test_live_standings_are_anonymous_while_official_results_wait_for_closure(): void
    {
        $admin = $this->user('ADMIN');
        $student = $this->user('STUDENT', $admin->organization_id);
        $otherVoter = $this->user('STUDENT', $admin->organization_id);
        $candidateUser = $this->user('STUDENT', $admin->organization_id);
        $election = Election::factory()->create([
            'organization_id' => $admin->organization_id,
            'status' => 'active',
            'approved_at' => now(),
            'results_visible' => true,
            'start_time' => now()->subHour(),
            'end_time' => now()->addHour(),
        ]);
        $position = ElectionPosition::factory()->create(['election_id' => $election->id]);
        $candidate = Candidate::factory()->create([
            'election_id' => $election->id,
            'position_id' => $position->id,
            'user_id' => $candidateUser->school_id,
        ]);
        Vote::factory()->create([
            'election_id' => $election->id,
            'position_id' => $position->id,
            'candidate_id' => $candidate->id,
            'voter_id' => $otherVoter->school_id,
        ]);

        $this->authenticate($admin);
        $this->getJson("/api/elections/{$election->id}")
            ->assertOk()
            ->assertJsonMissingPath('votes');
        $this->getJson("/api/elections/{$election->id}/results")->assertForbidden();

        $this->authenticate($student);
        $this->getJson("/api/elections/{$election->id}")
            ->assertOk()
            ->assertJsonPath("vote_counts.{$candidate->id}", 1)
            ->assertJsonPath('voters_count', 1)
            ->assertJsonMissingPath('votes');
        $this->getJson("/api/elections/{$election->id}/results")->assertForbidden();

        $election->update(['status' => 'closed']);
        $this->getJson("/api/elections/{$election->id}/results")
            ->assertOk()
            ->assertJsonPath('0.candidates.0.votes', 1)
            ->assertJsonMissingPath('0.candidates.0.voter_id');
    }

    public function test_sbo_edit_of_published_announcement_reopens_admin_approval(): void
    {
        $officer = $this->user('SBO_OFFICER');
        $admin = $this->user('ADMIN', $officer->organization_id);
        $announcement = Announcement::create([
            'organization_id' => $officer->organization_id,
            'created_by' => $officer->school_id,
            'title' => 'Approved Notice',
            'body' => 'Original approved content.',
            'target_role' => 'all',
            'category' => 'general',
            'approval_status' => 'approved',
            'is_published' => true,
            'published_at' => now(),
        ]);
        $approval = ApprovalRequest::create([
            'organization_id' => $officer->organization_id,
            'entity_type' => 'announcement',
            'entity_id' => $announcement->id,
            'requested_by' => $officer->school_id,
            'required_role' => 'ADMIN',
            'status' => 'approved',
            'reviewed_by' => $admin->school_id,
            'reviewed_at' => now(),
        ]);
        Notification::query()->delete();

        $this->authenticate($officer);
        $this->putJson("/api/announcements/{$announcement->id}", [
            'body' => 'Materially changed content.',
        ])->assertOk()
            ->assertJsonPath('approval_status', 'pending')
            ->assertJsonPath('is_published', false);

        $this->assertDatabaseHas('approval_requests', [
            'id' => $approval->id,
            'status' => 'pending',
            'requested_by' => $officer->school_id,
            'required_role' => 'ADMIN',
        ]);
        $this->assertDatabaseHas('notifications', [
            'user_id' => $admin->school_id,
            'title' => 'Approval Request Submitted',
            'reference_id' => $approval->id,
        ]);
        $this->assertDatabaseHas('audit_logs', [
            'module' => 'approvals',
            'action' => 'resubmitted',
            'record_id' => $approval->id,
        ]);
    }

    public function test_merchandise_payment_cannot_bypass_upload_or_staged_approval(): void
    {
        $student = $this->user('STUDENT');
        $admin = $this->user('ADMIN', $student->organization_id);
        $officer = $this->user('SBO_OFFICER', $student->organization_id);
        $item = Merchandise::create([
            'organization_id' => $student->organization_id,
            'name' => 'Secure Payment Item',
            'price' => 200,
            'stock_quantity' => 4,
            'is_active' => true,
        ]);

        $this->authenticate($student);
        $this->postJson('/api/orders', [
            'merchandise_id' => $item->id,
            'quantity' => 1,
            'payment_method' => 'gcash',
            'payment_reference' => 'REF-123',
            'payment_proof_url' => 'https://attacker.example/fake.png',
        ])->assertUnprocessable();

        $orderId = $this->postJson('/api/orders', [
            'merchandise_id' => $item->id,
            'quantity' => 1,
            'payment_method' => 'cash',
        ])->assertCreated()->json('id');

        $this->authenticate($admin);
        $this->patchJson("/api/orders/{$orderId}/status", ['status' => 'paid'])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'An SBO Officer must verify and submit this payment before admin approval.');

        $this->authenticate($officer);
        $this->patchJson("/api/orders/{$orderId}/status", ['status' => 'paid'])->assertOk();
        $this->patchJson("/api/orders/{$orderId}/status", ['status' => 'paid'])->assertConflict();
        $this->patchJson("/api/orders/{$orderId}/status", [
            'status' => 'cancelled',
            'review_remarks' => 'Trying to bypass the admin queue.',
        ])->assertUnprocessable();
    }

    public function test_transaction_list_rejects_invalid_filters_instead_of_crashing(): void
    {
        $admin = $this->user('ADMIN');
        $this->authenticate($admin);

        $this->getJson('/api/transactions?per_page=0')->assertUnprocessable();
        $this->getJson('/api/transactions?per_page=1001')->assertUnprocessable();
        $this->getJson('/api/transactions?type=invalid')->assertUnprocessable();
        $this->getJson('/api/transactions?from=2026-08-20&to=2026-08-19')->assertUnprocessable();
    }
}
