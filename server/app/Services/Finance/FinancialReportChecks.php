<?php

namespace App\Services\Finance;

use App\Models\Budget;
use App\Models\CashAdvance;
use App\Models\Collection as CustodyCollection;
use App\Models\FinancialReport;
use App\Models\Transaction;
use App\Services\FinancialReportStatement;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * The rules a financial report is read against before it is sent: plain queries over the organization's ledger,
 * collections and cash advances, with no model involved. Each rule is one query scoped to the organization and to
 * the report's period (or to its event for an event report), and each finding names the records it is about, so the
 * Admin can fix them and the reviewer can see the same list.
 *
 * Budgets count only once approved, and what is spent from a budget is its linked expenses with its linked income
 * set against them (income raises what is left). Cash advance movements are money lent out and returned, so they are
 * left out of every ledger rule. The ledger rules look only at entries inside the period.
 *
 * A budget's warning_threshold is the amount left at or below which the budget is near its limit (the same rule the
 * budget advice uses), so "spent a set share of the allocation" is the same test as "left at most the rest".
 *
 * Query plans are UNMEASURED: every rule filters on organization_id and a date range, and the opening balance rule
 * sums the ledger before the period start. Run EXPLAIN ANALYZE on the real database before this ships.
 */
class FinancialReportChecks
{
    /** Findings in the order the rules are listed; the severity of each is fixed by its code. */
    public const SEVERITIES = [
        'missing_receipt' => 'medium',
        'budget_overspent' => 'high',
        'budget_near_limit' => 'medium',
        'expense_on_unapproved_budget' => 'medium',
        'event_expense_no_budget' => 'low',
        'large_unlinked_entry' => 'low',
        'opening_balance_mismatch' => 'high',
        'collection_unverified' => 'medium',
        'remittance_short' => 'high',
        'cash_advance_unsettled' => 'medium',
        'possible_duplicate' => 'medium',
        'ledger_changed_since_generated' => 'high',
    ];

    /** An entry with no budget and no event at or above this amount is worth a second look. */
    public const LARGE_UNLINKED_AMOUNT = 5000.00;

    private const SEVERITY_RANK = ['high' => 0, 'medium' => 1, 'low' => 2];

    /** The statuses of an earlier report whose closing balance the next report's opening balance should equal. */
    private const SENT_STATUSES = ['pending_department_head', 'pending_sao', 'approved'];

    /**
     * Every finding for one saved report, most urgent first.
     *
     * @return list<array{code: string, severity: string, facts: array<string, mixed>, refs: list<int>, amount: float|null}>
     */
    public function forReport(FinancialReport $report): array
    {
        $eventId = $report->event_id ? (int) $report->event_id : null;
        $from = $report->period_start?->toDateString();
        $to = $report->period_end?->toDateString();
        if ($from === null || $to === null) {
            return [];
        }

        return $this->run(
            (int) $report->organization_id,
            $from,
            $to,
            $eventId,
            $eventId ? null : $this->openingBalanceFor($report),
            $report,
        );
    }

    /**
     * Every finding for an organization over a period, most urgent first. There is no saved report to compare the
     * ledger against, so the ledger-changed rule does not apply, and the opening balance is the ledger before $from.
     *
     * @return list<array{code: string, severity: string, facts: array<string, mixed>, refs: list<int>, amount: float|null}>
     */
    public function forPeriod(int $organizationId, string $from, string $to): array
    {
        $from = Carbon::parse($from)->toDateString();
        $to = Carbon::parse($to)->toDateString();

        return $this->run($organizationId, $from, $to, null, self::ledgerOpeningBalance($organizationId, $from), null);
    }

