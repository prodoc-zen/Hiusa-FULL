<?php

namespace App\Services\Ai;

use Anthropic\Client;
use Anthropic\Core\Exceptions\APIConnectionException;
use Anthropic\Core\Exceptions\APIException;
use Anthropic\Core\Exceptions\APIStatusException;
use Anthropic\Core\Exceptions\APITimeoutException;
use Anthropic\Core\Exceptions\AuthenticationException;
use Anthropic\Core\Exceptions\BadRequestException;
use Anthropic\Core\Exceptions\RateLimitException;
use Anthropic\Messages\JSONOutputFormat;
use Anthropic\Messages\Message;
use Anthropic\Messages\OutputConfig;
use Anthropic\Messages\RawContentBlockDeltaEvent;
use Anthropic\Messages\RawMessageDeltaEvent;
use Anthropic\Messages\RawMessageStartEvent;
use Anthropic\Messages\TextDelta;
use Anthropic\Messages\ThinkingDelta;
use App\Contracts\TextGenerator;
use App\Services\Ai\Concerns\GuardsGeneratedText;
use GuzzleHttp\Client as GuzzleClient;
use Illuminate\Support\Facades\Log;
use Psr\Http\Client\ClientInterface;

/**
 * Claude (Anthropic Messages API) behind the same contract as GroqResponsesService.
 *
 * Every failure path answers null so the caller falls back, exactly as it does for Groq. Nothing here
 * logs prompt text or anything a student typed: only the model, timing, stop reason and error class.
 */
class ClaudeMessagesService implements TextGenerator
{
    use GuardsGeneratedText;

    // Every caller runs inside a web request, so one short attempt beats a long retry that stalls the page.
    private const MAX_REQUEST_SECONDS = 12;

    // The budgets callers pass were sized for another model; Claude spends more tokens per word.
    private const TOKEN_HEADROOM = 1.5;

    // Adaptive thinking draws on max_tokens before the answer starts.
    private const THINKING_HEADROOM = 2048;

    private ?string $lastStopReason = null;

    private ?float $timeBudget = null;

    private bool $unreachable = false;

    /**
     * @param  ClientInterface|null  $transporter  PSR-18 client. Tests pass a faked one; production builds Guzzle.
     *                                             The SDK enforces no timeout of its own, the transport must.
     */
    public function __construct(private readonly ?ClientInterface $transporter = null) {}

    /** Stop reason of the most recent call, for the fallback generator's log line. */
    public function lastStopReason(): ?string
    {
        return $this->lastStopReason;
    }

    /** Seconds left in the fallback chain's shared deadline; null leaves only the configured timeout. */
    public function withTimeBudget(?float $seconds): void
    {
        $this->timeBudget = $seconds;
    }

    /** True when the most recent call timed out or could not connect, so the chain can rest this provider briefly. */
    public function lastCallUnreachable(): bool
    {
        return $this->unreachable;
    }

    public function generate(
        string $instructions,
        string $input,
        int $maxOutputTokens = 400,
        float $temperature = 0.2,
    ): ?array {
        $message = $this->request($instructions, $input, $maxOutputTokens, OutputConfig::with(effort: $this->effort()));
        if ($message === null) {
            return null;
        }

        $text = trim($this->textOf($message));
        if ($text === '') {
            Log::warning('Claude returned no output text.', ['response_id' => $message->id]);

            return null;
        }

        return [
            'text' => $text,
            'model' => $message->model,
            'response_id' => $message->id,
        ];
    }

