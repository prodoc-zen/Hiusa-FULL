<?php

namespace Database\Factories;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Hash;

/**
 * @extends Factory<User>
 */
class UserFactory extends Factory
{
    protected static ?string $password;

    public function definition(): array
    {
        return [
            'organization_id' => Organization::query()->first()?->id ?? Organization::factory(),
            'school_id' => fake()->unique()->numberBetween(100000, 99999999),
            'first_name' => fake()->firstName(),
            'last_name' => fake()->lastName(),
            'email' => fake()->unique()->safeEmail(),
            'password_hash' => static::$password ??= Hash::make('password'),
            'role' => fake()->randomElement(['STUDENT', 'SBO_OFFICER', 'ADMIN']),
            'biometric_template' => null,
        ];
    }

    public function student(): static
    {
        return $this->state(fn () => ['role' => 'STUDENT']);
    }

    public function officer(): static
    {
        return $this->state(fn () => ['role' => 'SBO_OFFICER']);
    }

    public function admin(): static
    {
        return $this->state(fn () => ['role' => 'ADMIN']);
    }

    public function adviser(): static
    {
        return $this->state(fn () => ['role' => 'ADMIN', 'position_title' => 'Adviser']);
    }

    public function departmentHead(): static
    {
        return $this->state(fn () => ['role' => 'DEPARTMENT_HEAD']);
    }
}
