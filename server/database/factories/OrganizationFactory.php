<?php

namespace Database\Factories;

use App\Models\Organization;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<Organization>
 */
class OrganizationFactory extends Factory
{
    public function definition(): array
    {
        $name = fake()->unique()->company().' Student Organization';

        return [
            'name' => $name,
            'slug' => Str::slug($name),
            'college' => fake()->randomElement([
                'College of Computer Studies',
                'College of Business Education',
                'College of Teacher Education',
                'College of Health Sciences',
            ]),
            'acronym' => strtoupper(fake()->unique()->lexify('????')),
            'is_active' => true,
        ];
    }

    public function withGcashQr(): static
    {
        return $this->state(fn (array $attributes) => [
            'gcash_qr_url' => '/uploads/gcash/'.Str::random(20).'.png',
        ]);
    }
}
