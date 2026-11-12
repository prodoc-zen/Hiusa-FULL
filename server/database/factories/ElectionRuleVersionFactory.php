<?php

namespace Database\Factories;

use App\Models\Election;
use App\Models\ElectionRuleVersion;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<ElectionRuleVersion>
 */
class ElectionRuleVersionFactory extends Factory
{
    public function definition(): array
    {
        return [
            'election_id' => Election::factory(),
            'version' => 1,
            'rules' => fake()->paragraph(),
            'tie_break_rule' => 'The candidate with the higher general weighted average wins the tie.',
            'approved_by' => null,
            'approved_at' => now(),
        ];
    }
}
