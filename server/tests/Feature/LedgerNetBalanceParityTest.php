<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Concerns\BuildsLedgerFixtures;
use Tests\TestCase;

/**
 * The Budgets page and the Ledger page print a ledger net balance. They must never disagree: both come from the one
 * computation behind GET /transactions/summary, scoped to the same semester, with archived rows left out whichever
 * reader asks and cash advance movements counted the same way by both.
 */
class LedgerNetBalanceParityTest extends TestCase
{
    use BuildsLedgerFixtures;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpLedgerFixtures();
        $event = $this->makeEvent('Sports Fest 2024', '2027-03-05');
        $fund = $this->makeBudget('General Operations Fund');
        $this->makeBudget('Sports Fest 2024 Budget', 'pending_department_head', $event, '25000.00');

        $this->makeEntry('income', '43500.00', $fund);
        $this->makeEntry('expense', '13500.00', $fund);
        $this->makeEntry('income', '9000.00');
        $this->makeEntry('expense', '8795.00', null, $event);
        // Rows the readers must treat alike: archived, a cash advance and rows from another semester.
        $this->archivedEntry('expense', '400.00', $fund);
        $this->archivedEntry('income', '123.45');
        $this->cashAdvanceMovements('500.00', '200.00');
        $this->makeEntry('expense', '1111.11', $fund, null, '2026-10-10');
        $this->makeEntry('income', '2222.22', null, null, '2026-11-10');
    }

    private function nets(array $headers = [], string $query = ''): array
    {
        $summary = $this->getJson('/api/transactions/summary'.$query, $headers)->assertOk()->json();
        $budgets = $this->getJson('/api/budgets'.$query, $headers)->assertOk()->json('ledger_summary');
        $ledgers = $this->getJson('/api/transactions/event-ledgers', $headers)->assertOk()->json('totals');

        return [(float) $summary['net_balance'], (float) $budgets['net_balance'], (float) $ledgers['net']];
    }

    public function test_the_budgets_response_ledger_net_balance_equals_the_ledger_summary_net(): void
    {
        [$summaryNet, $budgetsNet, $ledgersNet] = $this->nets();

        $this->assertSame($summaryNet, $budgetsNet);
        $this->assertSame($summaryNet, $ledgersNet);
        // 43500 + 9000 - 13500 - 8795 for the posted rows, less the cash advance that is still out: 500 released, 200 repaid.
        $this->assertSame(29905.0, $summaryNet);
    }

    public function test_the_two_agree_in_the_earlier_semester_too(): void
    {
        [$summaryNet, $budgetsNet, $ledgersNet] = $this->nets($this->inSemester($this->earlier));

        $this->assertSame($summaryNet, $budgetsNet);
        $this->assertSame($summaryNet, $ledgersNet);
        $this->assertSame(1111.11, round($summaryNet, 2));
    }

    public function test_archiving_a_row_moves_every_reader_by_the_same_amount(): void
    {
        $before = $this->nets();
        $entry = $this->makeEntry('expense', '400.00');
        $mid = $this->nets();
        $entry->forceFill(['archived_at' => now(), 'archive_reason' => 'Entered twice'])->save();
        $after = $this->nets();

        $this->assertSame([$before[0] - 400.0, $before[0] - 400.0, $before[0] - 400.0], $mid);
        $this->assertSame([$before[0], $before[0], $before[0]], $after);
    }

    public function test_the_budgets_ledger_summary_has_the_same_shape_as_the_summary_endpoint(): void
    {
        $summary = $this->getJson('/api/transactions/summary')->assertOk()->json();
        $budgets = $this->getJson('/api/budgets')->assertOk()->json('ledger_summary');

        $this->assertEquals($summary['total_income'], $budgets['total_income']);
        $this->assertEquals($summary['total_expense'], $budgets['total_expense']);
        $this->assertEquals($summary['net_balance'], $budgets['net_balance']);
    }
}
