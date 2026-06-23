<?php

namespace Database\Factories;

use App\Models\Election;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<\App\Models\ElectionPosition>
 */
class ElectionPositionFactory extends Factory
{
    public function definition(): array
    {
        return [
            'election_id' => Election::factory(),
            'title' => fake()->randomElement(['President', 'Vice President', 'Secretary', 'Treasurer', 'Auditor']),
            'max_winners' => 1,
        ];
    }
}
