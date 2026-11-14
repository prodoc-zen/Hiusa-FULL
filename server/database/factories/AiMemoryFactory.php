<?php

namespace Database\Factories;

use App\Models\AiMemory;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<AiMemory>
 */
class AiMemoryFactory extends Factory
{
    public function definition(): array
    {
        $user = User::factory()->create();

        return [
            'user_id' => $user->school_id,
            'organization_id' => $user->organization_id,
            'role' => $user->role,
            'content' => fake()->sentence(6),
        ];
    }

    public function forUser(User $user): static
    {
        return $this->state(fn () => [
            'user_id' => $user->school_id,
            'organization_id' => $user->organization_id,
            'role' => $user->role,
        ]);
    }
}
