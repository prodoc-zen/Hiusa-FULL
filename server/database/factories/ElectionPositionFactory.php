<?php

namespace Database\Factories;

use App\Models\Election;
use App\Models\ElectionPosition;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<ElectionPosition>
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
