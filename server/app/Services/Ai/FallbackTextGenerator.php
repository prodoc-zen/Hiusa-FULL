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
 * generate() and generateStructured() run inside a web request, so both attempts share one 37 second deadline: Claude,
 * which thinks before it answers, may use 25 of it and Groq (capped at 12 by its own service) gets what is left, which
 * after a Claude that used its whole cap is Groq's full 12 seconds. The deadline stays under the web server's 60 second
 * read timeout. A
 * provider that timed out or could not connect is skipped for services.ai.cooldown_seconds. converse() shares one
 * longer deadline (the chat timeout plus 15 seconds) the same way and honours the same cooling-off. The event plan is
 * the one structured call that gets its own deadline (services.ai.plan_deadline_seconds), because a full plan is the
 * longest answer either provider writes.
 */
class FallbackTextGenerator implements TextGenerator
{
    use GuardsGeneratedText;

    // Claude's part of the shared deadline: its default cap on one call (30 at most, but the share is never more than this).
    private const PRIMARY_SECONDS = 25;

    // Groq's part of the shared deadline: the cap GroqResponsesService puts on one call.
    private const SECONDARY_SECONDS = 12;

    // Both attempts together: a Claude that times out at its cap still leaves Groq its whole turn.
    private const DEADLINE_SECONDS = self::PRIMARY_SECONDS + self::SECONDARY_SECONDS;

    // The shortest deadline the event plan may be given, whatever services.ai.plan_deadline_seconds says.
    private const PLAN_DEADLINE_FLOOR_SECONDS = 30;

    // The structured call that builds an event's to-do plan; EventController passes this schema name.
    public const EVENT_PLAN_SCHEMA = 'hiusa_event_workflow';

    // The primary's part of the longer plan deadline; the rest is Groq's turn.
    private const PLAN_PRIMARY_SHARE = 0.75;

    // A provider that has said nothing for this long gets a 'tick' event, so the caller can keep the page alive.
    private const TICK_SECONDS = 4;

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
        $call = fn (TextGenerator $generator) => $generator->generateStructured($instructions, $input, $schemaName, $schema, $maxOutputTokens, $temperature);
        if ($schemaName !== self::EVENT_PLAN_SCHEMA) {
            return $this->serve('generateStructured', $call, true);
        }

        $planSeconds = max(self::PLAN_DEADLINE_FLOOR_SECONDS, min(120, (int) config('services.ai.plan_deadline_seconds', 30) ?: 30));

        return $this->serve('generateStructured', $call, true, $planSeconds, $planSeconds * self::PLAN_PRIMARY_SHARE, $planSeconds);
    }

    public function converse(string $instructions, array $messages, int $maxOutputTokens = 1400, ?callable $onEvent = null): ?array
    {
        $emitted = false;
        $lastEvent = microtime(true);
        $track = $onEvent === null ? null : function (string $type, string $delta) use ($onEvent, &$emitted, &$lastEvent): void {
            $lastEvent = microtime(true);
            $emitted = $emitted || $type !== 'tick';
            $onEvent($type, $delta);
        };
        $secondaryTurn = false;
        $chatSeconds = self::chatSeconds();

        return $this->serve('converse', function (TextGenerator $generator) use ($instructions, $messages, $maxOutputTokens, $onEvent, $track, &$emitted, &$secondaryTurn, &$lastEvent) {
            if ($secondaryTurn && $emitted && $onEvent !== null) {
                $onEvent('reset', '');
                $emitted = false;
            }
            if ($secondaryTurn && $track !== null && microtime(true) - $lastEvent >= self::TICK_SECONDS) {
                $track('tick', '');
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
     * $timeoutCeiling lifts each provider's own request cap (30 seconds for Claude, 12 for Groq) to that many seconds,
     * so a deadline longer than the cap is not cut short by the HTTP timeout; the budget still bounds every attempt.
     *
     * @param  \Closure(TextGenerator): ?array  $call
     */
    private function serve(string $operation, \Closure $call, bool $bounded = false, int $deadlineSeconds = self::DEADLINE_SECONDS, float $primaryShare = self::PRIMARY_SECONDS, ?float $timeoutCeiling = null): ?array
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
            $this->timeBudget($generator, $budget, $timeoutCeiling);
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

    private function timeBudget(TextGenerator $generator, ?float $seconds, ?float $ceiling = null): void
    {
        if ($generator instanceof ClaudeMessagesService || $generator instanceof GroqResponsesService) {
            $generator->withTimeBudget($seconds, $ceiling);
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
