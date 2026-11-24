<?php

namespace Tests\Feature;

use App\Models\CashAdvance;
use App\Models\CashAdvanceRepayment;
use App\Models\Transaction;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Concerns\BuildsLedgerFixtures;
use Tests\TestCase;

/**
 * Every budget row carries the four figures the cards show: allocated, spent, income and remaining. Remaining is
 * allocated plus income minus spent. A budget that is not approved is not released: it shows nothing spent, no income,
 * its whole allocation as remaining, and no ledger entry can be linked to it.
 */
class BudgetFiguresTest extends TestCase
{
    use BuildsLedgerFixtures;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpLedgerFixtures();
    }

    private function row(int $id): array
    {
        return collect($this->getJson('/api/budgets')->assertOk()->json('data'))->firstWhere('id', $id);
    }

    public function test_an_approved_budget_shows_allocated_spent_income_and_remaining_that_add_up(): void
    {
        $fund = $this->makeBudget('General Operations Fund');
        $this->makeEntry('income', '18500.00', $fund);
        $this->makeEntry('income', '15000.00', $fund);
        $this->makeEntry('income', '10000.00', $fund);
        $this->makeEntry('expense', '5000.00', $fund);
        $this->makeEntry('expense', '4500.00', $fund);
        $this->makeEntry('expense', '2200.00', $fund);
        $this->makeEntry('expense', '1800.00', $fund);

        $row = $this->row($fund->id);

        $this->assertSame('50000.00', $row['allocated_amount']);
        $this->assertSame('13500.00', $row['spent_amount']);
        $this->assertSame('43500.00', $row['income_amount']);
        $this->assertSame('80000.00', $row['remaining_amount']);
        $this->assertTrue($row['is_released']);
    }

    public function test_archived_rows_and_cash_advance_movements_count_in_no_figure(): void
    {
        $fund = $this->makeBudget('General Operations Fund');
        $this->makeEntry('income', '1000.00', $fund);
        $this->makeEntry('expense', '400.00', $fund);
        $this->archivedEntry('expense', '999.00', $fund);
        $this->archivedEntry('income', '777.00', $fund);
        $this->cashAdvanceMovements('500.00', '200.00');
        Transaction::whereIn('id', CashAdvance::pluck('release_transaction_id')->merge(CashAdvanceRepayment::pluck('ledger_transaction_id')))->update(['budget_id' => $fund->id]);

        $row = $this->row($fund->id);

        $this->assertSame('400.00', $row['spent_amount']);
        $this->assertSame('1000.00', $row['income_amount']);
        $this->assertSame('50600.00', $row['remaining_amount']);
    }

    public function test_a_budget_that_is_not_approved_is_not_released_and_shows_its_whole_allocation(): void
    {
        $event = $this->makeEvent('Sports Fest 2024', '2027-02-20');
        $pending = $this->makeBudget('Sports Fest 2024 Budget', 'pending_department_head', $event, '25000.00');
        $returned = $this->makeBudget('Returned Budget', 'rejected', null, '9000.00');
        $draft = $this->makeBudget('Draft Budget', 'draft', null, '4000.00');
        // Legacy rows that were linked while the budget was pending must not move its figures.
        $this->makeEntry('expense', '3800.00', $pending);
        $this->makeEntry('income', '500.00', $returned);

        foreach ([[$pending, '25000.00'], [$returned, '9000.00'], [$draft, '4000.00']] as [$budget, $allocated]) {
            $row = $this->row($budget->id);
            $this->assertSame($allocated, $row['allocated_amount']);
            $this->assertSame('0.00', $row['spent_amount']);
            $this->assertSame('0.00', $row['income_amount']);
            $this->assertSame($allocated, $row['remaining_amount']);
            $this->assertFalse($row['is_released']);
        }
    }

    public function test_nothing_can_be_linked_to_a_budget_that_is_not_approved(): void
    {
        $pending = $this->makeBudget('Sports Fest 2024 Budget', 'pending_department_head', null, '25000.00');
        $payload = [
            'type' => 'income', 'amount' => '100.00', 'category' => 'Dues', 'description' => 'Dues',
            'transaction_date' => '2027-02-10', 'budget_id' => $pending->id,
        ];

        $this->postJson('/api/transactions', $payload)
            ->assertUnprocessable()
            ->assertJsonPath('message', 'The selected budget must belong to this organization and be approved.');

        $loose = $this->makeEntry('income', '100.00');
        $this->putJson("/api/transactions/{$loose->id}", [...$payload, 'edit_reason' => 'Linking it to the pending budget'])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'The selected budget must belong to this organization and be approved.');

        $this->assertNull($loose->fresh()->budget_id);
        $this->assertSame(0, Transaction::where('budget_id', $pending->id)->count());
    }
}
