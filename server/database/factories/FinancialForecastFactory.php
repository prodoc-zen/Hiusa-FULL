<?php

namespace Database\Factories;

use App\Models\FinancialForecast;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<FinancialForecast>
 */
class FinancialForecastFactory extends Factory
{
    public function definition(): array
    {
        return [
            'forecast_period' => 'Q'.fake()->numberBetween(1, 4).' '.fake()->year(),
            'predicted_income' => fake()->randomFloat(2, 5000, 100000),
            'predicted_expense' => fake()->randomFloat(2, 5000, 100000),
            'confidence_note' => fake()->optional()->paragraph(),
        ];
    }
}
