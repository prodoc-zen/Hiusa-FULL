<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

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
        ];
    }
}
