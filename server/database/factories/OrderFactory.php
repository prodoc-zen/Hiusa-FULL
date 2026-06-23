<?php

namespace Database\Factories;

use App\Models\Merchandise;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<\App\Models\Order>
 */
class OrderFactory extends Factory
{
    public function definition(): array
    {
        $quantity = fake()->numberBetween(1, 5);

        return [
            'student_id' => User::factory()->student(),
            'merchandise_id' => Merchandise::factory(),
            'quantity' => $quantity,
            'total_price' => fake()->randomFloat(2, 50 * $quantity, 1500 * $quantity),
            'status' => fake()->randomElement(['pending', 'paid', 'claimed', 'cancelled']),
            'payment_method' => fake()->randomElement(['cash_on_claim', 'e_wallet']),
            'claim_token' => Str::upper(Str::random(10)),
            'processed_by' => fake()->optional()->randomElement([User::factory()->officer()]),
            'approved_by' => fake()->optional()->randomElement([User::factory()->officer()]),
            'claimed_at' => fake()->optional()->dateTimeBetween('-1 month', 'now'),
        ];
    }
}
