<?php

namespace App\Services\Finance;

use App\Models\AcademicSemester;
use App\Models\FinancialReport;
use App\Models\Transaction;
use App\Models\User;
use App\Services\FinancialReportStatement;
use Illuminate\Support\Collection;

/**
 * Where a student's organization spent the money, taken only from financial reports the SAO has
 * given its final approval (submission_status = approved with sao_approved_at). Every figure
 * is computed from the report's saved snapshot through FinancialReportStatement, the same code
 * the report uses for its own totals, so it always equals the approved report. The live ledger is
 * never read, except for a report saved before snapshots existed, which the report itself reads
 * from the entries it listed. Remittances are custody movements held outside the ledger rows and
 * cash advances are excluded as FinancialReportStatement excludes them, so neither is income or spending.
 *
 * Nothing about people or documents is returned: no ledger rows, descriptions, payer or recorder
 * names, school IDs, supporting documents, letterhead or signatories.
 */
class ApprovedFeeUsage
{
    /**
     * @param  int|null  $reportId  Limit the result to this approved report of the student's organization.
     * @return array{
     *     organization: array{id: int, name: string}|null,
     *     reports: list<array{
     *         id: int,
     *         title: string,
     *         period_label: string|null,
     *         period_start: string|null,
     *         period_end: string|null,
     *         approved_at: string|null,
     *         totals: array{collected: float, spent: float, balance: float},
     *         spending: list<array{category: string, amount: float, share_percent: int}>,
     *         income: list<array{category: string, amount: float}>
     *     }>
     * } organization is null for a student without one; reports are newest approved first, and
     *   empty when the organization has no approved report (or none matches $reportId).
     *   period_start and period_end are Y-m-d. balance is the report's closing balance,
     *   spending is largest first with share_percent of total spent as a whole number, income is largest first.
     */
    public function summaryFor(User $user, ?int $reportId = null): array
    {
        $organization = $user->organization_id ? $user->organization()->first(['id', 'name']) : null;

        if (! $organization) {
            return ['organization' => null, 'reports' => []];
        }

        $reports = FinancialReport::query()
            ->where('organization_id', $organization->id)
            ->where('submission_status', 'approved')
            ->whereNotNull('sao_approved_at')
            ->when($reportId !== null, fn ($query) => $query->where('id', $reportId))
            ->orderByDesc('sao_approved_at')
            ->orderByDesc('id')
            ->get();

        $semesters = $reports->isEmpty() ? collect() : AcademicSemester::with('academicYear:id,label')->get();

        return [
            'organization' => ['id' => $organization->id, 'name' => $organization->name],
            'reports' => $reports->map(fn (FinancialReport $report) => $this->summarize($report, $semesters))->all(),
        ];
    }

    private function summarize(FinancialReport $report, Collection $semesters): array
    {
        $rows = $report->savedTransactions();
        $statement = FinancialReportStatement::from($rows, $this->openingBalance($report));
        $ordinary = FinancialReportStatement::ordinary($rows);
        $spent = $statement['totals']['expense'];

        return [
            'id' => $report->id,
            'title' => $report->title,
            'period_label' => $this->periodLabel($report, $semesters),
            'period_start' => $report->period_start?->toDateString(),
            'period_end' => $report->period_end?->toDateString(),
            'approved_at' => $report->sao_approved_at?->toIso8601String(),
            'totals' => [
                'collected' => $statement['totals']['income'],
                'spent' => $spent,
                'balance' => $statement['totals']['closing_balance'],
            ],
            'spending' => $this->byCategory($ordinary, 'expense')
                ->map(fn (array $row) => $row + ['share_percent' => $spent > 0 ? (int) round($row['amount'] / $spent * 100) : 0])
                ->all(),
            'income' => $this->byCategory($ordinary, 'income')->all(),
        ];
    }

    /** @return Collection<int, array{category: string, amount: float}> */
    private function byCategory(Collection $ordinary, string $type): Collection
    {
        return $ordinary->where('type', $type)
            ->groupBy(fn ($row) => trim((string) data_get($row, 'category')) ?: 'Uncategorized')
            ->map(fn (Collection $group, string $category) => ['category' => $category, 'amount' => round((float) $group->sum('amount'), 2)])
            ->sortByDesc('amount')
            ->values();
    }

    /** The opening balance the report itself shows: its snapshot, or for an old report the ledger before its period. */
    private function openingBalance(FinancialReport $report): float
    {
        if ($report->opening_balance_snapshot !== null) {
            return (float) $report->opening_balance_snapshot;
        }

        if ($report->event_id || ! $report->period_start) {
            return 0.0;
        }

        $totals = Transaction::query()
            ->where('organization_id', $report->organization_id)
            ->whereDate('transaction_date', '<', $report->period_start->toDateString())
            ->selectRaw("SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as income_total")
            ->selectRaw("SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as expense_total")
            ->first();

        return (float) ($totals?->income_total ?? 0) - (float) ($totals?->expense_total ?? 0);
    }

    private function periodLabel(FinancialReport $report, Collection $semesters): ?string
    {
        if (! $report->period_start || ! $report->period_end) {
            return null;
        }

        $start = $report->period_start;
        $end = $report->period_end;
        $semester = $report->event_id ? null : $semesters->first(fn (AcademicSemester $semester) => $semester->starts_on?->toDateString() === $start->toDateString()
            && $semester->ends_on?->toDateString() === $end->toDateString());

        if ($semester) {
            return ($semester->number === 1 ? '1st' : '2nd').' Semester, AY '.$semester->academicYear?->label;
        }

        return $start->year === $end->year
            ? $start->format('M j').' to '.$end->format('M j, Y')
            : $start->format('M j, Y').' to '.$end->format('M j, Y');
    }
}
