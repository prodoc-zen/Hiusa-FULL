<?php

namespace App\Services\Ai;

use App\Contracts\TextGenerator;
use App\Services\Ai\Concerns\GuardsGeneratedText;
use App\Services\GroqResponsesService;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/**
 * Asks the primary generator first and the secondary only when the primary answers nothing, so a
 * Claude outage, refusal or timeout lands on Groq and, after that, on the caller's own deterministic text.
 * Logs which provider served, never the prompt or the data in it.
 *
 * generate() and generateStructured() run inside a web request, so both attempts share one deadline. A provider
 * that timed out or could not connect is skipped for services.ai.cooldown_seconds. converse() shares one longer
 * deadline (the chat timeout plus 15 seconds) the same way and honours the same cooling-off.
 */
class FallbackTextGenerator implements TextGenerator
{
    use GuardsGeneratedText;

    // Both attempts together; matches the cap each provider applies to a single call.
    private const DEADLINE_SECONDS = 12;

    // Added to the chat timeout for the secondary provider's turn.
    private const CHAT_MARGIN_SECONDS = 15;

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
        return $this->serve('generate', fn (TextGenerator $generator) => $generator->generate($instructions, $input, $maxOutputTokens, $temperature), true);
    }

    public function generateStructured(
        string $instructions,
        array $input,
        string $schemaName,
        array $schema,
        int $maxOutputTokens = 1800,
        float $temperature = 0.2,
    ): ?array {
        return $this->serve('generateStructured', fn (TextGenerator $generator) => $generator->generateStructured($instructions, $input, $schemaName, $schema, $maxOutputTokens, $temperature), true);
    }

    public function converse(string $instructions, array $messages, int $maxOutputTokens = 1400, ?callable $onEvent = null): ?array
    {
        $emitted = false;
        $track = $onEvent === null ? null : function (string $type, string $delta) use ($onEvent, &$emitted): void {
            $emitted = true;
            $onEvent($type, $delta);
        };
        $secondaryTurn = false;
        $chatSeconds = self::chatSeconds();

        return $this->serve('converse', function (TextGenerator $generator) use ($instructions, $messages, $maxOutputTokens, $onEvent, $track, &$emitted, &$secondaryTurn) {
            if ($secondaryTurn && $emitted && $onEvent !== null) {
                $onEvent('reset', '');
                $emitted = false;
            }
            $secondaryTurn = true;

            return $generator->converse($instructions, $messages, $maxOutputTokens, $track);
        }, true, $chatSeconds + self::CHAT_MARGIN_SECONDS, $chatSeconds);
    }

    /** The longest a chat answer may take across both providers: Claude's own timeout plus room for Groq. */
    public static function chatDeadlineSeconds(): int
    {
        return self::chatSeconds() + self::CHAT_MARGIN_SECONDS;
    }

    private static function chatSeconds(): int
    {
        return max(1, min(300, (int) config('services.anthropic.chat_timeout', 60) ?: 60));
    }

    /**
     * @param  \Closure(TextGenerator): ?array  $call
     */
    private function serve(string $operation, \Closure $call, bool $bounded = false, int $deadlineSeconds = self::DEADLINE_SECONDS, float $primaryShare = self::DEADLINE_SECONDS * 2 / 3): ?array
    {
        $deadline = microtime(true) + $deadlineSeconds;

        foreach ([[$this->primary, 'primary'], [$this->secondary, 'secondary']] as [$generator, $position]) {
            $name = $this->providerName($generator);

            if ($this->coolingOff($generator)) {
                Log::info('AI provider skipped while cooling off.', ['operation' => $operation, 'provider' => $name, 'position' => $position]);

                continue;
            }

            $budget = null;
            if ($bounded) {
                $remaining = $deadline - microtime(true);
                // The primary may not use the whole deadline, or a hung primary would leave the secondary nothing.
                $budget = $position === 'primary' ? min($remaining, $primaryShare) : $remaining;
                if ($budget < 1) {
                    Log::info('AI provider skipped, the shared deadline is spent.', ['operation' => $operation, 'provider' => $name, 'position' => $position]);

                    continue;
                }
            }

            $started = microtime(true);
            $this->timeBudget($generator, $budget);
            try {
                $result = $call($generator);
            } finally {
                $this->timeBudget($generator, null);
            }

            if ($result !== null) {
                Log::info('AI text served.', [
                    'operation' => $operation,
                    'provider' => $name,
                    'position' => $position,
                    'model' => $result['model'] ?? null,
                    'latency_ms' => (int) round((microtime(true) - $started) * 1000),
                    'stop_reason' => $generator instanceof ClaudeMessagesService ? $generator->lastStopReason() : null,
                ]);

                return $result;
            }

            if ($this->unreachable($generator)) {
                $this->startCoolingOff($generator);
            }

            Log::info('AI provider gave no answer.', [
                'operation' => $operation,
                'provider' => $name,
                'position' => $position,
                'latency_ms' => (int) round((microtime(true) - $started) * 1000),
                'stop_reason' => $generator instanceof ClaudeMessagesService ? $generator->lastStopReason() : null,
            ]);
        }

        Log::warning('No AI provider answered; the caller will use its deterministic text.', ['operation' => $operation]);

        return null;
    }

    private function timeBudget(TextGenerator $generator, ?float $seconds): void
    {
        if ($generator instanceof ClaudeMessagesService || $generator instanceof GroqResponsesService) {
            $generator->withTimeBudget($seconds);
        }
    }

    private function unreachable(TextGenerator $generator): bool
    {
        return ($generator instanceof ClaudeMessagesService || $generator instanceof GroqResponsesService) && $generator->lastCallUnreachable();
    }

    private function cooldownKey(TextGenerator $generator): string
    {
        return 'ai:provider-cooldown:'.$this->providerName($generator);
    }

    private function coolingOff(TextGenerator $generator): bool
    {
        return $this->cooldownSeconds() > 0 && Cache::has($this->cooldownKey($generator));
    }

    private function startCoolingOff(TextGenerator $generator): void
    {
        if ($this->cooldownSeconds() > 0) {
            Cache::put($this->cooldownKey($generator), true, $this->cooldownSeconds());
        }
    }

    private function cooldownSeconds(): int
    {
        return max(0, (int) config('services.ai.cooldown_seconds', 60));
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
