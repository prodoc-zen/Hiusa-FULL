<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<\App\Models\Organization>
 */
class OrganizationFactory extends Factory
{
    public function definition(): array
    {
        $name = fake()->unique()->company() . ' Student Organization';

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
}
