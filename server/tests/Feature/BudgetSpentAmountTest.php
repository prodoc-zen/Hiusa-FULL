<?php

namespace Tests\Feature;

use App\Models\Budget;
use App\Models\CashAdvance;
use App\Models\CashAdvanceRepayment;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The budget payload carries what was spent from each budget, so a budget row can say the same
 * thing on every page. Spent is expenses only: income recorded against a budget raises its
 * remaining amount above the allocation and must not net off what was spent, and cash advance
 * movements are money lent out and returned, not spent.
 */
class BudgetSpentAmountTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        config(['performance.api_cache.enabled' => false]);
        $this->organization = Organization::factory()->create();
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        Sanctum::actingAs($this->admin);
    }

    private function budget(string $title = 'Budget'): Budget
    {
        return Budget::create([
            'organization_id' => $this->organization->id, 'title' => $title, 'allocated_amount' => '5000.00',
            'remaining_amount' => '5000.00', 'warning_threshold' => '500.00', 'submission_status' => 'approved',
        ]);
    }

    private function entry(Budget $budget, string $type, string $amount, string $category = 'Supplies'): Transaction
    {
        return Transaction::create([
            'organization_id' => $this->organization->id, 'recorded_by' => $this->admin->school_id, 'budget_id' => $budget->id,
            'event_id' => null, 'payer_id' => null, 'type' => $type, 'amount' => $amount, 'category' => $category,
            'description' => $category.' entry', 'transaction_date' => '2026-10-05',
        ]);
    }

    /** A cash advance taken through the real flow and posted against the budget. */
    private function advanceAgainst(Budget $budget, string $amount, string $repaid): void
    {
        $approver = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        $id = $this->postJson('/api/cash-advances', ['amount' => $amount, 'purpose' => 'Venue deposit'])->assertCreated()->json('id');
        Sanctum::actingAs($approver);
        $this->patchJson("/api/cash-advances/{$id}/approve")->assertOk();
        Sanctum::actingAs($this->admin);
        $this->patchJson("/api/cash-advances/{$id}/release")->assertOk();
        $this->postJson("/api/cash-advances/{$id}/repayments", ['amount' => $repaid])->assertOk();
        Transaction::whereKey(CashAdvance::findOrFail($id)->release_transaction_id)->update(['budget_id' => $budget->id]);
        Transaction::whereKey(CashAdvanceRepayment::where('cash_advance_id', $id)->value('ledger_transaction_id'))->update(['budget_id' => $budget->id]);
    }

    private function row(array $rows, int $id): array
    {
        return collect($rows)->firstWhere('id', $id);
    }

    public function test_spent_amount_counts_expenses_only_and_leaves_out_income_and_cash_advances(): void
    {
        $budget = $this->budget();
        $this->entry($budget, 'expense', '250.00');
        $this->entry($budget, 'expense', '75.50', 'Cash Advance');
        $this->entry($budget, 'income', '900.00', 'Sponsorship');
        $this->advanceAgainst($budget, '500.00', '200.00');
        $untouched = $this->budget('Untouched');

        $rows = $this->getJson('/api/budgets')->assertOk()->json('data');

        $this->assertSame('325.50', $this->row($rows, $budget->id)['spent_amount']);
        $this->assertSame('0.00', $this->row($rows, $untouched->id)['spent_amount']);
    }

    public function test_store_and_update_responses_carry_spent_amount(): void
    {
        $created = $this->postJson('/api/budgets', ['title' => 'New', 'allocated_amount' => 1000, 'warning_threshold' => 100])->assertCreated();
        $created->assertJsonPath('spent_amount', '0.00');

        $budget = Budget::findOrFail($created->json('id'));
        $this->entry($budget, 'expense', '120.00');
        $this->entry($budget, 'income', '40.00');

        $this->putJson('/api/budgets/'.$budget->id, ['title' => 'Renamed'])->assertOk()->assertJsonPath('spent_amount', '120.00');
    }

    public function test_budget_list_query_count_stays_constant_across_a_page(): void
    {
        $first = $this->budget('First');
        $this->entry($first, 'expense', '10.00');

        $queryCount = function (): int {
            $count = 0;
            DB::listen(function () use (&$count) {
                $count++;
            });
            $this->getJson('/api/budgets?per_page=50')->assertOk();

            return $count;
        };
        $before = $queryCount();

        foreach (range(1, 8) as $number) {
            $budget = $this->budget('Extra '.$number);
            $this->entry($budget, 'expense', '5.00');
            $this->entry($budget, 'income', '5.00');
        }
        $after = $queryCount();

        $this->assertSame($before, $after);
    }
}
