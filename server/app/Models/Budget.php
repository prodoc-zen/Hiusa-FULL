<?php

namespace App\Models;

use App\Models\Concerns\SerializesLocalDates;
use App\Services\BudgetAdviceRules;
use Database\Factories\BudgetFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Budget extends Model
{
    /** @use HasFactory<BudgetFactory> */
    use HasFactory;

    use SerializesLocalDates;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'allocated_amount' => 'decimal:2',
            'remaining_amount' => 'decimal:2',
            'warning_threshold' => 'decimal:2',
            'recommended_allocation' => 'decimal:2',
            'safe_spending_limit' => 'decimal:2',
            'advice_generated_at' => 'datetime',
            'department_head_approved_at' => 'datetime',
        ];
    }

    public function event(): BelongsTo
    {
        return $this->belongsTo(Event::class);
    }

    public function financialSemester(): BelongsTo
    {
        return $this->belongsTo(FinancialSemester::class);
    }

    /** What is left to spend: the allocation, plus income recorded against it, minus what was spent from it. Archived entries count for nothing. */
    public function recomputedRemaining(): float
    {
        $totals = $this->transactions()
            ->whereNull('transactions.archived_at')
            ->selectRaw("COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as income, COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as expense")
            ->first();

        return round((float) $this->allocated_amount + (float) $totals->income - (float) $totals->expense, 2);
    }

    /**
     * Spent per budget id as a two decimal string, in one query. Expenses only, with cash advance
     * movements and archived entries left out, because income recorded against a budget raises its
     * remaining amount and must not net off what was spent.
     *
     * @param  iterable<int>  $ids
     * @return array<int, string>
     */
    public static function spentAmounts(iterable $ids): array
    {
        return self::linkedTotals($ids, 'expense');
    }

    /**
     * Income recorded against each budget id as a two decimal string, counted by the same rule as spentAmounts.
     *
     * @param  iterable<int>  $ids
     * @return array<int, string>
     */
    public static function incomeAmounts(iterable $ids): array
    {
        return self::linkedTotals($ids, 'income');
    }

    /**
     * The four figures a budget shows, as two decimal strings, keyed by budget id. Only an approved budget is
     * released: it adds income and takes off what was spent. Any other budget shows nothing spent, no income and its
     * whole allocation as remaining, whatever an older entry might still be linked to it.
     *
     * @param  iterable<Budget>  $budgets
     * @return array<int, array{allocated_amount: string, spent_amount: string, income_amount: string, remaining_amount: string, is_released: bool}>
     */
    public static function figuresFor(iterable $budgets): array
    {
        $budgets = collect($budgets);
        $releasedIds = $budgets->filter(fn (Budget $budget) => $budget->submission_status === 'approved')->pluck('id');
        $spent = self::spentAmounts($releasedIds);
        $income = self::incomeAmounts($releasedIds);
        $money = fn (float $amount) => number_format($amount, 2, '.', '');

        return $budgets->mapWithKeys(function (Budget $budget) use ($releasedIds, $spent, $income, $money) {
            $released = $releasedIds->contains($budget->id);
            $allocated = (float) $budget->allocated_amount;
            $spentAmount = $released ? (float) $spent[$budget->id] : 0.0;
            $incomeAmount = $released ? (float) $income[$budget->id] : 0.0;

            return [$budget->id => [
                'allocated_amount' => $money($allocated),
                'spent_amount' => $money($spentAmount),
                'income_amount' => $money($incomeAmount),
                'remaining_amount' => $money($allocated + $incomeAmount - $spentAmount),
                'is_released' => $released,
            ]];
        })->all();
    }

    /**
     * @param  iterable<int>  $ids
     * @return array<int, string>
     */
    private static function linkedTotals(iterable $ids, string $type): array
    {
        $ids = collect($ids)->unique()->values();

        if ($ids->isEmpty()) {
            return [];
        }

        $totals = Transaction::whereIn('budget_id', $ids)
            ->where('type', $type)
            ->whereNull('transactions.archived_at')
            ->excludingCashAdvances()
            ->selectRaw('budget_id, SUM(amount) as total')
            ->groupBy('budget_id')
            ->pluck('total', 'budget_id');

        return $ids->mapWithKeys(fn ($id) => [$id => number_format((float) ($totals[$id] ?? 0), 2, '.', '')])->all();
    }

    public static function overspendingRiskFor(float $remaining, float $warningThreshold): string
    {
        return BudgetAdviceRules::riskFor($remaining, $warningThreshold);
    }

    public function transactions(): HasMany
    {
        return $this->hasMany(Transaction::class);
    }
}
