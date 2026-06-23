<?php

namespace Database\Factories;

use App\Models\Budget;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<\App\Models\Transaction>
 */
class TransactionFactory extends Factory
{
    public function definition(): array
    {
        return [
            'budget_id' => Budget::factory(),
            'recorded_by' => User::factory(),
            'type' => fake()->randomElement(['income', 'expense']),
            'category' => fake()->randomElement(['membership', 'sponsorship', 'venue', 'materials', 'merchandise']),
            'amount' => fake()->randomFloat(2, 100, 20000),
            'description' => fake()->sentence(),
            'receipt_reference' => fake()->optional()->unique()->bothify('RCPT-######'),
            'transaction_date' => fake()->dateTimeBetween('-6 months', 'now'),
        ];
    }
}
