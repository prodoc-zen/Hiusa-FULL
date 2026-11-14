<?php

namespace Database\Factories;

use App\Models\AiConversation;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<AiConversation>
 */
class AiConversationFactory extends Factory
{
    public function definition(): array
    {
        $user = User::factory()->create();

        return [
            'user_id' => $user->school_id,
            'organization_id' => $user->organization_id,
            'role' => $user->role,
            'title' => fake()->sentence(4),
            'last_message_at' => now(),
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
