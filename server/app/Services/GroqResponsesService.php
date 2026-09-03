<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class GroqResponsesService
{
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
            'temperature' => $temperature,
            'max_output_tokens' => $maxOutputTokens,
        ]);

        if ($payload === null) {
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

    private function request(array $body): ?array
    {
        $apiKey = trim((string) config('services.groq.key'));

        if ($apiKey === '') {
            return null;
        }

        try {
            $response = Http::acceptJson()
                ->withToken($apiKey)
                ->connectTimeout(max(1, (int) config('services.groq.connect_timeout', 5)))
                ->timeout(max(1, (int) config('services.groq.timeout') ?: 25))
                ->retry(2, 250, throw: false)
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
            Log::warning('Groq Responses API is unavailable.', [
                'exception' => $exception::class,
                'message' => $exception->getMessage(),
            ]);

            return null;
        }
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