    /**
     * A draft or rejected report does not lock its entries, so what it lists can be edited
     * or deleted before it is submitted. Reviewers approve the snapshot, so it must still
     * match the live rows, and an entry added to the same organization, period and scope
     * afterwards is a change too. A report from before snapshots existed has nothing to compare.
     * $lock holds the live rows while a submission is being decided.
     */
    public function ledgerChangedSinceGenerated(FinancialReport $report, bool $lock = false): bool
    {
        if ($report->transactions_snapshot === null) {
            return false;
        }

        $snapshot = collect($report->transactions_snapshot)->keyBy('id');

        $live = Transaction::where('organization_id', $report->organization_id)
            ->whereIn('id', $snapshot->keys()->all())
            ->when($lock, fn ($query) => $query->lockForUpdate())
            ->get()
            ->keyBy('id');

        $nullableId = fn ($id) => $id === null ? null : (int) $id;
        $money = fn ($amount) => number_format((float) $amount, 2, '.', '');

        foreach ($snapshot as $id => $saved) {
            $entry = $live->get($id);

            if (! $entry
                || $money($saved['amount'] ?? 0) !== $money($entry->amount)
                || ($saved['type'] ?? null) !== $entry->type
                || ($saved['category'] ?? null) !== $entry->category
                || $nullableId($saved['budget_id'] ?? null) !== $nullableId($entry->budget_id)
                || $nullableId($saved['event_id'] ?? null) !== $nullableId($entry->event_id)
                || Carbon::parse($saved['transaction_date'])->getTimestamp() !== $entry->transaction_date->getTimestamp()) {
                return true;
            }
        }

        return Transaction::where('organization_id', $report->organization_id)
            ->when($report->event_id, fn ($query) => $query->where('event_id', $report->event_id))
            ->when(! $report->event_id, fn ($query) => $query
                ->whereDate('transaction_date', '>=', $report->period_start)
                ->whereDate('transaction_date', '<=', $report->period_end))
            ->whereNotIn('id', $snapshot->keys()->all())
            ->exists();
    }

    /** What the report opens with: the figure saved when it was generated, else the ledger before its period. */
    public function openingBalanceFor(FinancialReport $report): float
    {
        if ($report->opening_balance_snapshot !== null) {
            return (float) $report->opening_balance_snapshot;
        }

        return $report->event_id || ! $report->period_start
            ? 0.0
            : self::ledgerOpeningBalance((int) $report->organization_id, $report->period_start->toDateString());
    }

    /** Income minus expense of everything the organization recorded before $periodStart. */
    public static function ledgerOpeningBalance(int $organizationId, string $periodStart): float
    {
        $totals = Transaction::query()
            ->where('organization_id', $organizationId)
            ->whereDate('transaction_date', '<', $periodStart)
            ->selectRaw("SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as income_total")
            ->selectRaw("SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as expense_total")
            ->first();

        return (float) ($totals?->income_total ?? 0) - (float) ($totals?->expense_total ?? 0);
    }

    /** A stable name for one finding, so an ignore reason and an explanation can point at it. */
    public static function keyOf(array $finding): string
    {
        return $finding['code'].':'.implode(',', $finding['refs']);
    }

    /** The finding as a plain sentence: the rules list the Admin reads when no model is involved. */
    public static function describe(array $finding): string
    {
        $f = $finding['facts'];
        $money = fn ($amount) => 'PHP '.number_format((float) $amount, 2);
        $day = fn ($date) => Carbon::parse($date)->format('M j, Y');
        $entry = fn () => $money($f['amount']).' for '.$f['category'].' on '.$day($f['date']);

        return match ($finding['code']) {
            'missing_receipt' => 'The expense of '.$entry().' has no receipt reference.',
            'budget_overspent' => 'Budget "'.$f['budget'].'" is over by '.$money($f['over_by']).'. It was allocated '.$money($f['allocated']).'.',
            'budget_near_limit' => 'Budget "'.$f['budget'].'" has '.$money($f['remaining']).' left of '.$money($f['allocated']).', which is at or below its warning level.',
            'expense_on_unapproved_budget' => 'The expense of '.$entry().' is charged to budget "'.$f['budget'].'", which is not approved.',
            'event_expense_no_budget' => 'The expense of '.$entry().' belongs to the event "'.$f['event'].'" but has no budget.',
            'large_unlinked_entry' => 'The '.$f['type'].' of '.$entry().' is not linked to a budget or an event.',
            'opening_balance_mismatch' => 'The opening balance of '.$money($f['opening_balance']).' does not match the closing balance of '.$money($f['previous_closing']).' on the previous report.',
            'collection_unverified' => 'The collection of '.$money($f['amount']).' recorded on '.$day($f['collected_on']).' is not verified yet.',
            'remittance_short' => 'The verified collection of '.$money($f['amount']).' has '.$money($f['remitted']).' remitted, which is '.$money($f['short_by']).' short.',
            'cash_advance_unsettled' => 'The cash advance of '.$money($f['amount']).' released on '.$day($f['released_on']).' still has '.$money($f['outstanding']).' unpaid.',
            'possible_duplicate' => $f['copies'].' entries of '.$entry().' look like duplicates.',
            'ledger_changed_since_generated' => 'The ledger changed after this report was generated. Regenerate the report before you send it.',
        };
    }

