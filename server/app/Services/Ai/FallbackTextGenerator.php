<?php

namespace App\Services\Ai;

use App\Contracts\TextGenerator;
use App\Services\Ai\Concerns\GuardsGeneratedText;
use App\Services\GroqResponsesService;
use Illuminate\Support\Facades\Log;

/**
 * Asks the primary generator first and the secondary only when the primary answers nothing, so a
 * Claude outage, refusal or timeout lands on Groq and, after that, on the caller's own deterministic text.
 * Logs which provider served, never the prompt or the data in it.
 */
class FallbackTextGenerator implements TextGenerator
{
    use GuardsGeneratedText;

    public function __construct(
        private readonly TextGenerator $primary,
        private readonly TextGenerator $secondary,
    ) {}

    public function generate(
        string $instructions,
        string $input,
        int $maxOutputTokens = 400,
        float $temperature = 0.2,
    ): ?array {
        return $this->serve('generate', fn (TextGenerator $generator) => $generator->generate($instructions, $input, $maxOutputTokens, $temperature));
    }

    public function generateStructured(
        string $instructions,
        array $input,
        string $schemaName,
        array $schema,
        int $maxOutputTokens = 1800,
        float $temperature = 0.2,
    ): ?array {
        return $this->serve('generateStructured', fn (TextGenerator $generator) => $generator->generateStructured($instructions, $input, $schemaName, $schema, $maxOutputTokens, $temperature));
    }

    /**
     * @param  \Closure(TextGenerator): ?array  $call
     */
    private function serve(string $operation, \Closure $call): ?array
    {
        foreach ([[$this->primary, 'primary'], [$this->secondary, 'secondary']] as [$generator, $position]) {
            $started = microtime(true);
            $result = $call($generator);

            if ($result !== null) {
                Log::info('AI text served.', [
                    'operation' => $operation,
                    'provider' => $this->providerName($generator),
                    'position' => $position,
                    'model' => $result['model'] ?? null,
                    'latency_ms' => (int) round((microtime(true) - $started) * 1000),
                    'stop_reason' => $generator instanceof ClaudeMessagesService ? $generator->lastStopReason() : null,
                ]);

                return $result;
            }

            Log::info('AI provider gave no answer.', [
                'operation' => $operation,
                'provider' => $this->providerName($generator),
                'position' => $position,
                'latency_ms' => (int) round((microtime(true) - $started) * 1000),
                'stop_reason' => $generator instanceof ClaudeMessagesService ? $generator->lastStopReason() : null,
            ]);
        }

        Log::warning('No AI provider answered; the caller will use its deterministic text.', ['operation' => $operation]);

        return null;
    }

    private function providerName(TextGenerator $generator): string
    {
        return match (true) {
            $generator instanceof ClaudeMessagesService => 'anthropic',
            $generator instanceof GroqResponsesService => 'groq',
            default => class_basename($generator),
        };
    }
}
