<?php

namespace App\Services\Ai\Evaluation;

use App\Contracts\TextGenerator;
use App\Services\Ai\ClaudeMessagesService;
use App\Services\Ai\Concerns\GuardsGeneratedText;

/**
 * Wraps the Claude service for the live evaluation and keeps what each call was given and what came back.
 * There is deliberately no fallback behind it: an evaluation must show what Claude itself did.
 */
class RecordingTextGenerator implements TextGenerator
{
    use GuardsGeneratedText;

    /** @var list<array<string, mixed>> */
    public array $calls = [];

    public function __construct(private readonly ClaudeMessagesService $claude) {}

    public function generate(string $instructions, string $input, int $maxOutputTokens = 400, float $temperature = 0.2): ?array
    {
        $started = microtime(true);
        $result = $this->claude->generate($instructions, $input, $maxOutputTokens, $temperature);

        $this->calls[] = $this->record('generate', $instructions, $input, $maxOutputTokens, $result, $started, $result['text'] ?? null);

        return $result;
    }

    public function generateStructured(string $instructions, array $input, string $schemaName, array $schema, int $maxOutputTokens = 1800, float $temperature = 0.2): ?array
    {
        $started = microtime(true);
        $result = $this->claude->generateStructured($instructions, $input, $schemaName, $schema, $maxOutputTokens, $temperature);
        $encoded = (string) json_encode($input, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

        $this->calls[] = $this->record('generateStructured', $instructions, $encoded, $maxOutputTokens, $result, $started, $result['text'] ?? null) + ['schema_name' => $schemaName];

        return $result;
    }

    public function converse(string $instructions, array $messages, int $maxOutputTokens = 1400, ?callable $onEvent = null): ?array
    {
        $started = microtime(true);
        $result = $this->claude->converse($instructions, $messages, $maxOutputTokens, $onEvent);
        $encoded = (string) json_encode($messages, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

        $this->calls[] = $this->record('converse', $instructions, $encoded, $maxOutputTokens, $result, $started, $result['text'] ?? null)
            + ['reasoning' => $result['reasoning'] ?? null];

        return $result;
    }

    /** @return array<string, mixed> */
    private function record(string $operation, string $instructions, string $input, int $maxOutputTokens, ?array $result, float $started, ?string $output): array
    {
        return [
            'operation' => $operation,
            'served_by_claude' => $result !== null,
            'model' => $result['model'] ?? null,
            'stop_reason' => $this->claude->lastStopReason(),
            'latency_ms' => (int) round((microtime(true) - $started) * 1000),
            'max_output_tokens' => $maxOutputTokens,
            'instructions' => $instructions,
            'input' => $input,
            'output' => $output,
            'output_characters' => $output === null ? 0 : mb_strlen($output),
        ];
    }
}