    /**
     * @return list<array{code: string, severity: string, facts: array<string, mixed>, refs: list<int>, amount: float|null}>
     */
    private function run(int $organizationId, string $from, string $to, ?int $eventId, ?float $opening, ?FinancialReport $report): array
    {
        $findings = [
            ...$this->missingReceipts($organizationId, $from, $to, $eventId),
            ...$this->budgetFindings($organizationId, $from, $to, $eventId),
            ...$this->expensesOnUnapprovedBudgets($organizationId, $from, $to, $eventId),
            ...$this->eventExpensesWithoutBudget($organizationId, $from, $to, $eventId),
            ...$this->largeUnlinkedEntries($organizationId, $from, $to, $eventId),
            ...$this->openingBalanceMismatch($organizationId, $from, $opening, $report),
            ...$this->unverifiedCollections($organizationId, $from, $to, $eventId),
            ...$this->shortRemittances($organizationId, $from, $to, $eventId),
            ...$this->unsettledCashAdvances($organizationId, $to, $eventId),
            ...$this->possibleDuplicates($organizationId, $from, $to, $eventId),
            ...$this->ledgerChanged($report),
        ];

        // Most urgent first; the order the rules are listed in, then the first record id, decides ties.
        $order = array_flip(array_keys(self::SEVERITIES));
        usort($findings, fn (array $a, array $b) => [self::SEVERITY_RANK[$a['severity']], $order[$a['code']], $a['refs'][0] ?? 0]
            <=> [self::SEVERITY_RANK[$b['severity']], $order[$b['code']], $b['refs'][0] ?? 0]);

        return $findings;
    }

    /** The organization's entries inside the period (or the event), cash advance movements left out. */
    private function ledger(int $organizationId, string $from, string $to, ?int $eventId): Builder
    {
        return Transaction::query()
            ->where('transactions.organization_id', $organizationId)
            ->excludingCashAdvances()
            ->when($eventId, fn (Builder $query) => $query->where('transactions.event_id', $eventId))
            ->when(! $eventId, fn (Builder $query) => $query
                ->whereDate('transactions.transaction_date', '>=', $from)
                ->whereDate('transactions.transaction_date', '<=', $to));
    }

    private function finding(string $code, array $facts, array $refs, ?float $amount): array
    {
        return ['code' => $code, 'severity' => self::SEVERITIES[$code], 'facts' => $facts, 'refs' => array_values($refs), 'amount' => $amount === null ? null : round($amount, 2)];
    }

    private function entryFacts(Transaction $entry): array
    {
        return ['type' => $entry->type, 'category' => $entry->category, 'date' => $entry->transaction_date->toDateString(), 'amount' => round((float) $entry->amount, 2)];
    }

