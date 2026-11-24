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
use Anthropic\Beta\Messages\BetaOutputConfig;
use Anthropic\Beta\Messages\BetaRawContentBlockDeltaEvent;
use Anthropic\Beta\Messages\BetaRawMessageDeltaEvent;
use Anthropic\Beta\Messages\BetaRawMessageStartEvent;
use Anthropic\Beta\Messages\BetaTextDelta;
use Anthropic\Beta\Messages\BetaThinkingDelta;
use Anthropic\Messages\JSONOutputFormat;
use Anthropic\Messages\Message;
use Anthropic\Messages\OutputConfig;
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

    // Every caller runs inside a web request, so one attempt beats a long retry that stalls the page. A one-shot call
    // thinks before it answers, so its cap is longer than Groq's 12 seconds: 25 by default, 30 at most.
    private const MAX_REQUEST_SECONDS = 30;

    private const DEFAULT_REQUEST_SECONDS = 25;

    // The budgets callers pass were sized for another model; Claude spends more tokens per word.
    private const TOKEN_HEADROOM = 1.5;

    // Adaptive thinking draws on max_tokens before the answer starts, even when its text is not returned, so a limit
    // sized for the JSON alone would cut the JSON off. Medium effort on a one-shot call thinks for a few thousand tokens
    // at most; a conversation thinks longer at high effort. The request timeout, not these numbers, bounds the wait.
    private const ONE_SHOT_THINKING_HEADROOM = 4096;

    private const CHAT_THINKING_HEADROOM = 6144;

    // Server-side refusal fallback: a request the safety classifiers decline is re-run by the API on its default
    // substitute model instead of ending as a refusal. Beta, and only on the beta messages endpoint.
    private const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

    private ?string $lastStopReason = null;

    private ?float $timeBudget = null;

    private ?float $timeoutCeiling = null;

    private bool $unreachable = false;

    // True while the call ran under a shared deadline shorter than its own timeout.
    private bool $budgeted = false;

    // Longest a streaming connection may sit silent. Anthropic sends pings, so a healthy stream is never idle this long.
    private const STREAM_IDLE_SECONDS = 15;

    // A silent stream tells the caller so this often, with an event of type 'tick' and an empty delta.
    private const TICK_SECONDS = 4;

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

    /**
     * Seconds left in the fallback chain's shared deadline; null leaves only the configured timeout. $ceiling, set only
     * for a deadline longer than the usual cap, replaces the configured timeout as the longest one attempt may run.
     */
    public function withTimeBudget(?float $seconds, ?float $ceiling = null): void
    {
        $this->timeBudget = $seconds;
        $this->timeoutCeiling = $seconds === null ? null : $ceiling;
    }

    /**
     * True when the most recent call could not connect, or timed out while running with its full timeout, so the chain
     * can rest this provider briefly. A timeout under a shortened shared deadline says nothing about the provider.
     */
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
        return $this->structured($instructions, $input, $schemaName, $schema, $maxOutputTokens, null);
    }

    /**
     * generateStructured with a file the model reads first, as an image or document block ahead of the input.
     *
     * @param  array{mime: string, data: string}  $file  data is base64
     */
    public function generateStructuredFromFile(
        string $instructions,
        array $input,
        string $schemaName,
        array $schema,
        array $file,
        int $maxOutputTokens = 1800,
    ): ?array {
        return $this->structured($instructions, $input, $schemaName, $schema, $maxOutputTokens, $file);
    }

    /** @param  null|array{mime: string, data: string}  $file */
    private function structured(string $instructions, array $input, string $schemaName, array $schema, int $maxOutputTokens, ?array $file): ?array
    {
        $message = $this->request(
            $instructions,
            (string) json_encode($input, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
            $maxOutputTokens,
            OutputConfig::with(
                effort: $this->effort(),
                format: JSONOutputFormat::with(schema: $this->apiSchema($schema)),
            ),
            $file,
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
     * Streams a conversation turn on the chat model with summarized adaptive thinking. Thinking spends output tokens
     * before the first word, so the cap carries extra room for it. The turn opts into the server-side refusal fallback.
     * An exception thrown by $onEvent (the caller aborting) is rethrown untouched.
     */
    public function converse(string $instructions, array $messages, int $maxOutputTokens = 1400, ?callable $onEvent = null): ?array
    {
        return $this->stream($instructions, $messages, $maxOutputTokens, $onEvent, null);
    }

    /**
     * converse with a file sent on the last turn as an image or document block. No other provider can read one.
     *
     * @param  array{mime: string, data: string}  $file  data is base64
     */
    public function converseWithFile(string $instructions, array $messages, array $file, int $maxOutputTokens = 1400, ?callable $onEvent = null): ?array
    {
        return $this->stream($instructions, $messages, $maxOutputTokens, $onEvent, $file);
    }

    /** @param  null|array{mime: string, data: string}  $file */
    private function stream(string $instructions, array $messages, int $maxOutputTokens, ?callable $onEvent, ?array $file): ?array
    {
        $this->lastStopReason = null;
        $this->unreachable = false;
        $apiKey = trim((string) config('services.anthropic.key'));

        if ($apiKey === '' || $messages === []) {
            return null;
        }

        $started = microtime(true);
        $seconds = $this->chatSeconds();
        if ($this->timeBudget !== null) {
            $seconds = max(1, min($seconds, (int) ceil($this->timeBudget)));
        }
        $this->budgeted = $seconds < $this->chatSeconds();
        $text = '';
        $reasoning = '';
        $model = $this->chatModel();
        $responseId = null;
        $stopReason = null;
        $callbackError = null;

        $lastEmit = $started;
        $emit = function (string $type, string $delta) use ($onEvent, &$callbackError, &$lastEmit): void {
            if ($onEvent === null) {
                return;
            }
            $lastEmit = microtime(true);
            try {
                $onEvent($type, $delta);
            } catch (\Throwable $exception) {
                $callbackError = $exception;

                throw $exception;
            }
        };

        try {
            $stream = $this->client($apiKey, $seconds, $started + $seconds, function () use ($emit, &$lastEmit): void {
                if (microtime(true) - $lastEmit >= self::TICK_SECONDS) {
                    $emit('tick', '');
                }
            })->beta->messages->createStream(
                maxTokens: (int) ceil($maxOutputTokens * self::TOKEN_HEADROOM) + self::CHAT_THINKING_HEADROOM,
                messages: $this->turns($messages, $file),
                model: $this->chatModel(),
                betas: [self::FALLBACK_BETA],
                fallbacks: 'default',
                outputConfig: BetaOutputConfig::with(effort: $this->chatEffort()),
                system: [['type' => 'text', 'text' => $instructions, 'cacheControl' => ['type' => 'ephemeral']]],
                thinking: ['type' => 'adaptive', 'display' => 'summarized'],
            );

            foreach ($stream as $event) {
                if ($event instanceof BetaRawMessageStartEvent) {
                    // After a fallback this names the substitute model that is answering.
                    $model = $event->message->model;
                    $responseId = $event->message->id;
                } elseif ($event instanceof BetaRawContentBlockDeltaEvent) {
                    if ($event->delta instanceof BetaThinkingDelta && $event->delta->thinking !== '') {
                        $reasoning .= $event->delta->thinking;
                        $emit('reasoning', $event->delta->thinking);
                    } elseif ($event->delta instanceof BetaTextDelta && $event->delta->text !== '') {
                        $text .= $event->delta->text;
                        $emit('text', $event->delta->text);
                    }
                } elseif ($event instanceof BetaRawMessageDeltaEvent) {
                    $stopReason = $event->delta->stopReason ?? $stopReason;
                }
            }
        } catch (\Throwable $exception) {
            if ($callbackError !== null) {
                throw $callbackError;
            }

            return $this->failed($exception, $started, $exception instanceof \RuntimeException);
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

    /**
     * The turns as the API wants them. The file rides on the last turn only, ahead of its text, because the file is
     * what that turn is about.
     *
     * @param  null|array{mime: string, data: string}  $file
     */
    private function turns(array $messages, ?array $file): array
    {
        $turns = array_map(fn (array $turn) => ['role' => $turn['role'], 'content' => $turn['content']], array_values($messages));
        if ($file !== null && $turns !== []) {
            $last = array_key_last($turns);
            $turns[$last]['content'] = $this->withFile($turns[$last]['content'], $file);
        }

        return $turns;
    }

    /** @param  array{mime: string, data: string}  $file */
    private function withFile(string $text, array $file): array
    {
        $source = ['type' => 'base64', 'mediaType' => $file['mime'], 'data' => $file['data']];

        return [
            ['type' => $file['mime'] === 'application/pdf' ? 'document' : 'image', 'source' => $source],
            ['type' => 'text', 'text' => $text],
        ];
    }

    /** @param  null|array{mime: string, data: string}  $file */
    private function request(string $instructions, string $input, int $maxOutputTokens, OutputConfig $outputConfig, ?array $file = null): ?Message
    {
        $this->lastStopReason = null;
        $this->unreachable = false;
        $apiKey = trim((string) config('services.anthropic.key'));

        if ($apiKey === '') {
            return null;
        }

        $started = microtime(true);
        // Any shared deadline counts: the chain's share of 25 seconds equals Claude's own cap, but a slow answer under it
        // still says nothing about whether Claude is down, and resting Claude would send every caller to Groq.
        $this->budgeted = $this->timeBudget !== null;
        $maxTokens = max(64, (int) ceil($maxOutputTokens * self::TOKEN_HEADROOM)) + self::ONE_SHOT_THINKING_HEADROOM;

        try {
            $message = $this->client($apiKey)->messages->create(
                maxTokens: $maxTokens,
                messages: $this->turns([['role' => 'user', 'content' => $input]], $file),
                model: $this->model(),
                outputConfig: $outputConfig,
                system: $instructions,
                // Opus 5.5 thinks on every call and rejects thinking disabled and a thinking budget, so effort sets how
                // much. It also rejects temperature, top_p, top_k and a forced tool choice: none of them are ever sent.
                thinking: ['type' => 'adaptive'],
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

        // A refusal or a cut-off answer must not be shown as if it were finished copy; the caller falls back.
        if ($message->stopReason !== 'end_turn') {
            $context = [
                'stop_reason' => $message->stopReason,
                'model' => $message->model,
                'response_id' => $message->id,
                'latency_ms' => $latencyMs,
            ];
            if ($message->stopReason === 'max_tokens') {
                // Thinking and the answer share max_tokens; seeing this means the headroom is too small for the prompt.
                Log::warning('Claude ran out of output tokens before finishing.', $context + [
                    'max_tokens' => $maxTokens,
                    'output_tokens' => $message->usage->outputTokens ?? null,
                ]);
            } elseif ($message->stopReason === 'refusal') {
                Log::warning('Claude refused the request.', $context);
            } else {
                Log::warning('Claude did not finish an answer.', $context);
            }

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

    /** $stalled: the stream went silent or ran past its deadline, which is a timeout for this purpose. */
    private function failed(\Throwable $exception, float $started, bool $stalled = false): null
    {
        $timedOut = $stalled || $this->timedOut($exception);
        $this->unreachable = $timedOut ? ! $this->budgeted : $exception instanceof APIConnectionException;

        Log::warning('Claude is unavailable.', [
            'exception' => $exception::class,
            'status' => $exception instanceof APIException ? $exception->status : null,
            'request_id' => $exception instanceof APIException ? $exception->getRequestID() : null,
            'latency_ms' => (int) round((microtime(true) - $started) * 1000),
        ]);

        return null;
    }

    private function timedOut(\Throwable $exception): bool
    {
        for ($current = $exception; $current !== null; $current = $current->getPrevious()) {
            if ($current instanceof APITimeoutException || str_contains($current->getMessage(), 'cURL error 28')) {
                return true;
            }
        }

        return false;
    }

    private function client(string $apiKey, ?int $seconds = null, ?float $deadline = null, ?\Closure $beforeRead = null): Client
    {
        $total = (float) ($seconds ?? $this->requestSeconds());
        $connect = min($total, (float) max(1, (int) config('services.anthropic.connect_timeout', 3)));
        // Streaming goes through PHP's stream handler: its timeout is per read (and covers connecting), and
        // connect_timeout is ignored there. A one-shot call is bounded by $total; a stream by the loop's deadline.
        $idle = $seconds === null ? $total : min((float) self::STREAM_IDLE_SECONDS, $total);
        $transporter = $this->transporter ?? new GuzzleClient([
            'timeout' => $idle,
            'read_timeout' => $idle,
            'connect_timeout' => $connect,
        ]);

        // maxRetries 0: Groq is the retry, and a second Claude attempt would push the page past its cap.
        return new Client(apiKey: $apiKey, requestOptions: array_filter([
            'transporter' => $transporter,
            'streamingTransporter' => $deadline === null ? null : new DeadlineTransporter($transporter, $deadline, $beforeRead),
            'timeout' => $total,
            'maxRetries' => 0,
        ], fn ($option) => $option !== null));
    }

    private function configuredSeconds(): float
    {
        return (float) max(1, min(self::MAX_REQUEST_SECONDS, (int) config('services.anthropic.timeout') ?: self::DEFAULT_REQUEST_SECONDS));
    }

    private function longestSeconds(): float
    {
        return $this->timeoutCeiling ?? $this->configuredSeconds();
    }

    private function requestSeconds(): float
    {
        $configured = $this->longestSeconds();

        return $this->timeBudget === null ? $configured : max(1.0, min($configured, $this->timeBudget));
    }

    private function model(): string
    {
        return trim((string) config('services.anthropic.model')) ?: 'claude-opus-5-5';
    }

    private function chatModel(): string
    {
        return trim((string) config('services.anthropic.chat_model')) ?: 'claude-opus-5-5';
    }

    private function effort(): string
    {
        // A one-shot call waits on a page, so xhigh and max are not offered: they think for minutes.
        $effort = strtolower(trim((string) config('services.anthropic.effort', 'medium')));

        return in_array($effort, ['low', 'medium', 'high'], true) ? $effort : 'medium';
    }

    private function chatEffort(): string
    {
        $effort = strtolower(trim((string) config('services.anthropic.chat_effort', 'high')));

        return in_array($effort, ['low', 'medium', 'high', 'xhigh', 'max'], true) ? $effort : 'high';
    }

    private function chatSeconds(): int
    {
        return max(1, min(300, (int) config('services.anthropic.chat_timeout', 60) ?: 60));
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
