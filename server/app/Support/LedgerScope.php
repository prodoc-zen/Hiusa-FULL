<?php

namespace App\Support;

use App\Models\AcademicSemester;
use App\Models\Transaction;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;

/**
 * The one definition of which ledger entries a total covers: the organizations the caller reads, the semester picked in
 * the top bar (or the one asked for), the filters of the Ledger screen, and never an archived entry. The Ledger summary,
 * the Budgets page net balance and the event ledgers all read through it, so they cannot drift apart.
 */
final class LedgerScope
{
    /**
     * @param  array<int>  $organizationIds
     * @param  array<string, mixed>  $filters  validated filters: budget_id, event_id, type, academic_semester_id, from, to, search, event_search
     * @return Builder<Transaction>
     */
    public static function query(Request $request, array $organizationIds, array $filters = []): Builder
    {
        $query = Transaction::whereIn('transactions.organization_id', $organizationIds)->whereNull('transactions.archived_at');

        if (! empty($filters['academic_semester_id'])) {
            SemesterScope::dated($query, 'transaction_date', AcademicSemester::whereIn('id', FilterValues::values($filters['academic_semester_id']))->get());
        } else {
            SemesterScope::selected($query, 'transaction_date', AcademicSemester::selected($request));
        }

        if (! empty($filters['budget_id'])) {
            $query->whereIn('budget_id', FilterValues::values($filters['budget_id']));
        }

        if (! empty($filters['event_id'])) {
            $query->whereIn('event_id', FilterValues::values($filters['event_id']));
        }

        if (! empty($filters['event_search'])) {
            $eventSearch = trim($filters['event_search']);
            $query->whereHas('event', fn ($event) => $event->where('title', 'like', "%{$eventSearch}%"));
        }

        if (! empty($filters['type'])) {
            $query->whereIn('type', FilterValues::values($filters['type']));
        }

        if (! empty($filters['from'])) {
            $query->whereDate('transaction_date', '>=', $filters['from']);
        }

        if (! empty($filters['to'])) {
            $query->whereDate('transaction_date', '<=', $filters['to']);
        }

        if (! empty($filters['search'])) {
            $search = trim($filters['search']);
            $query->where(function ($nested) use ($search) {
                $nested->where('description', 'like', "%{$search}%")
                    ->orWhere('category', 'like', "%{$search}%")
                    ->orWhere('receipt_reference', 'like', "%{$search}%")
                    ->orWhereHas('event', fn ($event) => $event->where('title', 'like', "%{$search}%"))
                    ->orWhereHas('budget', fn ($budget) => $budget->where('title', 'like', "%{$search}%"));

                $nested->orWhereHas('payer', fn ($payer) => $payer->where('school_id', 'like', "%{$search}%")->orWhere('first_name', 'like', "%{$search}%")->orWhere('last_name', 'like', "%{$search}%")->orWhere('department', 'like', "%{$search}%")->orWhere('program', 'like', "%{$search}%")->orWhere('year_level', 'like', "%{$search}%"));

                if (ctype_digit($search)) {
                    $nested->orWhere('receipt_number', (int) $search);
                }
            });
        }

        return $query;
    }

    /**
     * Income, expense and net of the entries a query covers, as the Ledger summary reports them.
     *
     * @param  Builder<Transaction>  $query
     * @return array{total_income: float, total_expense: float, net_balance: float}
     */
    public static function totals(Builder $query): array
    {
        $sums = (clone $query)
            ->selectRaw("COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income")
            ->selectRaw("COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense")
            ->toBase()
            ->first();

        return [
            'total_income' => round((float) $sums->income, 2),
            'total_expense' => round((float) $sums->expense, 2),
            'net_balance' => round((float) $sums->income - (float) $sums->expense, 2),
        ];
    }
}
