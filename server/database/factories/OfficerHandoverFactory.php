<?php

namespace Database\Factories;

use App\Models\Election;
use App\Models\OfficerHandover;
use App\Models\Organization;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<OfficerHandover>
 */
class OfficerHandoverFactory extends Factory
{
    public function definition(): array
    {
        return [
            'organization_id' => Organization::factory(),
            'election_id' => Election::factory(),
            'category' => fake()->randomElement(array_keys(OfficerHandover::CATEGORIES)),
            'status' => 'pending',
        ];
    }
}
