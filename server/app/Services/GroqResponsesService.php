<?php

namespace App\Services;

use App\Contracts\TextGenerator;
use App\Services\Ai\Concerns\GuardsGeneratedText;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class GroqResponsesService implements TextGenerator
{
    use GuardsGeneratedText;

    // Every caller runs inside a web request, so one short attempt beats a long retry that stalls the page.
    private const MAX_REQUEST_SECONDS = 12;

    private ?float $timeBudget = null;

    private bool $unreachable = false;

    /** Seconds left in the fallback chain's shared deadline; null leaves only the configured timeout. */
    public function withTimeBudget(?float $seconds): void
    {
        $this->timeBudget = $seconds;
    }

    /**
     * True when the most recent call could not connect, or timed out while running with its full timeout, so the chain
     * can rest this provider briefly. A timeout under a shortened shared deadline says nothing about the provider.
     */
    public function lastCallUnreachable(): bool
    {
        return $this->unreachable;
    }

    /**
     * Generate text with Groq's OpenAI-compatible Responses API.
     *
     * @return array{text: string, model: string, response_id: ?string}|null
     */
    public function generate(
        string $instructions,
        string $input,
        int $maxOutputTokens = 400,
        float $temperature = 0.2,
    ): ?array {
        $payload = $this->request([
            'model' => (string) config('services.groq.model'),
            'instructions' => $instructions,
            'input' => $input,
            'reasoning' => ['effort' => $this->reasoningEffort()],
            'temperature' => $temperature,
            'max_output_tokens' => $maxOutputTokens,
        ]);

        if ($payload === null) {
            return null;
        }

        // A response cut off at the token cap carries partial text; treat it as a failure so the fallback chain moves on.
        if (data_get($payload, 'status') === 'incomplete') {
            Log::warning('Groq Responses API returned an incomplete response.', [
                'response_id' => data_get($payload, 'id'),
                'reason' => data_get($payload, 'incomplete_details.reason'),
            ]);

            return null;
        }

        $text = $this->extractOutputText($payload);

        if ($text === '') {
            Log::warning('Groq Responses API returned no output text.', [
                'response_id' => data_get($payload, 'id'),
            ]);

            return null;
        }

        return [
            'text' => $text,
            'model' => (string) (data_get($payload, 'model') ?: config('services.groq.model')),
            'response_id' => data_get($payload, 'id'),
        ];
    }

    /**
     * Multi-turn answer through the Responses API: the turns are the input array and the whole text arrives as one event.
     *
     * @return array{text: string, reasoning: ?string, model: string, response_id: ?string}|null
     */
    public function converse(string $instructions, array $messages, int $maxOutputTokens = 1400, ?callable $onEvent = null): ?array
    {
        if ($messages === []) {
            return null;
        }

        $payload = $this->request([
            'model' => (string) config('services.groq.model'),
            'instructions' => $instructions,
            'input' => array_map(fn (array $turn) => ['role' => $turn['role'], 'content' => $turn['content']], array_values($messages)),
            'reasoning' => ['effort' => $this->reasoningEffort()],
            'max_output_tokens' => $maxOutputTokens,
        ]);

        if ($payload === null || data_get($payload, 'status') === 'incomplete') {
            return null;
        }

        $text = $this->extractOutputText($payload);
        if ($text === '') {
            Log::warning('Groq Responses API returned no output text.', ['response_id' => data_get($payload, 'id')]);

            return null;
        }

        if ($onEvent !== null) {
            $onEvent('text', $text);
        }

        return [
            'text' => $text,
            'reasoning' => null,
            'model' => (string) (data_get($payload, 'model') ?: config('services.groq.model')),
            'response_id' => data_get($payload, 'id'),
        ];
    }

    /**
     * Generate a JSON object constrained by a Groq Responses API JSON schema.
     *
     * @return array{data: array, text: string, model: string, response_id: ?string}|null
     */
    public function generateStructured(
        string $instructions,
        array $input,
        string $schemaName,
        array $schema,
        int $maxOutputTokens = 1800,
        float $temperature = 0.2,
    ): ?array {
        $payload = $this->request([
            'model' => (string) config('services.groq.model'),
            'instructions' => $instructions,
            'input' => json_encode($input, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
            'reasoning' => ['effort' => $this->reasoningEffort()],
            'temperature' => $temperature,
            'max_output_tokens' => $maxOutputTokens,
            'text' => [
                'format' => [
                    'type' => 'json_schema',
                    'name' => $schemaName,
                    'strict' => true,
                    'schema' => $schema,
                ],
            ],
        ]);

        if ($payload === null) {
            return null;
        }

        if (data_get($payload, 'status') === 'incomplete') {
            Log::warning('Groq Responses API returned an incomplete structured response.', [
                'response_id' => data_get($payload, 'id'),
                'reason' => data_get($payload, 'incomplete_details.reason'),
            ]);

            return null;
        }

        $text = $this->extractOutputText($payload);
        $decoded = json_decode($text, true);

        if (! is_array($decoded) || array_is_list($decoded)) {
            Log::warning('Groq structured response did not contain a valid JSON object.', [
                'response_id' => data_get($payload, 'id'),
                'json_error' => json_last_error_msg(),
            ]);

            return null;
        }

        return [
            'data' => $decoded,
            'text' => $text,
            'model' => (string) (data_get($payload, 'model') ?: config('services.groq.model')),
            'response_id' => data_get($payload, 'id'),
        ];
    }

    private function configuredSeconds(): int
    {
        return max(1, min(self::MAX_REQUEST_SECONDS, (int) config('services.groq.timeout') ?: self::MAX_REQUEST_SECONDS));
    }

    private function requestSeconds(): int|float
    {
        $configured = $this->configuredSeconds();

        return $this->timeBudget === null ? $configured : max(1.0, min((float) $configured, $this->timeBudget));
    }

    private function request(array $body): ?array
    {
        $this->unreachable = false;
        $apiKey = trim((string) config('services.groq.key'));

        if ($apiKey === '') {
            return null;
        }

        $seconds = $this->requestSeconds();
        $budgeted = $this->timeBudget !== null && $this->timeBudget < $this->configuredSeconds();

        try {
            $response = Http::acceptJson()
                ->withToken($apiKey)
                ->connectTimeout(min($seconds, max(1, (int) config('services.groq.connect_timeout', 5))))
                ->timeout($seconds)
                ->post((string) config('services.groq.url'), $body);

            if (! $response->successful()) {
                Log::warning('Groq Responses API request failed.', [
                    'status' => $response->status(),
                    'request_id' => $response->header('x-request-id'),
                ]);

                return null;
            }

            $payload = $response->json();

            return is_array($payload) ? $payload : null;
        } catch (\Throwable $exception) {
            $timedOut = str_contains($exception->getMessage(), 'cURL error 28');
            $this->unreachable = $exception instanceof ConnectionException && (! $timedOut || ! $budgeted);

            Log::warning('Groq Responses API is unavailable.', [
                'exception' => $exception::class,
                'message' => $exception->getMessage(),
            ]);

            return null;
        }
    }

    private function reasoningEffort(): string
    {
        $effort = strtolower(trim((string) config('services.groq.reasoning_effort', 'low')));

        return in_array($effort, ['low', 'medium', 'high'], true) ? $effort : 'low';
    }

    private function extractOutputText(array $payload): string
    {
        $topLevel = trim((string) ($payload['output_text'] ?? ''));

        if ($topLevel !== '') {
            return $topLevel;
        }

        $parts = [];

        foreach (($payload['output'] ?? []) as $output) {
            foreach (($output['content'] ?? []) as $content) {
                if (($content['type'] ?? null) === 'output_text' && is_string($content['text'] ?? null)) {
                    $parts[] = trim($content['text']);
                }
            }
        }

        return trim(implode("\n", array_filter($parts)));
    }
}
