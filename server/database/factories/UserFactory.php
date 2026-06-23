<?php

namespace Database\Factories;

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
            'school_id' => fake()->unique()->bothify('HIUSA-####'),
            'first_name' => fake()->firstName(),
            'last_name' => fake()->lastName(),
            'email' => fake()->unique()->safeEmail(),
            'password_hash' => static::$password ??= Hash::make('password'),
            'role' => fake()->randomElement(['student', 'officer', 'admin', 'adviser']),
            'biometric_template' => null,
        ];
    }

    public function student(): static
    {
        return $this->state(fn () => ['role' => 'student']);
    }

    public function officer(): static
    {
        return $this->state(fn () => ['role' => 'officer']);
    }

    public function admin(): static
    {
        return $this->state(fn () => ['role' => 'admin']);
    }

    public function adviser(): static
    {
        return $this->state(fn () => ['role' => 'adviser']);
    }
}