    public function generateStructured(
        string $instructions,
        array $input,
        string $schemaName,
        array $schema,
        int $maxOutputTokens = 1800,
        float $temperature = 0.2,
    ): ?array {
        $message = $this->request(
            $instructions,
            (string) json_encode($input, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
            $maxOutputTokens,
            OutputConfig::with(
                effort: $this->effort(),
                format: JSONOutputFormat::with(schema: $this->apiSchema($schema)),
            ),
        );
        if ($message === null) {
            return null;
        }

        $text = trim($this->textOf($message));
        $decoded = json_decode($text, true);

        if (! is_array($decoded) || array_is_list($decoded) || ! $this->matchesSchema($decoded, $schema)) {
            Log::warning('Claude structured response did not match the requested schema.', [
                'response_id' => $message->id,
                'schema' => $schemaName,
                'json_error' => json_last_error_msg(),
            ]);

            return null;
        }

        return [
            'data' => $decoded,
            'text' => $text,
            'model' => $message->model,
            'response_id' => $message->id,
        ];
    }

    /**
     * Streams a conversation turn. Adaptive thinking spends output tokens before the first word, so the cap
     * carries extra room for it. An exception thrown by $onEvent (the caller aborting) is rethrown untouched.
     */
    public function converse(string $instructions, array $messages, int $maxOutputTokens = 1400, ?callable $onEvent = null): ?array
    {
        $this->lastStopReason = null;
        $this->unreachable = false;
        $apiKey = trim((string) config('services.anthropic.key'));

        if ($apiKey === '' || $messages === []) {
            return null;
        }

        $started = microtime(true);
        $text = '';
        $reasoning = '';
        $model = $this->model();
        $responseId = null;
        $stopReason = null;
        $callbackError = null;

        $emit = function (string $type, string $delta) use ($onEvent, &$callbackError): void {
            if ($onEvent === null) {
                return;
            }
            try {
                $onEvent($type, $delta);
            } catch (\Throwable $exception) {
                $callbackError = $exception;

                throw $exception;
            }
        };

        try {
            $stream = $this->client($apiKey, $this->chatSeconds())->messages->createStream(
                maxTokens: (int) ceil($maxOutputTokens * self::TOKEN_HEADROOM) + self::THINKING_HEADROOM,
                messages: array_map(fn (array $turn) => ['role' => $turn['role'], 'content' => $turn['content']], array_values($messages)),
                model: $this->model(),
                outputConfig: OutputConfig::with(effort: $this->chatEffort()),
                system: [['type' => 'text', 'text' => $instructions, 'cacheControl' => ['type' => 'ephemeral']]],
                thinking: ['type' => 'adaptive', 'display' => 'summarized'],
            );

            foreach ($stream as $event) {
                if ($event instanceof RawMessageStartEvent) {
                    $model = $event->message->model;
                    $responseId = $event->message->id;
                } elseif ($event instanceof RawContentBlockDeltaEvent) {
                    if ($event->delta instanceof ThinkingDelta && $event->delta->thinking !== '') {
                        $reasoning .= $event->delta->thinking;
                        $emit('reasoning', $event->delta->thinking);
                    } elseif ($event->delta instanceof TextDelta && $event->delta->text !== '') {
                        $text .= $event->delta->text;
                        $emit('text', $event->delta->text);
                    }
                } elseif ($event instanceof RawMessageDeltaEvent) {
                    $stopReason = $event->delta->stopReason ?? $stopReason;
                }
            }
        } catch (\Throwable $exception) {
            if ($callbackError !== null) {
                throw $callbackError;
            }

            return $this->failed($exception, $started);
        }

        $this->lastStopReason = $stopReason;
        $latencyMs = (int) round((microtime(true) - $started) * 1000);

        if ($stopReason !== 'end_turn' || trim($text) === '') {
            Log::warning('Claude did not finish a conversation answer.', [
                'stop_reason' => $stopReason,
                'model' => $model,
                'response_id' => $responseId,
                'latency_ms' => $latencyMs,
            ]);

            return null;
        }

        Log::info('Claude answered a conversation turn.', [
            'model' => $model,
            'response_id' => $responseId,
            'stop_reason' => $stopReason,
            'latency_ms' => $latencyMs,
        ]);

        return [
            'text' => trim($text),
            'reasoning' => trim($reasoning) === '' ? null : trim($reasoning),
            'model' => $model,
            'response_id' => $responseId,
        ];
    }

    private function request(string $instructions, string $input, int $maxOutputTokens, OutputConfig $outputConfig): ?Message
    {
        $this->lastStopReason = null;
        $this->unreachable = false;
        $apiKey = trim((string) config('services.anthropic.key'));

        if ($apiKey === '') {
            return null;
        }

        $started = microtime(true);

        try {
            $message = $this->client($apiKey)->messages->create(
                maxTokens: max(64, (int) ceil($maxOutputTokens * self::TOKEN_HEADROOM)),
                messages: [['role' => 'user', 'content' => $input]],
                model: $this->model(),
                outputConfig: $outputConfig,
                system: $instructions,
                // Sonnet 5.5 rejects thinking disabled; between_tools adds no reasoning pass to a one-shot call.
                // It also rejects temperature, top_p and top_k, so none of them are ever sent.
                thinking: ['type' => 'between_tools'],
            );
        } catch (APITimeoutException $exception) {
            return $this->failed($exception, $started);
        } catch (APIConnectionException $exception) {
            return $this->failed($exception, $started);
        } catch (RateLimitException $exception) {
            return $this->failed($exception, $started);
        } catch (AuthenticationException $exception) {
            return $this->failed($exception, $started);
        } catch (BadRequestException $exception) {
            return $this->failed($exception, $started);
        } catch (APIStatusException $exception) {
            return $this->failed($exception, $started);
        } catch (APIException $exception) {
            return $this->failed($exception, $started);
        } catch (\Throwable $exception) {
            // The SDK or its HTTP stack broke in a way it does not type; the caller still needs its fallback.
            return $this->failed($exception, $started);
        }

        $this->lastStopReason = $message->stopReason;
        $latencyMs = (int) round((microtime(true) - $started) * 1000);

        // A refusal or a cut-off answer must not be shown as if it were finished copy.
        if ($message->stopReason !== 'end_turn') {
            Log::warning('Claude did not finish an answer.', [
                'stop_reason' => $message->stopReason,
                'model' => $message->model,
                'response_id' => $message->id,
                'latency_ms' => $latencyMs,
            ]);

            return null;
        }

        Log::info('Claude answered.', [
            'model' => $message->model,
            'response_id' => $message->id,
            'stop_reason' => $message->stopReason,
            'latency_ms' => $latencyMs,
            'input_tokens' => $message->usage->inputTokens ?? null,
            'output_tokens' => $message->usage->outputTokens ?? null,
        ]);

        return $message;
    }

    private function failed(\Throwable $exception, float $started): null
    {
        $this->unreachable = $exception instanceof APITimeoutException || $exception instanceof APIConnectionException;

        Log::warning('Claude is unavailable.', [
            'exception' => $exception::class,
            'status' => $exception instanceof APIException ? $exception->status : null,
            'request_id' => $exception instanceof APIException ? $exception->getRequestID() : null,
            'latency_ms' => (int) round((microtime(true) - $started) * 1000),
        ]);

        return null;
    }

    private function client(string $apiKey, ?int $seconds = null): Client
    {
        $total = (float) ($seconds ?? $this->requestSeconds());
        $transporter = $this->transporter ?? new GuzzleClient([
            'timeout' => $total,
            'connect_timeout' => min($total, (float) max(1, (int) config('services.anthropic.connect_timeout', 3))),
        ]);

        // maxRetries 0: Groq is the retry, and a second Claude attempt would push the page past its cap.
        return new Client(apiKey: $apiKey, requestOptions: [
            'transporter' => $transporter,
            'timeout' => $total,
            'maxRetries' => 0,
        ]);
    }

    private function requestSeconds(): float
    {
        $configured = max(1, min(self::MAX_REQUEST_SECONDS, (int) config('services.anthropic.timeout') ?: self::MAX_REQUEST_SECONDS));

        return $this->timeBudget === null ? (float) $configured : max(1.0, min((float) $configured, $this->timeBudget));
    }

    private function model(): string
    {
        return trim((string) config('services.anthropic.model')) ?: 'claude-sonnet-5-5';
    }

    private function effort(): string
    {
        // between_tools thinking is only valid at effort high or below.
        $effort = strtolower(trim((string) config('services.anthropic.effort', 'low')));

        return in_array($effort, ['low', 'medium', 'high'], true) ? $effort : 'low';
    }

    private function chatEffort(): string
    {
        $effort = strtolower(trim((string) config('services.anthropic.chat_effort', 'medium')));

        return in_array($effort, ['low', 'medium', 'high', 'xhigh', 'max'], true) ? $effort : 'medium';
    }

    private function chatSeconds(): int
    {
        return max(5, min(300, (int) config('services.anthropic.chat_timeout', 60) ?: 60));
    }

    private function textOf(Message $message): string
    {
        $parts = [];

        foreach ($message->content as $block) {
            if (($block->type ?? null) === 'text' && is_string($block->text ?? null)) {
                $parts[] = $block->text;
            }
        }

        return implode("\n", $parts);
    }

    /**
     * The API's structured-output schema is a subset of JSON Schema: array sizes beyond "at least one"
     * and numeric or length bounds are not accepted. The original schema still gates the answer in PHP.
     */
    private function apiSchema(mixed $schema): mixed
    {
        if (! is_array($schema)) {
            return $schema;
        }

        if (array_is_list($schema)) {
            return array_map(fn ($item) => $this->apiSchema($item), $schema);
        }

        foreach (['maxItems', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'maxProperties', 'minProperties'] as $unsupported) {
            unset($schema[$unsupported]);
        }
        if (isset($schema['minItems']) && $schema['minItems'] > 1) {
            $schema['minItems'] = 1;
        }
        // "type": ["string", "null"] is written as anyOf, the form the API documents.
        if (isset($schema['type']) && is_array($schema['type'])) {
            $schema['anyOf'] = array_map(fn (string $type) => ['type' => $type], array_values($schema['type']));
            unset($schema['type']);
        }

        // Property names are data, not keywords, so only the schema under them is rewritten.
        foreach ($schema as $key => $value) {
            if ($key === 'properties' && is_array($value)) {
                $schema[$key] = array_map(fn ($property) => $this->apiSchema($property), $value);
            } elseif (is_array($value) && in_array($key, ['items', 'anyOf', 'oneOf', 'allOf', '$defs', 'definitions'], true)) {
                $schema[$key] = $key === '$defs' || $key === 'definitions'
                    ? array_map(fn ($definition) => $this->apiSchema($definition), $value)
                    : $this->apiSchema($value);
            }
        }

        return $schema;
    }

    /**
     * Check a decoded answer against the schema the caller asked for: required keys, types, enums and
     * array sizes. The API constrains the shape, but a refusal-shaped or truncated answer must not pass.
     */
    private function matchesSchema(mixed $value, array $schema): bool
    {
        if (isset($schema['enum']) && ! in_array($value, $schema['enum'], true)) {
            return false;
        }

        foreach (['anyOf', 'oneOf'] as $keyword) {
            if (isset($schema[$keyword])) {
                return collect($schema[$keyword])->contains(fn (array $option) => $this->matchesSchema($value, $option));
            }
        }

        if (isset($schema['type'])) {
            $types = (array) $schema['type'];
            if (! collect($types)->contains(fn (string $type) => $this->isType($value, $type))) {
                return false;
            }
        }

        if (is_array($value) && in_array('array', (array) ($schema['type'] ?? []), true)) {
            if (isset($schema['minItems']) && count($value) < $schema['minItems']) {
                return false;
            }
            if (isset($schema['maxItems']) && count($value) > $schema['maxItems']) {
                return false;
            }
            if (isset($schema['items']) && is_array($schema['items'])) {
                foreach ($value as $item) {
                    if (! $this->matchesSchema($item, $schema['items'])) {
                        return false;
                    }
                }
            }

            return true;
        }

        if (is_array($value)) {
            foreach ($schema['required'] ?? [] as $required) {
                if (! array_key_exists($required, $value)) {
                    return false;
                }
            }
            foreach ($schema['properties'] ?? [] as $name => $property) {
                if (array_key_exists($name, $value) && is_array($property) && ! $this->matchesSchema($value[$name], $property)) {
                    return false;
                }
            }
        }

        return true;
    }

    private function isType(mixed $value, string $type): bool
    {
        return match ($type) {
            'string' => is_string($value),
            'integer' => is_int($value),
            'number' => is_int($value) || is_float($value),
            'boolean' => is_bool($value),
            'null' => $value === null,
            'array' => is_array($value) && array_is_list($value),
            'object' => is_array($value) && ($value === [] || ! array_is_list($value)),
            default => true,
        };
    }
}
