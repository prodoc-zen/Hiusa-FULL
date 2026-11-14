<?php

namespace Database\Factories;

use App\Models\AiConversation;
use App\Models\AiMessage;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<AiMessage>
 */
class AiMessageFactory extends Factory
{
    public function definition(): array
    {
        return [
            'conversation_id' => AiConversation::factory(),
            'role' => 'user',
            'content' => fake()->sentence(),
            'payload' => null,
            'status' => 'completed',
            'feedback' => null,
        ];
    }

    public function assistant(array $payload = []): static
    {
        return $this->state(fn () => [
            'role' => 'assistant',
            'payload' => $payload + ['title' => 'Answer', 'intent' => 'daily_priorities', 'engine' => 'records', 'model_written' => false],
        ]);
    }
}
