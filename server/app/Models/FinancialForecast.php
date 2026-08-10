<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class FinancialForecast extends Model
{
    /** @use HasFactory<\Database\Factories\FinancialForecastFactory> */
    use HasFactory;

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
}