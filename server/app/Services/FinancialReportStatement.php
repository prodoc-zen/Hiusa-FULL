<?php

namespace App\Services;

use Illuminate\Support\Collection;

/**
 * What a financial report's ledger rows add up to. Cash advances move cash but are money
 * lent out and returned, so they stay out of income and expense and are totalled on their own.
 *
 * A row is a cash advance movement when it carries 'cash_advance' => 'release' or 'repayment',
 * which generating the report sets from the records that created the ledger entry. Reports
 * saved before that have no such mark and add up as they were saved.
 */
class FinancialReportStatement
{
    /** @return array{totals: array<string, float>, cash_advances: array<string, float>} */
    public static function from(iterable $rows, float $openingBalance = 0.0): array
    {
        $rows = collect($rows);
        $ordinary = self::ordinary($rows);
        $income = (float) $ordinary->where('type', 'income')->sum('amount');
        $expense = (float) $ordinary->where('type', 'expense')->sum('amount');
        $released = (float) $rows->where('cash_advance', 'release')->sum('amount');
        $repaid = (float) $rows->where('cash_advance', 'repayment')->sum('amount');

        return [
            'totals' => [
                'income' => round($income, 2),
                'expense' => round($expense, 2),
                'balance' => round($income - $expense, 2),
                'opening_balance' => round($openingBalance, 2),
                'closing_balance' => round($openingBalance + $income - $expense + $repaid - $released, 2),
            ],
            'cash_advances' => ['released' => round($released, 2), 'repayments' => round($repaid, 2)],
        ];
    }

    /** The rows that are income or expense: everything except cash advance releases and repayments. */
    public static function ordinary(iterable $rows): Collection
    {
        return collect($rows)->filter(fn ($row) => data_get($row, 'cash_advance') === null)->values();
    }

    /** The cash advance releases and repayments among the rows. */
    public static function cashAdvances(iterable $rows): Collection
    {
        return collect($rows)->filter(fn ($row) => data_get($row, 'cash_advance') !== null)->values();
    }
}
