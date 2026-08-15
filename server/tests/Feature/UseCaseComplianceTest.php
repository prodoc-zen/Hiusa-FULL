<?php

namespace Tests\Feature;

use App\Models\ApprovalRequest;
use App\Models\Announcement;
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

        $this->putJson("/api/users/{$admin->school_id}", ['account_status' => 'disabled'])
            ->assertUnprocessable();
        $this->postJson("/api/users/{$admin->school_id}/disable")
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

        $this->authenticate($student);
        $this->patchJson('/api/notifications/read-all')->assertOk();

        $this->assertSame(0, Notification::where('user_id', $student->school_id)->where('is_read', false)->count());
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
        $this->postJson("/api/elections/{$election->id}/vote", $ballot)->assertUnprocessable();
        $election->update(['start_time' => now()->subHour(), 'end_time' => now()->addHour()]);
        $this->postJson("/api/elections/{$election->id}/vote", $ballot)->assertOk();
        $this->postJson("/api/elections/{$election->id}/vote", $ballot)->assertUnprocessable();
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

    public function test_admin_cannot_delete_election_after_votes_are_cast(): void
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
        $this->deleteJson("/api/elections/{$election->id}")->assertConflict();

        $this->assertDatabaseHas('elections', ['id' => $election->id]);
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

    public function test_department_head_announcements_bypass_approval(): void
    {
        $departmentHead = $this->user('DEPARTMENT_HEAD');
        $student = $this->user('STUDENT', $departmentHead->organization_id);

        $this->authenticate($departmentHead);
        $announcementId = $this->postJson('/api/announcements', [
            'title' => 'Department Notice',
            'body' => 'This announcement is posted directly by the Department Head.',
            'target_role' => 'all',
            'category' => 'general',
            'is_published' => true,
        ])
            ->assertCreated()
            ->assertJsonPath('approval_status', 'approved')
            ->assertJsonPath('is_published', true)
            ->json('id');

        $this->assertDatabaseMissing('approval_requests', [
            'entity_type' => 'announcement',
            'entity_id' => $announcementId,
        ]);
        $this->assertDatabaseHas('notifications', [
            'user_id' => $student->school_id,
            'reference_type' => 'announcement',
            'reference_id' => $announcementId,
        ]);
    }
}
