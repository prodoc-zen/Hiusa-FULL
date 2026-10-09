<?php

namespace App\Models;

use App\Models\Concerns\SerializesLocalDates;
use Database\Factories\FinancialForecastFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class FinancialForecast extends Model
{
    /** @use HasFactory<FinancialForecastFactory> */
    use HasFactory;

    use SerializesLocalDates;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'predicted_income' => 'decimal:2',
            'predicted_expense' => 'decimal:2',
            'predicted_balance' => 'decimal:2',
            'safe_spending_limit' => 'decimal:2',
            'model_details' => 'array',
        ];
    }

    public function generator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'generated_by', 'school_id');
    }

    /** The forecast written most recently. forecast_period is free text on older rows ("Q4 2024 (Oct-Dec)"), so it cannot say which is newest, and a regenerated period is rewritten in place so only updated_at moves. */
    public static function latestFor(int $organizationId): ?self
    {
        return static::where('organization_id', $organizationId)->orderByDesc('updated_at')->orderByDesc('id')->first();
    }
}
