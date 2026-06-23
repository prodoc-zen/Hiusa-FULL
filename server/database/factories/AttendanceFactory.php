<?php

namespace Database\Factories;

use App\Models\Event;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<\App\Models\Attendance>
 */
class AttendanceFactory extends Factory
{
    public function definition(): array
    {
        return [
            'event_id' => Event::factory(),
            'user_id' => User::factory(),
            'check_in_time' => fake()->dateTimeBetween('-1 month', 'now'),
            'method' => fake()->randomElement(['biometric', 'qr_code', 'manual']),
        ];
    }
}
