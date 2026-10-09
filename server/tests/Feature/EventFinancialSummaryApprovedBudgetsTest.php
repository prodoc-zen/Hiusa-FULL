<?php

namespace Tests\Feature;

use App\Models\Budget;
use App\Models\Event;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Only an approved budget is money an event can use, so a pending or rejected
 * budget linked to the event must not add to its allocated or remaining amount.
 */
class EventFinancialSummaryApprovedBudgetsTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private Event $event;

    protected function setUp(): void
    {
        parent::setUp();
        $organization = Organization::factory()->create();
        $this->admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $this->event = Event::factory()->create([
            'organization_id' => $organization->id, 'created_by' => $this->admin->school_id, 'status' => 'approved',
            'start_time' => now()->addWeek(), 'end_time' => now()->addWeek()->addHours(3),
        ]);
        Sanctum::actingAs($this->admin);
    }

    private function budget(string $status, float $allocated, float $remaining): Budget
    {
        return Budget::create([
            'organization_id' => $this->event->organization_id, 'event_id' => $this->event->id, 'title' => "Event budget {$status}",
            'allocated_amount' => $allocated, 'remaining_amount' => $remaining, 'warning_threshold' => 100, 'submission_status' => $status,
        ]);
    }

    public function test_pending_and_rejected_budgets_do_not_add_to_the_events_allocated_or_remaining_amounts(): void
    {
        $approved = $this->budget('approved', 1000, 800);
        $this->budget('pending_department_head', 500, 500);
        $this->budget('pending_sao', 300, 300);
        $this->budget('rejected', 700, 700);
        Transaction::create([
            'organization_id' => $this->event->organization_id, 'budget_id' => $approved->id, 'event_id' => $this->event->id,
            'recorded_by' => $this->admin->school_id, 'type' => 'expense', 'amount' => 200, 'category' => 'Supplies',
            'description' => 'Banners', 'transaction_date' => now(),
        ]);

        $this->getJson("/api/events/{$this->event->id}")->assertOk()
            ->assertJsonPath('financial_summary.allocated_budget', 1000)
            ->assertJsonPath('financial_summary.remaining_budget', 800)
            ->assertJsonPath('financial_summary.spent', 200)
            ->assertJsonCount(4, 'budgets');

        $this->getJson('/api/events')->assertOk()
            ->assertJsonPath('data.0.financial_summary.allocated_budget', 1000)
            ->assertJsonPath('data.0.financial_summary.remaining_budget', 800);
    }

    public function test_spent_and_income_count_every_entry_tagged_to_the_event_but_never_cash_advances(): void
    {
        $approved = $this->budget('approved', 1000, 800);
        $organizationId = $this->event->organization_id;
        $entry = fn (string $type, float $amount, ?int $budgetId = null) => Transaction::create([
            'organization_id' => $organizationId, 'budget_id' => $budgetId, 'event_id' => $this->event->id,
            'recorded_by' => $this->admin->school_id, 'type' => $type, 'amount' => $amount, 'category' => 'Event',
            'description' => 'Entry', 'transaction_date' => now(),
        ]);
        $entry('expense', 200, $approved->id);
        $entry('expense', 40);
        $entry('income', 500);
        $entry('income', 25, $approved->id);

        $approver = User::factory()->admin()->create(['organization_id' => $organizationId]);
        $student = User::factory()->student()->create(['organization_id' => $organizationId, 'account_status' => 'active']);
        $advanceId = $this->postJson('/api/cash-advances', ['amount' => '500.00', 'purpose' => 'Venue deposit', 'event_id' => $this->event->id])->assertCreated()->json('id');
        Sanctum::actingAs($approver);
        $this->patchJson("/api/cash-advances/{$advanceId}/approve")->assertOk();
        Sanctum::actingAs($this->admin);
        $this->patchJson("/api/cash-advances/{$advanceId}/release")->assertOk();
        $this->postJson("/api/cash-advances/{$advanceId}/repayments", ['amount' => '200.00'])->assertOk();
        $invoiceId = $this->postJson('/api/invoices', ['student_id' => $student->school_id, 'description' => 'Event ticket', 'amount_due' => '300.00', 'event_id' => $this->event->id])->assertCreated()->json('id');
        $this->postJson("/api/invoices/{$invoiceId}/payments", ['amount' => '150.00'])->assertOk();

        $this->getJson("/api/events/{$this->event->id}")->assertOk()
            ->assertJsonPath('financial_summary.spent', 240)
            ->assertJsonPath('financial_summary.income', 675)
            ->assertJsonPath('financial_summary.allocated_budget', 1000);

        $this->getJson('/api/events')->assertOk()
            ->assertJsonPath('data.0.financial_summary.spent', 240)
            ->assertJsonPath('data.0.financial_summary.income', 675);
    }

    public function test_an_event_with_no_approved_budget_has_nothing_allocated(): void
    {
        $this->budget('pending_department_head', 500, 500);
        $this->budget('rejected', 700, 700);

        $this->getJson("/api/events/{$this->event->id}")->assertOk()
            ->assertJsonPath('financial_summary.allocated_budget', 0)
            ->assertJsonPath('financial_summary.remaining_budget', 0)
            ->assertJsonCount(2, 'budgets');
    }
}
