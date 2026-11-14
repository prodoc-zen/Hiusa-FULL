<?php

namespace Tests\Support;

use App\Contracts\TextGenerator;
use App\Services\Ai\Concerns\GuardsGeneratedText;

/** A scripted model for the chat tests: streams the given chunks and records every converse() call. */
class AskAiChatFakeGenerator implements TextGenerator
{
    use GuardsGeneratedText;

    /** @var array<int, array{instructions: string, messages: array}> */
    public array $calls = [];

    /** @var null|callable(int): void */
    public $afterChunk = null;

    /** @param  array<int, string>  $chunks */
    public function __construct(
        public array $chunks = [],
        public ?string $reasoning = null,
        public ?string $model = 'claude-test',
        public bool $fails = false,
        public bool $silentReasoning = false,
    ) {}

    public function generate(string $instructions, string $input, int $maxOutputTokens = 400, float $temperature = 0.2): ?array
    {
        return null;
    }

    public function generateStructured(string $instructions, array $input, string $schemaName, array $schema, int $maxOutputTokens = 1800, float $temperature = 0.2): ?array
    {
        return null;
    }

    public function converse(string $instructions, array $messages, int $maxOutputTokens = 1400, ?callable $onEvent = null): ?array
    {
        $this->calls[] = ['instructions' => $instructions, 'messages' => $messages];

        if ($this->fails) {
            return null;
        }

        if ($this->reasoning !== null && $onEvent !== null && ! $this->silentReasoning) {
            $onEvent('reasoning', $this->reasoning);
        }

        foreach ($this->chunks as $index => $chunk) {
            if ($onEvent !== null) {
                $onEvent('text', $chunk);
            }
            if ($this->afterChunk !== null) {
                ($this->afterChunk)($index);
            }
        }

        return ['text' => implode('', $this->chunks), 'reasoning' => $this->reasoning, 'model' => (string) $this->model, 'response_id' => null];
    }

    public function lastUserTurn(): string
    {
        $messages = $this->calls[array_key_last($this->calls)]['messages'];

        return $messages[array_key_last($messages)]['content'];
    }
}
