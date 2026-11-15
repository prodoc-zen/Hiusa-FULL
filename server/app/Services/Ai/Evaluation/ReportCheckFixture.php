<?php

namespace App\Services\Ai\Evaluation;

use App\Models\Budget;
use App\Models\CashAdvance;
use App\Models\CashAdvanceRepayment;
use App\Models\Collection;
use App\Models\Event;
use App\Models\FinancialReport;
use App\Models\Organization;
use App\Models\Remittance;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Support\Carbon;

/**
 * Seeds one report-check case (a ledger with the findings a correct checker returns) into the database through the real
 * columns, so the rules run against real rows. The held-out PHPUnit test and the ai:live-eval runner both load cases this way.
 *
 * Where a field of the case is not a column: warning_threshold_percent becomes the amount left at which the budget is
 * near its limit (allocated minus that share), the remitted amount becomes one recorded remittance, and a repaid cash
 * advance becomes one repayment of its full amount. previous_report_closing becomes an approved report that ended the
 * day before the period with that closing balance, and a report whose ledger was edited afterwards has the time of
 * one entry moved after its snapshot was taken (or one tiny income added), which changes nothing the rules read
 * except the ledger-changed rule.
 */
final class ReportCheckFixture
{
    /** Which kind of record the refs of each finding code name. */
    private const REF_KIND = [
        'missing_receipt' => 'transactions',
        'budget_overspent' => 'budgets',
        'budget_near_limit' => 'budgets',
        'expense_on_unapproved_budget' => 'transactions',
        'event_expense_no_budget' => 'transactions',
        'large_unlinked_entry' => 'transactions',
        'opening_balance_mismatch' => null,
        'collection_unverified' => 'collections',
        'remittance_short' => 'collections',
        'cash_advance_unsettled' => 'cash_advances',
        'possible_duplicate' => 'transactions',
        'ledger_changed_since_generated' => null,
    ];

    /** @var array<string, array<string, int>> kind => case key => record id */
    private array $ids = ['events' => [], 'budgets' => [], 'transactions' => [], 'collections' => [], 'cash_advances' => []];

    private function __construct(public readonly FinancialReport $report) {}

