<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<\App\Models\Election>
 */
class ElectionFactory extends Factory
{
    public function definition(): array
    {
        $start = fake()->dateTimeBetween('+1 week', '+2 months');

        return [
            'title' => fake()->sentence(3),
            'start_time' => $start,
            'end_time' => (clone $start)->modify('+1 day'),
            'status' => fake()->randomElement(['upcoming', 'active', 'closed']),
        ];
    }
}
