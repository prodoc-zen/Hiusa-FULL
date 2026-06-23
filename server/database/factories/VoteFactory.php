<?php

namespace Database\Factories;

use App\Models\Candidate;
use App\Models\Election;
use App\Models\ElectionPosition;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<\App\Models\Vote>
 */
class VoteFactory extends Factory
{
    public function definition(): array
    {
        return [
            'election_id' => Election::factory(),
            'position_id' => ElectionPosition::factory(),
            'candidate_id' => Candidate::factory(),
            'voter_id' => User::factory()->student(),
            'vote_hash' => hash('sha256', Str::uuid()->toString()),
            'cast_at' => fake()->dateTimeBetween('-1 month', 'now'),
        ];
    }
}
