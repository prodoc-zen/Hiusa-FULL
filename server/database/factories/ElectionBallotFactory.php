<?php

namespace Database\Factories;

use App\Models\Election;
use App\Models\ElectionBallot;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<ElectionBallot>
 */
class ElectionBallotFactory extends Factory
{
    public function definition(): array
    {
        return [
            'election_id' => Election::factory(),
            'round' => 1,
            'voter_id' => fn () => User::factory()->student()->create()->school_id,
            'receipt_ref' => strtoupper(Str::random(16)),
            'submitted_at' => now(),
        ];
    }
}
