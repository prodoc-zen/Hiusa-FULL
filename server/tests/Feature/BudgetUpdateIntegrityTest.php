<?php

namespace Tests\Feature;

use App\Models\Budget;
use App\Models\Event;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Editing a budget must not strand the ledger entries posted against it: its
 * event cannot change once entries exist, and its remaining amount is
 * recomputed from those entries inside a transaction under a row lock.
 */
class BudgetUpdateIntegrityTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private Event $event;

    private Event $otherEvent;

    private Budget $budget;

    protected function setUp(): void
    {
        parent::setUp();
        $organization = Organization::factory()->create();
        $this->admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $this->event = Event::factory()->create(['organization_id' => $organization->id, 'created_by' => $this->admin->school_id, 'status' => 'approved']);
        $this->otherEvent = Event::factory()->create(['organization_id' => $organization->id, 'created_by' => $this->admin->school_id, 'status' => 'approved']);
        $this->budget = Budget::create([
            'organization_id' => $organization->id, 'event_id' => $this->event->id, 'title' => 'Event budget', 'allocated_amount' => 1000,
            'remaining_amount' => 1000, 'warning_threshold' => 100, 'submission_status' => 'approved',
        ]);
        Sanctum::actingAs($this->admin);
    }

    private function entry(string $type, float $amount): Transaction
    {
        return Transaction::create([
            'organization_id' => $this->budget->organization_id, 'budget_id' => $this->budget->id, 'event_id' => $this->event->id,
            'recorded_by' => $this->admin->school_id, 'type' => $type, 'amount' => $amount, 'category' => 'Event',
            'description' => 'Entry', 'transaction_date' => now(),
        ]);
    }

    public function test_the_event_of_a_budget_with_ledger_entries_cannot_change(): void
    {
        $this->entry('expense', 200);

        $this->putJson("/api/budgets/{$this->budget->id}", ['event_id' => $this->otherEvent->id])->assertConflict()
            ->assertJsonPath('message', 'This budget already has ledger entries, so it can no longer be moved to a different event.');
        $this->putJson("/api/budgets/{$this->budget->id}", ['event_id' => null])->assertConflict();

        $this->assertSame($this->event->id, $this->budget->fresh()->event_id);
        $this->assertSame('approved', $this->budget->fresh()->submission_status);
    }

    public function test_a_budget_with_ledger_entries_still_takes_edits_that_keep_its_event(): void
    {
        $this->entry('expense', 200);

        $this->putJson("/api/budgets/{$this->budget->id}", ['event_id' => $this->event->id, 'title' => 'Renamed'])->assertOk()
            ->assertJsonPath('title', 'Renamed');
    }

    public function test_a_budget_without_ledger_entries_can_move_to_another_event(): void
    {
        $this->putJson("/api/budgets/{$this->budget->id}", ['event_id' => $this->otherEvent->id])->assertOk()
            ->assertJsonPath('event_id', $this->otherEvent->id);
    }

    public function test_changing_the_allocation_recomputes_remaining_from_the_income_and_expense_entries(): void
    {
        $this->entry('expense', 200);
        $this->entry('income', 50);

        $this->putJson("/api/budgets/{$this->budget->id}", ['allocated_amount' => 2000, 'warning_threshold' => 100])->assertOk();

        $this->assertEquals(1850, $this->budget->fresh()->remaining_amount);
    }

    public function test_the_remaining_amount_is_recomputed_inside_a_database_transaction(): void
    {
        $this->entry('expense', 200);
        $levels = [];
        $baseline = DB::transactionLevel();
        DB::listen(function ($query) use (&$levels) {
            $sql = str_replace(['"', '`'], '', $query->sql);
            if (str_contains($sql, 'sum(amount)') && str_contains($sql, 'from transactions')) {
                $levels[] = DB::transactionLevel();
            }
        });

        $this->putJson("/api/budgets/{$this->budget->id}", ['allocated_amount' => 2000, 'warning_threshold' => 100])->assertOk();

        $this->assertNotEmpty($levels);
        foreach ($levels as $level) {
            $this->assertGreaterThan($baseline, $level, 'The ledger sum behind remaining_amount ran outside a database transaction.');
        }
    }
}
