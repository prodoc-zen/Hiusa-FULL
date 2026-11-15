<?php

namespace App\Services\Ai\Evaluation;

use App\Contracts\TextGenerator;
use App\Services\Ai\Concerns\GuardsGeneratedText;

/**
 * Stands in for both providers when the evaluation runs with --engine=template: every call answers nothing, so
 * each feature takes its own deterministic PHP text. It lets the harness run with no API key.
 */
class TemplateOnlyTextGenerator implements TextGenerator
{
    use GuardsGeneratedText;

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
        return null;
    }
}
