<?php

namespace Database\Factories;

use App\Models\Election;
use App\Models\OfficerAppointment;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<OfficerAppointment>
 */
class OfficerAppointmentFactory extends Factory
{
    public function definition(): array
    {
        return [
            'organization_id' => Organization::factory(),
            'election_id' => Election::factory(),
            'election_position_id' => null,
            'user_school_id' => fn () => User::factory()->student()->create()->school_id,
            'position_title' => 'Secretary',
            'is_executive' => true,
            'role' => 'SBO_OFFICER',
            'kind' => 'incoming',
            'status' => 'upcoming',
            'activation_status' => 'scheduled',
        ];
    }
}