    private function missingReceipts(int $organizationId, string $from, string $to, ?int $eventId): array
    {
        return $this->ledger($organizationId, $from, $to, $eventId)
            ->where('transactions.type', 'expense')
            ->whereRaw("TRIM(COALESCE(transactions.receipt_reference, '')) = ''")
            ->orderBy('transactions.id')
            ->get(['transactions.id', 'transactions.type', 'transactions.category', 'transactions.amount', 'transactions.transaction_date'])
            ->map(fn (Transaction $entry) => $this->finding('missing_receipt', $this->entryFacts($entry), [$entry->id], (float) $entry->amount))
            ->all();
    }

    /** Overspent and near-limit budgets from one grouped query over the approved budgets the period touched. */
    private function budgetFindings(int $organizationId, string $from, string $to, ?int $eventId): array
    {
        $budgets = $this->ledger($organizationId, $from, $to, $eventId)
            ->join('budgets', 'budgets.id', '=', 'transactions.budget_id')
            ->where('budgets.organization_id', $organizationId)
            ->where('budgets.submission_status', 'approved')
            ->groupBy('budgets.id', 'budgets.title', 'budgets.allocated_amount', 'budgets.warning_threshold')
            ->orderBy('budgets.id')
            ->selectRaw("budgets.id, budgets.title, budgets.allocated_amount, budgets.warning_threshold, COALESCE(SUM(CASE WHEN transactions.type = 'income' THEN transactions.amount ELSE 0 END), 0) AS income, COALESCE(SUM(CASE WHEN transactions.type = 'expense' THEN transactions.amount ELSE 0 END), 0) AS expense")
            ->get();

        $findings = [];
        foreach ($budgets as $budget) {
            $allocated = (float) $budget->allocated_amount;
            $spent = round((float) $budget->expense - (float) $budget->income, 2);
            $remaining = round($allocated - $spent, 2);

            if ($remaining < 0) {
                $findings[] = $this->finding('budget_overspent', [
                    'budget' => $budget->title, 'allocated' => round($allocated, 2), 'income' => round((float) $budget->income, 2), 'expense' => round((float) $budget->expense, 2), 'remaining' => $remaining, 'over_by' => round(-$remaining, 2),
                ], [(int) $budget->id], -$remaining);
            } elseif ($spent > 0 && $remaining <= round((float) $budget->warning_threshold, 2)) {
                $findings[] = $this->finding('budget_near_limit', [
                    'budget' => $budget->title, 'allocated' => round($allocated, 2), 'spent' => $spent, 'remaining' => $remaining, 'warning_level' => round((float) $budget->warning_threshold, 2),
                ], [(int) $budget->id], $remaining);
            }
        }

        return $findings;
    }

    private function expensesOnUnapprovedBudgets(int $organizationId, string $from, string $to, ?int $eventId): array
    {
        return $this->ledger($organizationId, $from, $to, $eventId)
            ->join('budgets', 'budgets.id', '=', 'transactions.budget_id')
            ->where('budgets.organization_id', $organizationId)
            ->where('budgets.submission_status', '!=', 'approved')
            ->where('transactions.type', 'expense')
            ->orderBy('transactions.id')
            ->get(['transactions.id', 'transactions.type', 'transactions.category', 'transactions.amount', 'transactions.transaction_date', 'budgets.title as budget_title', 'budgets.submission_status as budget_status'])
            ->map(fn (Transaction $entry) => $this->finding('expense_on_unapproved_budget', $this->entryFacts($entry) + ['budget' => $entry->budget_title, 'budget_status' => $entry->budget_status], [$entry->id], (float) $entry->amount))
            ->all();
    }

    private function eventExpensesWithoutBudget(int $organizationId, string $from, string $to, ?int $eventId): array
    {
        return $this->ledger($organizationId, $from, $to, $eventId)
            ->join('events', 'events.id', '=', 'transactions.event_id')
            ->where('transactions.type', 'expense')
            ->whereNull('transactions.budget_id')
            ->orderBy('transactions.id')
            ->get(['transactions.id', 'transactions.type', 'transactions.category', 'transactions.amount', 'transactions.transaction_date', 'events.title as event_title'])
            ->map(fn (Transaction $entry) => $this->finding('event_expense_no_budget', $this->entryFacts($entry) + ['event' => $entry->event_title], [$entry->id], (float) $entry->amount))
            ->all();
    }

