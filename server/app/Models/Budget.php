<?php

namespace App\Models;

use App\Models\Concerns\SerializesLocalDates;
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

    /** What is left to spend: the allocation, plus income recorded against it, minus what was spent from it. */
    public function recomputedRemaining(): float
    {
        $totals = $this->transactions()
            ->selectRaw("COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as income, COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as expense")
            ->first();

        return round((float) $this->allocated_amount + (float) $totals->income - (float) $totals->expense, 2);
    }

    /**
     * Spent per budget id as a two decimal string, in one query. Expenses only and cash advance
     * movements left out, because income recorded against a budget raises its remaining amount
     * and must not net off what was spent.
     *
     * @param  iterable<int>  $ids
     * @return array<int, string>
     */
    public static function spentAmounts(iterable $ids): array
    {
        $ids = collect($ids)->unique()->values();

        if ($ids->isEmpty()) {
            return [];
        }

        $totals = Transaction::whereIn('budget_id', $ids)
            ->where('type', 'expense')
            ->excludingCashAdvances()
            ->selectRaw('budget_id, SUM(amount) as total')
            ->groupBy('budget_id')
            ->pluck('total', 'budget_id');

        return $ids->mapWithKeys(fn ($id) => [$id => number_format((float) ($totals[$id] ?? 0), 2, '.', '')])->all();
    }

    public static function overspendingRiskFor(float $remaining, float $warningThreshold): string
    {
        if ($remaining < 0) {
            return 'high';
        }

        return $remaining <= $warningThreshold ? 'medium' : 'low';
    }

    public function transactions(): HasMany
    {
        return $this->hasMany(Transaction::class);
    }
}
