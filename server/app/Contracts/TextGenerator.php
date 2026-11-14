<?php

namespace App\Contracts;

/**
 * Writes display copy from facts the server already computed. Every method answers null instead of
 * throwing, so a caller can always fall back to its own deterministic text.
 */
interface TextGenerator
{
    /**
     * $temperature is honoured by providers that accept it and ignored by those that do not.
     *
     * @return array{text: string, model: string, response_id: ?string}|null
     */
    public function generate(string $instructions, string $input, int $maxOutputTokens = 400, float $temperature = 0.2): ?array;

    /**
     * The decoded object is only as trustworthy as the schema: callers still validate what they use.
     *
     * @return array{data: array, text: string, model: string, response_id: ?string}|null
     */
    public function generateStructured(string $instructions, array $input, string $schemaName, array $schema, int $maxOutputTokens = 1800, float $temperature = 0.2): ?array;

    /**
     * A multi-turn answer. $messages is oldest first and ends with the user's turn.
     * $onEvent, when given, receives ('reasoning', string $delta), ('text', string $delta) and ('reset', '') when
     * everything streamed so far must be thrown away because another provider is about to answer.
     *
     * @param  array<int, array{role: 'user'|'assistant', content: string}>  $messages
     * @return array{text: string, reasoning: ?string, model: string, response_id: ?string}|null
     */
    public function converse(string $instructions, array $messages, int $maxOutputTokens = 1400, ?callable $onEvent = null): ?array;

    /**
     * True when $text introduces no number that is absent from $facts.
     */
    public function preservesNumericFacts(string $text, array $facts): bool;

    /**
     * Strip Markdown from model-authored copy that is rendered as prose.
     */
    public function plainText(string $text): string;
}
