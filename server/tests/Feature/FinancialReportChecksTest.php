<?php

namespace Tests\Feature;

use App\Models\CashAdvance;
use App\Models\FinancialReport;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use App\Services\Ai\Evaluation\ReportCheckFixture;
use App\Services\Finance\FinancialReportChecks;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * The rules of FinancialReportChecks on small inline ledgers: one defect per code, a clean ledger that must return
 * nothing, and the edges that decide whether a rule fires (the period, the budget's approval, income against a budget).
 * The cases use the same loader as the held-out test, so the loader is proved here on inline data.
 */
class FinancialReportChecksTest extends TestCase
{
    use RefreshDatabase;

    /** A ledger with nothing wrong: every rule has something to look at and none fires. */
    private static function clean(): array
    {
        return [
            'id' => 'inline',
            'period' => ['from' => '2026-08-01', 'to' => '2026-12-31'],
            'previous_report_closing' => 12500.00, 'opening_balance' => 12500.00,
            'events' => [['key' => 'e1', 'title' => 'Foundation Day']],
            'budgets' => [['key' => 'b1', 'name' => 'Foundation Day budget', 'allocated_amount' => 100000, 'warning_threshold_percent' => 90, 'submission_status' => 'approved', 'event_key' => 'e1']],
            'transactions' => [
                ['key' => 't1', 'type' => 'expense', 'amount' => 1200.50, 'category' => 'Supplies', 'transaction_date' => '2026-09-02', 'receipt_reference' => 'OR-1', 'budget_key' => 'b1', 'event_key' => 'e1'],
                ['key' => 't2', 'type' => 'income', 'amount' => 3000, 'category' => 'Membership', 'transaction_date' => '2026-09-03', 'receipt_reference' => null, 'budget_key' => null, 'event_key' => null],
            ],
            'collections' => [['key' => 'c1', 'amount' => 3000, 'verified' => true, 'remitted_amount' => 3000]],
            'cash_advances' => [['key' => 'a1', 'amount' => 2000, 'status' => 'repaid', 'released_on' => '2026-09-10', 'repaid_on' => '2026-09-20']],
            'report' => ['generated_at' => '2026-12-20T10:00:00', 'ledger_edited_after' => false],
            'expected_findings' => [],
        ];
    }

    /** @return array<string, array{0: array<string, mixed>}> */
    public static function cases(): array
    {
        $with = fn (array $changes, array $expected) => [[...self::clean(), ...$changes, 'expected_findings' => $expected]];
        $tx = fn (string $key, string $type, float $amount, string $category, string $date, ?string $receipt, ?string $budget = null, ?string $event = null) => [
            'key' => $key, 'type' => $type, 'amount' => $amount, 'category' => $category, 'transaction_date' => $date, 'receipt_reference' => $receipt, 'budget_key' => $budget, 'event_key' => $event,
        ];
        $base = self::clean()['transactions'];
        $unapproved = ['key' => 'b2', 'name' => 'Pending budget', 'allocated_amount' => 50000, 'warning_threshold_percent' => 90, 'submission_status' => 'pending', 'event_key' => null];
        $budgetOf = fn (float $allocated, int $percent) => [['key' => 'b1', 'name' => 'Foundation Day budget', 'allocated_amount' => $allocated, 'warning_threshold_percent' => $percent, 'submission_status' => 'approved', 'event_key' => 'e1']];

        return [
            'a clean ledger returns nothing' => [[...self::clean()]],
            'missing_receipt' => $with(['transactions' => [$tx('t1', 'expense', 1200.50, 'Supplies', '2026-09-02', null, 'b1', 'e1'), $base[1]]], [['code' => 'missing_receipt', 'refs' => ['t1']]]),
            'an income without a receipt is not a missing receipt' => $with(['transactions' => [$base[0], $tx('t2', 'income', 3000, 'Membership', '2026-09-03', null)]], []),
            'an entry outside the period is not looked at' => $with(['transactions' => [...$base, $tx('t3', 'expense', 900, 'Supplies', '2027-01-04', null, 'b1', 'e1')]], []),
            'budget_overspent' => $with(['budgets' => $budgetOf(1000, 90)], [['code' => 'budget_overspent', 'refs' => ['b1']]]),
            'income against a budget raises what is left' => $with(['budgets' => $budgetOf(1000, 90), 'transactions' => [$base[0], $tx('t2', 'income', 500, 'Sponsorship', '2026-09-03', null, 'b1')]], []),
            'budget_near_limit' => $with(['budgets' => $budgetOf(10000, 80), 'transactions' => [$tx('t1', 'expense', 8500, 'Supplies', '2026-09-02', 'OR-1', 'b1', 'e1'), $base[1]]], [['code' => 'budget_near_limit', 'refs' => ['b1']]]),
            'a budget below its warning share is quiet' => $with(['budgets' => $budgetOf(10000, 80), 'transactions' => [$tx('t1', 'expense', 7900, 'Supplies', '2026-09-02', 'OR-1', 'b1', 'e1'), $base[1]]], []),
            'expense_on_unapproved_budget' => $with(['budgets' => [...self::clean()['budgets'], $unapproved], 'transactions' => [...$base, $tx('t3', 'expense', 500, 'Printing', '2026-09-04', 'OR-3', 'b2')]], [['code' => 'expense_on_unapproved_budget', 'refs' => ['t3']]]),
            'event_expense_no_budget' => $with(['transactions' => [...$base, $tx('t3', 'expense', 500, 'Printing', '2026-09-04', 'OR-3', null, 'e1')]], [['code' => 'event_expense_no_budget', 'refs' => ['t3']]]),
            'large_unlinked_entry' => $with(['transactions' => [...$base, $tx('t3', 'income', 7500, 'Donation', '2026-09-04', null)]], [['code' => 'large_unlinked_entry', 'refs' => ['t3']]]),
            'an unlinked entry just under the line is quiet' => $with(['transactions' => [...$base, $tx('t3', 'income', 4999.99, 'Donation', '2026-09-04', null)]], []),
            'opening_balance_mismatch' => $with(['opening_balance' => 12000.00], [['code' => 'opening_balance_mismatch', 'refs' => []]]),
            'no previous report means no opening balance finding' => $with(['previous_report_closing' => null, 'opening_balance' => 12000.00], []),
            'collection_unverified' => $with(['collections' => [...self::clean()['collections'], ['key' => 'c2', 'amount' => 800, 'verified' => false, 'remitted_amount' => 0]]], [['code' => 'collection_unverified', 'refs' => ['c2']]]),
            'remittance_short' => $with(['collections' => [['key' => 'c1', 'amount' => 3000, 'verified' => true, 'remitted_amount' => 2500]]], [['code' => 'remittance_short', 'refs' => ['c1']]]),
            'cash_advance_unsettled' => $with(['cash_advances' => [['key' => 'a1', 'amount' => 2000, 'status' => 'released', 'released_on' => '2026-09-10', 'repaid_on' => null]]], [['code' => 'cash_advance_unsettled', 'refs' => ['a1']]]),
            'a cash advance repaid after the period end is still unsettled' => $with(['cash_advances' => [['key' => 'a1', 'amount' => 2000, 'status' => 'repaid', 'released_on' => '2026-09-10', 'repaid_on' => '2027-01-05']]], [['code' => 'cash_advance_unsettled', 'refs' => ['a1']]]),
            'a cash advance that was never released is quiet' => $with(['cash_advances' => [['key' => 'a1', 'amount' => 2000, 'status' => 'approved', 'released_on' => null, 'repaid_on' => null]]], []),
            'possible_duplicate names every copy' => $with(['transactions' => [...$base, $tx('t3', 'expense', 800, 'Printing', '2026-09-05', 'OR-3', 'b1'), $tx('t4', 'expense', 800, 'Printing', '2026-09-05', 'OR-4', 'b1'), $tx('t5', 'expense', 800, 'Printing', '2026-09-05', 'OR-5', 'b1')]], [['code' => 'possible_duplicate', 'refs' => ['t3', 't4', 't5']]]),
            'the same amount on another day is not a duplicate' => $with(['transactions' => [...$base, $tx('t3', 'expense', 800, 'Printing', '2026-09-05', 'OR-3', 'b1'), $tx('t4', 'expense', 800, 'Printing', '2026-09-06', 'OR-4', 'b1')]], []),
            'ledger_changed_since_generated' => $with(['report' => ['generated_at' => '2026-12-20T10:00:00', 'ledger_edited_after' => true]], [['code' => 'ledger_changed_since_generated', 'refs' => []]]),
            'no saved report means no ledger finding' => $with(['report' => null], []),
        ];
    }

    #[DataProvider('cases')]
    public function test_each_case_returns_exactly_its_findings(array $case): void
    {
        $fixture = ReportCheckFixture::seed($case);

        $found = app(FinancialReportChecks::class)->forReport($fixture->report);

        $this->assertSame(ReportCheckFixture::expectedSignatures($case), $fixture->signatures($found));
    }

    public function test_every_code_fires_in_one_report_and_comes_back_most_urgent_first(): void
    {
        $case = [
            ...self::clean(),
            'opening_balance' => 100.00,
            'budgets' => [
                ['key' => 'b1', 'name' => 'Small budget', 'allocated_amount' => 1000, 'warning_threshold_percent' => 90, 'submission_status' => 'approved', 'event_key' => 'e1'],
                ['key' => 'b2', 'name' => 'Pending budget', 'allocated_amount' => 50000, 'warning_threshold_percent' => 90, 'submission_status' => 'pending', 'event_key' => null],
                ['key' => 'b3', 'name' => 'Tight budget', 'allocated_amount' => 10000, 'warning_threshold_percent' => 80, 'submission_status' => 'approved', 'event_key' => null],
            ],
            'transactions' => [
                ['key' => 't1', 'type' => 'expense', 'amount' => 1200.50, 'category' => 'Supplies', 'transaction_date' => '2026-09-02', 'receipt_reference' => null, 'budget_key' => 'b1', 'event_key' => 'e1'],
                ['key' => 't2', 'type' => 'expense', 'amount' => 9000, 'category' => 'Venue', 'transaction_date' => '2026-09-03', 'receipt_reference' => 'OR-2', 'budget_key' => 'b3', 'event_key' => null],
                ['key' => 't3', 'type' => 'expense', 'amount' => 500, 'category' => 'Printing', 'transaction_date' => '2026-09-04', 'receipt_reference' => 'OR-3', 'budget_key' => 'b2', 'event_key' => null],
                ['key' => 't4', 'type' => 'expense', 'amount' => 600, 'category' => 'Food', 'transaction_date' => '2026-09-05', 'receipt_reference' => 'OR-4', 'budget_key' => null, 'event_key' => 'e1'],
                ['key' => 't5', 'type' => 'income', 'amount' => 7500, 'category' => 'Donation', 'transaction_date' => '2026-09-06', 'receipt_reference' => null, 'budget_key' => null, 'event_key' => null],
                ['key' => 't6', 'type' => 'income', 'amount' => 20, 'category' => 'Fee', 'transaction_date' => '2026-09-07', 'receipt_reference' => null, 'budget_key' => null, 'event_key' => null],
                ['key' => 't7', 'type' => 'income', 'amount' => 20, 'category' => 'Fee', 'transaction_date' => '2026-09-07', 'receipt_reference' => null, 'budget_key' => null, 'event_key' => null],
            ],
            'collections' => [['key' => 'c1', 'amount' => 3000, 'verified' => true, 'remitted_amount' => 2000], ['key' => 'c2', 'amount' => 800, 'verified' => false, 'remitted_amount' => 0]],
            'cash_advances' => [['key' => 'a1', 'amount' => 2000, 'status' => 'released', 'released_on' => '2026-09-10', 'repaid_on' => null]],
            'report' => ['generated_at' => '2026-12-20T10:00:00', 'ledger_edited_after' => true],
        ];
        $fixture = ReportCheckFixture::seed($case);

        $found = app(FinancialReportChecks::class)->forReport($fixture->report);

        $this->assertEqualsCanonicalizing(array_keys(FinancialReportChecks::SEVERITIES), array_values(array_unique(array_column($found, 'code'))));
        $rank = ['high' => 0, 'medium' => 1, 'low' => 2];
        $ranks = array_map(fn (array $finding) => $rank[$finding['severity']], $found);
        $sorted = $ranks;
        sort($sorted);
        $this->assertSame($sorted, $ranks);
        foreach ($found as $finding) {
            $this->assertSame(FinancialReportChecks::SEVERITIES[$finding['code']], $finding['severity']);
            $this->assertNotSame('', FinancialReportChecks::describe($finding));
            $this->assertStringNotContainsString('—', FinancialReportChecks::describe($finding));
        }
        $this->assertSame('budget_overspent', collect($found)->firstWhere('code', 'budget_overspent')['code']);
        $this->assertEqualsWithDelta(200.5, collect($found)->firstWhere('code', 'budget_overspent')['amount'], 0.001);
    }

    public function test_for_period_checks_an_organization_without_a_saved_report(): void
    {
        $case = [...self::clean(), 'report' => null, 'transactions' => [
            ['key' => 't1', 'type' => 'expense', 'amount' => 1200.50, 'category' => 'Supplies', 'transaction_date' => '2026-09-02', 'receipt_reference' => null, 'budget_key' => 'b1', 'event_key' => 'e1'],
        ], 'previous_report_closing' => null];
        $fixture = ReportCheckFixture::seed($case);
        $other = Organization::factory()->create();
        $user = User::factory()->create(['organization_id' => $other->id]);
        Transaction::create(['organization_id' => $other->id, 'recorded_by' => $user->school_id, 'type' => 'expense', 'amount' => 80, 'category' => 'Supplies', 'description' => 'Other organization', 'transaction_date' => '2026-09-02 09:00:00']);

        $found = app(FinancialReportChecks::class)->forPeriod($fixture->report->organization_id, '2026-08-01', '2026-12-31');

        $this->assertSame(['missing_receipt|t1'], $fixture->signatures($found));
    }

    public function test_an_event_report_looks_only_at_that_events_entries(): void
    {
        $fixture = ReportCheckFixture::seed(['id' => 'ev', 'period' => ['from' => '2026-08-01', 'to' => '2026-12-31'], 'opening_balance' => 0, 'events' => [['key' => 'e1', 'title' => 'Foundation Day'], ['key' => 'e2', 'title' => 'Sports Fest']],
            'transactions' => [
                ['key' => 't1', 'type' => 'expense', 'amount' => 90, 'category' => 'Supplies', 'transaction_date' => '2026-09-02', 'receipt_reference' => null, 'budget_key' => null, 'event_key' => 'e1'],
                ['key' => 't2', 'type' => 'expense', 'amount' => 70, 'category' => 'Supplies', 'transaction_date' => '2026-09-02', 'receipt_reference' => null, 'budget_key' => null, 'event_key' => 'e2'],
            ]]);
        $report = $fixture->report;
        $report->forceFill(['event_id' => Transaction::find($fixture->report->source_transaction_ids[0])->event_id])->save();

        $found = app(FinancialReportChecks::class)->forReport($report->fresh());

        $this->assertSame(['event_expense_no_budget|t1', 'missing_receipt|t1'], $fixture->signatures($found));
    }

    public function test_an_event_report_does_not_pair_an_entry_with_a_twin_in_another_event(): void
    {
        $fixture = ReportCheckFixture::seed(['id' => 'twin', 'period' => ['from' => '2026-08-01', 'to' => '2026-12-31'], 'opening_balance' => 0, 'events' => [['key' => 'e1', 'title' => 'Foundation Day'], ['key' => 'e2', 'title' => 'Sports Fest']],
            'transactions' => [
                ['key' => 't1', 'type' => 'expense', 'amount' => 90, 'category' => 'Supplies', 'transaction_date' => '2026-09-02', 'receipt_reference' => 'OR-1', 'budget_key' => null, 'event_key' => 'e1'],
                ['key' => 't2', 'type' => 'expense', 'amount' => 90, 'category' => 'Supplies', 'transaction_date' => '2026-09-02', 'receipt_reference' => 'OR-2', 'budget_key' => null, 'event_key' => 'e2'],
            ]]);
        $report = $fixture->report;
        $report->forceFill(['event_id' => Transaction::find($report->source_transaction_ids[0])->event_id])->save();

        $found = app(FinancialReportChecks::class)->forReport($report->fresh());

        $this->assertNotContains('possible_duplicate', array_column($found, 'code'));
    }

    public function test_a_cash_advance_movement_matching_an_entry_is_not_a_duplicate(): void
    {
        $fixture = ReportCheckFixture::seed(['id' => 'ca', 'period' => ['from' => '2026-08-01', 'to' => '2026-12-31'], 'opening_balance' => 0,
            'transactions' => [['key' => 't1', 'type' => 'expense', 'amount' => 2000, 'category' => 'Cash advance', 'transaction_date' => '2026-09-10', 'receipt_reference' => 'OR-1', 'budget_key' => null, 'event_key' => null]]]);
        $entry = Transaction::findOrFail($fixture->report->source_transaction_ids[0]);
        $release = Transaction::create(['organization_id' => $entry->organization_id, 'recorded_by' => $entry->recorded_by, 'type' => 'expense', 'amount' => 2000, 'category' => 'Cash advance',
            'description' => 'Cash advance release', 'receipt_reference' => 'OR-CA', 'transaction_date' => '2026-09-10 10:00:00']);
        CashAdvance::create(['organization_id' => $entry->organization_id, 'reference' => 'CA-TWIN', 'borrower_id' => $entry->recorded_by, 'amount' => 2000, 'purpose' => 'Supplies', 'status' => 'fully_repaid',
            'approved_by' => $entry->recorded_by, 'approved_at' => '2026-09-09 09:00:00', 'released_by' => $entry->recorded_by, 'released_at' => '2026-09-10 10:00:00', 'release_transaction_id' => $release->id]);

        $found = app(FinancialReportChecks::class)->forPeriod($entry->organization_id, '2026-08-01', '2026-12-31');

        $this->assertNotContains('possible_duplicate', array_column($found, 'code'));
    }

    public function test_a_real_pair_is_found_once_with_both_entries_named(): void
    {
        $fixture = ReportCheckFixture::seed(['id' => 'pair', 'period' => ['from' => '2026-08-01', 'to' => '2026-12-31'], 'opening_balance' => 0,
            'transactions' => [
                ['key' => 't1', 'type' => 'expense', 'amount' => 90, 'category' => 'Supplies', 'transaction_date' => '2026-09-02', 'receipt_reference' => 'OR-1', 'budget_key' => null, 'event_key' => null],
                ['key' => 't2', 'type' => 'expense', 'amount' => 90, 'category' => 'Supplies', 'transaction_date' => '2026-09-02', 'receipt_reference' => 'OR-2', 'budget_key' => null, 'event_key' => null],
                ['key' => 't3', 'type' => 'expense', 'amount' => 75, 'category' => 'Supplies', 'transaction_date' => '2026-09-02', 'receipt_reference' => 'OR-3', 'budget_key' => null, 'event_key' => null],
            ]]);

        $found = collect(app(FinancialReportChecks::class)->forReport($fixture->report))->where('code', 'possible_duplicate')->values();

        $this->assertCount(1, $found);
        $this->assertSame(2, $found[0]['facts']['copies']);
        $this->assertCount(2, $found[0]['refs']);
    }

    public function test_a_report_without_a_period_has_nothing_to_check(): void
    {
        $report = FinancialReport::create(['organization_id' => Organization::factory()->create()->id, 'report_type' => 'custom', 'title' => 'Undated', 'generated_at' => now()]);

        $this->assertSame([], app(FinancialReportChecks::class)->forReport($report));
    }
}
