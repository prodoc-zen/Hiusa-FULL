<?php

namespace Database\Factories;

use App\Models\Candidate;
use App\Models\Election;
use App\Models\ElectionBallot;
use App\Models\ElectionPosition;
use App\Models\User;
use App\Models\Vote;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<Vote>
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

    /** A vote with a voter id also records that voter's round participation, as a real ballot does. */
    public function configure(): static
    {
        return $this->afterCreating(function (Vote $vote) {
            if ($vote->voter_id === null) {
                return;
            }

            ElectionBallot::query()->firstOrCreate(
                ['election_id' => $vote->election_id, 'round' => $vote->round ?? 1, 'voter_id' => $vote->voter_id],
                ['receipt_ref' => substr($vote->vote_hash, 0, 16), 'submitted_at' => $vote->cast_at],
            );
        });
    }
}
