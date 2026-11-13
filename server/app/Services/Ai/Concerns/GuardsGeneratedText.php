<?php

namespace App\Services\Ai\Concerns;

use Illuminate\Support\Facades\Log;

/**
 * Provider-independent checks on model-authored copy, shared by every TextGenerator.
 */
trait GuardsGeneratedText
{
    /**
     * Reject explanatory copy that introduces numeric claims absent from the
     * structured facts supplied by HIUSA. Calculations remain server-owned;
     * the model is only allowed to verbalize existing values.
     */
    public function preservesNumericFacts(string $text, array $facts): bool
    {
        $allowed = $this->numericValues($facts);
        preg_match_all('/(?<![\pL\pN])-?\d[\d,]*(?:\.\d+)?%?/u', $text, $matches);

        foreach ($matches[0] ?? [] as $token) {
            $isPercentage = str_ends_with($token, '%');
            $value = (float) str_replace([',', '%'], '', $token);
            $candidates = $isPercentage ? [$value, $value / 100] : [$value];
            if (! collect($allowed)->contains(fn (float $allowedValue) => collect($candidates)->contains(fn (float $candidate) => abs($allowedValue - $candidate) < 0.005))) {
                Log::warning('AI explanation introduced a numeric value not present in its facts.', [
                    'unexpected_value' => $value,
                ]);

                return false;
            }
        }

        return true;
    }

    /**
     * Convert model-authored display copy to plain text before it is persisted.
     * Announcement and report fields are rendered as prose, not Markdown.
     */
    public function plainText(string $text): string
    {
        $text = str_replace(["\r\n", "\r"], "\n", $text);
        $lines = preg_split('/\n/u', $text) ?: [];

        $lines = array_map(function (string $line): string {
            $line = preg_replace('/^\s{0,3}#{1,6}\s*/u', '', $line) ?? $line;
            $line = preg_replace('/^\s*[*+]\s+/u', '- ', $line) ?? $line;

            return rtrim(str_replace(['*', '`'], '', $line));
        }, $lines);

        return trim(preg_replace('/\n{3,}/u', "\n\n", implode("\n", $lines)) ?? implode("\n", $lines));
    }

    private function numericValues(mixed $value): array
    {
        if (is_array($value)) {
            $numbers = [];
            foreach ($value as $item) {
                array_push($numbers, ...$this->numericValues($item));
            }

            return array_values(array_unique($numbers));
        }
        if (is_int($value) || is_float($value)) {
            return [(float) $value];
        }
        if (! is_string($value)) {
            return [];
        }

        preg_match_all('/(?<![\pL\pN])-?\d[\d,]*(?:\.\d+)?/u', $value, $matches);

        return array_map(fn (string $token) => (float) str_replace(',', '', $token), $matches[0] ?? []);
    }
}
