<?php

namespace Database\Factories;

use App\Models\Election;
use App\Models\ElectionPosition;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<\App\Models\Candidate>
 */
class CandidateFactory extends Factory
{
    public function definition(): array
    {
        return [
            'election_id' => Election::factory(),
            'user_id' => User::factory()->student(),
            'position_id' => ElectionPosition::factory(),
            'platform' => fake()->paragraph(),
            'image_url' => fake()->optional()->imageUrl(),
        ];
    }
}
