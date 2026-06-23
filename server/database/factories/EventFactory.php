<?php

namespace Database\Factories;

use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<\App\Models\Event>
 */
class EventFactory extends Factory
{
    public function definition(): array
    {
        $start = fake()->dateTimeBetween('+1 week', '+2 months');

        return [
            'title' => fake()->sentence(4),
            'description' => fake()->paragraph(),
            'start_time' => $start,
            'end_time' => (clone $start)->modify('+2 hours'),
            'location' => fake()->city(),
            'status' => fake()->randomElement(['planning', 'approved', 'ongoing', 'completed', 'cancelled']),
            'created_by' => User::factory(),
        ];
    }
}
