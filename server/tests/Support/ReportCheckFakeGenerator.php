<?php

namespace Tests\Support;

use App\Contracts\TextGenerator;
use App\Services\Ai\Concerns\GuardsGeneratedText;

/** A scripted model for the report check tests: answers generateStructured from a callback and records what it was given. */
class ReportCheckFakeGenerator implements TextGenerator
{
    use GuardsGeneratedText;

    /** @var list<array{instructions: string, input: array}> */
    public array $calls = [];

    /** @param  null|callable(array): ?array  $answer  gets the facts and returns the decoded object, or null for no answer */
    public function __construct(private $answer = null, private string $model = 'claude-test') {}

    public function generate(string $instructions, string $input, int $maxOutputTokens = 400, float $temperature = 0.2): ?array
    {
        return null;
    }

    public function generateStructured(string $instructions, array $input, string $schemaName, array $schema, int $maxOutputTokens = 1800, float $temperature = 0.2): ?array
    {
        $this->calls[] = ['instructions' => $instructions, 'input' => $input];
        $data = $this->answer === null ? null : ($this->answer)($input);

        return $data === null ? null : ['data' => $data, 'text' => json_encode($data), 'model' => $this->model, 'response_id' => null];
    }

    public function converse(string $instructions, array $messages, int $maxOutputTokens = 1400, ?callable $onEvent = null): ?array
    {
        return null;
    }
}
