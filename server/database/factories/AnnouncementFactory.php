<?php

namespace Database\Factories;

use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<\App\Models\Announcement>
 */
class AnnouncementFactory extends Factory
{
    public function definition(): array
    {
        return [
            'title' => fake()->sentence(4),
            'body' => fake()->paragraphs(3, true),
            'created_by' => User::factory(),
            'target_role' => fake()->randomElement(['all', 'student', 'officer', 'adviser']),
            'is_published' => fake()->boolean(),
        ];
    }
}