    private function largeUnlinkedEntries(int $organizationId, string $from, string $to, ?int $eventId): array
    {
        return $this->ledger($organizationId, $from, $to, $eventId)
            ->whereNull('transactions.budget_id')
            ->whereNull('transactions.event_id')
            ->where('transactions.amount', '>=', self::LARGE_UNLINKED_AMOUNT)
            ->orderBy('transactions.id')
            ->get(['transactions.id', 'transactions.type', 'transactions.category', 'transactions.amount', 'transactions.transaction_date'])
            ->map(fn (Transaction $entry) => $this->finding('large_unlinked_entry', $this->entryFacts($entry) + ['threshold' => self::LARGE_UNLINKED_AMOUNT], [$entry->id], (float) $entry->amount))
            ->all();
    }

    /** The previous report is the latest sent one that ended before this period began. An event report has none. */
    private function openingBalanceMismatch(int $organizationId, string $from, ?float $opening, ?FinancialReport $report): array
    {
        if ($opening === null) {
            return [];
        }

        $previous = FinancialReport::where('organization_id', $organizationId)
            ->whereNull('event_id')
            ->whereIn('submission_status', self::SENT_STATUSES)
            ->whereDate('period_end', '<', $from)
            ->when($report, fn (Builder $query) => $query->where('id', '!=', $report->id))
            ->orderByDesc('period_end')
            ->orderByDesc('id')
            ->first();
        if (! $previous) {
            return [];
        }

        $closing = FinancialReportStatement::from($previous->savedTransactions(), $this->openingBalanceFor($previous))['totals']['closing_balance'];
        if (abs(round($opening, 2) - $closing) <= 0.005) {
            return [];
        }

        return [$this->finding('opening_balance_mismatch', [
            'opening_balance' => round($opening, 2), 'previous_closing' => $closing, 'difference' => round(abs(round($opening, 2) - $closing), 2),
        ], [], abs(round($opening, 2) - $closing))];
    }

    private function unverifiedCollections(int $organizationId, string $from, string $to, ?int $eventId): array
    {
        return $this->collections($organizationId, $from, $to, $eventId)
            ->where('status', 'pending')
            ->orderBy('id')
            ->get(['id', 'amount_collected', 'collected_at'])
            ->map(fn (CustodyCollection $collection) => $this->finding('collection_unverified', [
                'amount' => round((float) $collection->amount_collected, 2), 'collected_on' => $collection->collected_at->toDateString(),
            ], [$collection->id], (float) $collection->amount_collected))
            ->all();
    }

    private function shortRemittances(int $organizationId, string $from, string $to, ?int $eventId): array
    {
        return $this->collections($organizationId, $from, $to, $eventId)
            ->where('status', 'verified')
            ->selectRaw("collections.id, collections.amount_collected, collections.collected_at, COALESCE((SELECT SUM(remittances.amount) FROM remittances WHERE remittances.collection_id = collections.id AND remittances.status = 'recorded'), 0) AS remitted")
            ->orderBy('collections.id')
            ->get()
            ->filter(fn (CustodyCollection $collection) => round((float) $collection->amount_collected - (float) $collection->remitted, 2) > 0)
            ->map(fn (CustodyCollection $collection) => $this->finding('remittance_short', [
                'amount' => round((float) $collection->amount_collected, 2), 'collected_on' => $collection->collected_at->toDateString(),
                'remitted' => round((float) $collection->remitted, 2), 'short_by' => round((float) $collection->amount_collected - (float) $collection->remitted, 2),
            ], [$collection->id], (float) $collection->amount_collected - (float) $collection->remitted))
            ->values()
            ->all();
    }

    private function collections(int $organizationId, string $from, string $to, ?int $eventId): Builder
    {
        return CustodyCollection::query()
            ->where('collections.organization_id', $organizationId)
            ->when($eventId, fn (Builder $query) => $query->where('collections.event_id', $eventId))
            ->when(! $eventId, fn (Builder $query) => $query
                ->whereDate('collections.collected_at', '>=', $from)
                ->whereDate('collections.collected_at', '<=', $to));
    }

