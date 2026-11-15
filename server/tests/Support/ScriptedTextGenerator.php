<?php

namespace Tests\Support;

use App\Contracts\TextGenerator;
use App\Services\Ai\Concerns\GuardsGeneratedText;

/** A scripted model for the single-text features: answers with the given text (or nothing) and records every generate() call. */
class ScriptedTextGenerator implements TextGenerator
{
    use GuardsGeneratedText;

    /** @var array<int, array{instructions: string, input: string}> */
    public array $calls = [];

    public function __construct(public ?string $answer = null, public string $model = 'claude-test') {}

    public function generate(string $instructions, string $input, int $maxOutputTokens = 400, float $temperature = 0.2): ?array
    {
        $this->calls[] = ['instructions' => $instructions, 'input' => $input];

        return $this->answer === null ? null : ['text' => $this->answer, 'model' => $this->model, 'response_id' => null];
    }

    public function generateStructured(string $instructions, array $input, string $schemaName, array $schema, int $maxOutputTokens = 1800, float $temperature = 0.2): ?array
    {
        return null;
    }

    public function converse(string $instructions, array $messages, int $maxOutputTokens = 1400, ?callable $onEvent = null): ?array
    {
        return null;
    }

    /** Everything the model was shown across all calls, to assert on what was and was not sent. */
    public function sent(): string
    {
        return implode("\n", array_map(fn (array $call) => $call['instructions']."\n".$call['input'], $this->calls));
    }
}
