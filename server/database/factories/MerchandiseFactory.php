<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<\App\Models\Merchandise>
 */
class MerchandiseFactory extends Factory
{
    public function definition(): array
    {
        return [
            'name' => fake()->words(3, true),
            'category' => fake()->randomElement(['shirt', 'lanyard', 'pin', 'jacket', 'accessory']),
            'description' => fake()->paragraph(),
            'price' => fake()->randomFloat(2, 50, 1500),
            'stock_quantity' => fake()->numberBetween(0, 200),
            'image_url' => fake()->optional()->imageUrl(),
            'is_active' => fake()->boolean(85),
        ];
    }
}