    /** @param  array<string, mixed>  $case */
    public static function seed(array $case): self
    {
        $organization = Organization::factory()->create();
        $user = User::factory()->create(['organization_id' => $organization->id]);
        $from = $case['period']['from'];
        $to = $case['period']['to'];
        $prefix = $case['id'].'/';

        $previousClosing = $case['previous_report_closing'] ?? null;
        if ($previousClosing !== null) {
            FinancialReport::create([
                'organization_id' => $organization->id, 'report_type' => 'custom', 'title' => 'Previous report', 'summary_text' => 'Previous',
                'period_start' => Carbon::parse($from)->subMonths(5)->toDateString(), 'period_end' => Carbon::parse($from)->subDay()->toDateString(),
                'source_transaction_ids' => [], 'opening_balance_snapshot' => $previousClosing, 'transactions_snapshot' => [],
                'submission_status' => 'approved', 'generated_by' => $user->school_id, 'generated_at' => Carbon::parse($from)->subDay(),
            ]);
        }

        $made = ['events' => [], 'budgets' => [], 'transactions' => [], 'collections' => [], 'cash_advances' => []];
        foreach ($case['events'] ?? [] as $row) {
            $made['events'][$row['key']] = Event::factory()->create(['organization_id' => $organization->id, 'created_by' => $user->school_id, 'title' => $row['title']])->id;
        }
        foreach ($case['budgets'] ?? [] as $row) {
            $allocated = (float) $row['allocated_amount'];
            $made['budgets'][$row['key']] = Budget::create([
                'organization_id' => $organization->id, 'event_id' => isset($row['event_key']) ? $made['events'][$row['event_key']] : null, 'title' => $row['name'],
                'allocated_amount' => $allocated, 'remaining_amount' => $allocated,
                'warning_threshold' => round($allocated * (100 - (float) $row['warning_threshold_percent']) / 100, 2),
                'submission_status' => $row['submission_status'],
            ])->id;
        }
        foreach ($case['transactions'] ?? [] as $row) {
            $made['transactions'][$row['key']] = Transaction::create([
                'organization_id' => $organization->id, 'recorded_by' => $user->school_id, 'type' => $row['type'], 'amount' => $row['amount'],
                'category' => $row['category'], 'description' => 'Entry '.$row['key'], 'receipt_reference' => isset($row['receipt_reference']) && $row['receipt_reference'] !== '' ? $prefix.$row['receipt_reference'] : null,
                'budget_id' => isset($row['budget_key']) ? $made['budgets'][$row['budget_key']] : null,
                'event_id' => isset($row['event_key']) ? $made['events'][$row['event_key']] : null,
                'transaction_date' => $row['transaction_date'].' 09:00:00',
            ])->id;
        }
        foreach ($case['collections'] ?? [] as $row) {
            $verified = (bool) $row['verified'];
            $collection = Collection::create([
                'organization_id' => $organization->id, 'reference' => $prefix.$row['key'], 'expected_amount' => $row['amount'], 'amount_collected' => $row['amount'], 'source' => 'Dues',
                'collected_by' => $user->school_id, 'collected_at' => Carbon::parse($from)->addDay()->setTime(9, 0), 'status' => $verified ? 'verified' : 'pending',
                'verified_by' => $verified ? $user->school_id : null, 'verified_at' => $verified ? Carbon::parse($from)->addDays(2)->setTime(9, 0) : null,
            ]);
            if ($verified && (float) ($row['remitted_amount'] ?? 0) > 0) {
                Remittance::create(['collection_id' => $collection->id, 'reference' => $prefix.$row['key'].'-R', 'amount' => $row['remitted_amount'], 'remitted_by' => $user->school_id, 'remitted_at' => Carbon::parse($from)->addDays(3)->setTime(9, 0), 'status' => 'recorded']);
            }
            $made['collections'][$row['key']] = $collection->id;
        }
        foreach ($case['cash_advances'] ?? [] as $row) {
            $releasedOn = $row['released_on'] ?? null;
            $repaidOn = $row['repaid_on'] ?? ($row['status'] === 'repaid' ? $releasedOn : null);
            $advance = CashAdvance::create([
                'organization_id' => $organization->id, 'reference' => $prefix.$row['key'], 'borrower_id' => $user->school_id, 'amount' => $row['amount'], 'purpose' => 'Supplies',
                'status' => ['approved' => 'approved', 'released' => 'released', 'repaid' => 'fully_repaid'][$row['status']],
                'approved_by' => $user->school_id, 'approved_at' => $releasedOn ? Carbon::parse($releasedOn)->subDay() : now(),
                'released_by' => $releasedOn ? $user->school_id : null, 'released_at' => $releasedOn ? Carbon::parse($releasedOn)->setTime(9, 0) : null,
            ]);
            if ($repaidOn) {
                CashAdvanceRepayment::create(['cash_advance_id' => $advance->id, 'amount' => $row['amount'], 'recorded_by' => $user->school_id, 'repaid_at' => Carbon::parse($repaidOn)->setTime(9, 0)]);
            }
            $made['cash_advances'][$row['key']] = $advance->id;
        }

        $saved = $case['report'] ?? null;
        $snapshot = $saved === null ? null : Transaction::where('organization_id', $organization->id)->whereDate('transaction_date', '>=', $from)->whereDate('transaction_date', '<=', $to)->orderBy('id')->get()
            ->map(fn (Transaction $entry) => ['id' => $entry->id, 'amount' => (string) $entry->amount, 'type' => $entry->type, 'category' => $entry->category, 'budget_id' => $entry->budget_id, 'event_id' => $entry->event_id, 'transaction_date' => $entry->transaction_date->toDateTimeString()])
            ->all();
        $report = FinancialReport::create([
            'organization_id' => $organization->id, 'report_type' => 'custom', 'title' => 'Report '.$case['id'], 'summary_text' => 'Report',
            'period_start' => $from, 'period_end' => $to, 'source_transaction_ids' => array_values($made['transactions']),
            'opening_balance_snapshot' => $case['opening_balance'] ?? 0, 'transactions_snapshot' => $snapshot,
            'submission_status' => 'draft', 'generated_by' => $user->school_id, 'generated_at' => $saved['generated_at'] ?? now(),
        ]);
        if ($saved !== null && ($saved['ledger_edited_after'] ?? false)) {
            $first = $snapshot[0]['id'] ?? null;
            $first !== null
                ? Transaction::whereKey($first)->update(['transaction_date' => Carbon::parse($snapshot[0]['transaction_date'])->setTime(15, 30)])
                : Transaction::create(['organization_id' => $organization->id, 'recorded_by' => $user->school_id, 'type' => 'income', 'amount' => 1, 'category' => 'Late entry', 'description' => 'Added after the report', 'receipt_reference' => $prefix.'late', 'transaction_date' => $from.' 12:00:00']);
        }

        $fixture = new self($report->fresh());
        $fixture->ids = $made;

        return $fixture;
    }

    /**
     * What the checker returned, as "code|ref keys" strings sorted, so it compares with the case's expected_findings.
     *
     * @param  list<array<string, mixed>>  $findings
     * @return list<string>
     */
    public function signatures(array $findings): array
    {
        $byId = array_map('array_flip', $this->ids);
        $signatures = array_map(function (array $finding) use ($byId) {
            $kind = self::REF_KIND[$finding['code']];
            $keys = array_map(fn (int $id) => $byId[$kind][$id] ?? 'unknown-'.$id, $finding['refs']);
            sort($keys);

            return $finding['code'].'|'.implode(',', $keys);
        }, $findings);
        sort($signatures);

        return $signatures;
    }

    /**
     * @param  array<string, mixed>  $case
     * @return list<string>
     */
    public static function expectedSignatures(array $case): array
    {
        $signatures = array_map(function (array $expected) {
            $refs = $expected['refs'] ?? [];
            sort($refs);

            return $expected['code'].'|'.implode(',', $refs);
        }, $case['expected_findings'] ?? []);
        sort($signatures);

        return $signatures;
    }
}
