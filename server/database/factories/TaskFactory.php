<?php

namespace Database\Factories;

use App\Models\Event;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<\App\Models\Task>
 */
class TaskFactory extends Factory
{
    public function definition(): array
    {
        return [
            'event_id' => Event::factory(),
            'created_by' => User::factory(),
            'title' => fake()->sentence(4),
            'description' => fake()->paragraph(),
            'assigned_to' => User::factory(),
            'status' => fake()->randomElement(['pending', 'in_progress', 'completed', 'overdue']),
            'deadline' => fake()->dateTimeBetween('+1 day', '+1 month'),
            'ai_recommendation_note' => fake()->optional()->sentence(),
        ];
    }
}
