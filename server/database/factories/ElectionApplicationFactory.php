<?php

namespace Database\Factories;

use App\Models\Election;
use App\Models\ElectionApplication;
use App\Models\ElectionPosition;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<ElectionApplication>
 */
class ElectionApplicationFactory extends Factory
{
    public function definition(): array
    {
        return [
            'election_id' => Election::factory(),
            'position_id' => fn (array $attributes) => ElectionPosition::factory()->create(['election_id' => $attributes['election_id']])->id,
            'user_school_id' => fn () => User::factory()->student()->create()->school_id,
            'status' => 'draft',
            'platform' => fake()->paragraph(),
        ];
    }
}
