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
        $apiKey = trim((string) config('services.groq.key'));

        if ($apiKey === '') {
            return null;
        }

        try {
            $response = Http::acceptJson()
                ->withToken($apiKey)
                // (int) '' is 0 when GROQ_TIMEOUT is left blank, and Guzzle treats a
                // timeout of 0 as "wait indefinitely" - the one thing a synchronous
                // third-party call in the request cycle must never do.
                ->timeout(max(1, (int) config('services.groq.timeout') ?: 25))
                ->post((string) config('services.groq.url'), [
                    'model' => (string) config('services.groq.model'),
                    'instructions' => $instructions,
                    'input' => $input,
                    'temperature' => $temperature,
                    'max_output_tokens' => $maxOutputTokens,
                ]);

            if (! $response->successful()) {
                Log::warning('Groq Responses API request failed.', [
                    'status' => $response->status(),
                    'request_id' => $response->header('x-request-id'),
                ]);

                return null;
            }

            $payload = $response->json();
            $text = $this->extractOutputText(is_array($payload) ? $payload : []);

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