    /** Released on or before the end of the period and not paid back in full by then. */
    private function unsettledCashAdvances(int $organizationId, string $to, ?int $eventId): array
    {
        return CashAdvance::query()
            ->where('cash_advances.organization_id', $organizationId)
            ->whereNotNull('cash_advances.released_at')
            ->whereDate('cash_advances.released_at', '<=', $to)
            ->when($eventId, fn (Builder $query) => $query->where('cash_advances.event_id', $eventId))
            ->selectRaw('cash_advances.id, cash_advances.amount, cash_advances.released_at, COALESCE((SELECT SUM(cash_advance_repayments.amount) FROM cash_advance_repayments WHERE cash_advance_repayments.cash_advance_id = cash_advances.id AND DATE(cash_advance_repayments.repaid_at) <= ?), 0) AS repaid', [$to])
            ->orderBy('cash_advances.id')
            ->get()
            ->filter(fn (CashAdvance $advance) => round((float) $advance->amount - (float) $advance->repaid, 2) > 0)
            ->map(fn (CashAdvance $advance) => $this->finding('cash_advance_unsettled', [
                'amount' => round((float) $advance->amount, 2), 'released_on' => $advance->released_at->toDateString(),
                'repaid' => round((float) $advance->repaid, 2), 'outstanding' => round((float) $advance->amount - (float) $advance->repaid, 2),
            ], [$advance->id], (float) $advance->amount - (float) $advance->repaid))
            ->values()
            ->all();
    }

    /**
     * Entries that match another entry on type, date, amount and category; each group is one finding naming all of them.
     * One query: the ledger joined to its own GROUP BY ... HAVING COUNT(*) > 1 aggregate, so each side reads the same ledger fragment.
     */
    private function possibleDuplicates(int $organizationId, string $from, string $to, ?int $eventId): array
    {
        // The aggregate reads the same ledger the other rules read, so the event scope and the cash advance exclusion apply to both sides of a pair.
        $groups = $this->ledger($organizationId, $from, $to, $eventId)
            ->selectRaw('transactions.type, transactions.category, transactions.amount, DATE(transactions.transaction_date) as entry_day')
            ->groupByRaw('transactions.type, transactions.category, transactions.amount, DATE(transactions.transaction_date)')
            ->havingRaw('COUNT(*) > 1')
            ->toBase();

        return $this->ledger($organizationId, $from, $to, $eventId)
            ->joinSub($groups, 'dup', fn ($join) => $join
                ->on('transactions.type', '=', 'dup.type')
                ->on('transactions.category', '=', 'dup.category')
                ->on('transactions.amount', '=', 'dup.amount')
                ->on(DB::raw('DATE(transactions.transaction_date)'), '=', 'dup.entry_day'))
            ->orderBy('transactions.id')
            ->get(['transactions.id', 'transactions.type', 'transactions.category', 'transactions.amount', 'transactions.transaction_date'])
            ->groupBy(fn (Transaction $entry) => implode('|', [$entry->type, $entry->category, number_format((float) $entry->amount, 2, '.', ''), $entry->transaction_date->toDateString()]))
            // MySQL groups categories case-insensitively; the key above does not, so a group can come back as a single entry.
            ->filter(fn ($group) => $group->count() > 1)
            ->map(fn ($group) => $this->finding('possible_duplicate', $this->entryFacts($group->first()) + ['copies' => $group->count()], $group->pluck('id')->sort()->all(), (float) $group->first()->amount))
            ->values()
            ->all();
    }

    private function ledgerChanged(?FinancialReport $report): array
    {
        if (! $report || ! $this->ledgerChangedSinceGenerated($report)) {
            return [];
        }

        return [$this->finding('ledger_changed_since_generated', ['generated_at' => $report->generated_at?->toDateString()], [], null)];
    }
}
