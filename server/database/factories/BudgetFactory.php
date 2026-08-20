<?php

namespace Database\Factories;

use App\Models\Budget;
use App\Models\Event;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Budget>
 */
class BudgetFactory extends Factory
{
    public function definition(): array
    {
        return [
            'event_id' => fake()->optional()->randomElement([Event::factory()]),
            'title' => fake()->words(3, true),
            'allocated_amount' => fake()->randomFloat(2, 1000, 100000),
            'warning_threshold' => fake()->randomFloat(2, 100, 1000),
        ];
    }
}
