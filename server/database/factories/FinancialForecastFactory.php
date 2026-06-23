<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<\App\Models\FinancialForecast>
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
