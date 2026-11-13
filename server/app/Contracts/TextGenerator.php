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
     * True when $text introduces no number that is absent from $facts.
     */
    public function preservesNumericFacts(string $text, array $facts): bool;

    /**
     * Strip Markdown from model-authored copy that is rendered as prose.
     */
    public function plainText(string $text): string;
}
