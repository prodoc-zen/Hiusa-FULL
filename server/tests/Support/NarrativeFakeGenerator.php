<?php

namespace Tests\Support;

use App\Contracts\TextGenerator;
use App\Services\Ai\Concerns\GuardsGeneratedText;

/**
 * A scripted model for the narrative and handover tests: answers generateStructured() with $structured and generate()
 * with $text (null for either means the provider said nothing) and records what it was sent.
 */
class NarrativeFakeGenerator implements TextGenerator
{
    use GuardsGeneratedText;

    /** @var list<array{operation: string, instructions: string, input: string}> */
    public array $calls = [];

    public function __construct(
        public ?array $structured = null,
        public ?string $text = null,
        public string $model = 'claude-test',
    ) {}

    public function generate(string $instructions, string $input, int $maxOutputTokens = 400, float $temperature = 0.2): ?array
    {
        $this->calls[] = ['operation' => 'generate', 'instructions' => $instructions, 'input' => $input];

        return $this->text === null ? null : ['text' => $this->text, 'model' => $this->model, 'response_id' => null];
    }

    public function generateStructured(string $instructions, array $input, string $schemaName, array $schema, int $maxOutputTokens = 1800, float $temperature = 0.2): ?array
    {
        $this->calls[] = ['operation' => 'generateStructured', 'instructions' => $instructions, 'input' => (string) json_encode($input, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)];

        return $this->structured === null ? null : ['data' => $this->structured, 'text' => (string) json_encode($this->structured), 'model' => $this->model, 'response_id' => null];
    }

    public function converse(string $instructions, array $messages, int $maxOutputTokens = 1400, ?callable $onEvent = null): ?array
    {
        return null;
    }

    /** Everything the model was shown, in one string. */
    public function sent(): string
    {
        return implode("\n", array_column($this->calls, 'input'));
    }
}
