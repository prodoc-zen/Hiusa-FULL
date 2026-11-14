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
        preg_match_all('/(?<![\pL\pN])-?\d[\d,]*(?:\.\d+)?%?/u', $this->withoutMarkdownSyntax($text), $matches);

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

    /**
     * Markdown syntax is not a claim: list numbering, heading hashes, table pipes and link targets are removed
     * before numbers are looked for. Link labels, table cells and HTML attribute values stay and are checked.
     */
    private function withoutMarkdownSyntax(string $text): string
    {
        $text = str_replace(["\r\n", "\r"], "\n", $text);
        // [label](target "title") and ![alt](target): keep the label, drop the target and title.
        $text = preg_replace('/\]\(\s*(?:<[^>\n]*>|(?:[^()\s]|\([^)\n]*\))*)(?:\s+(?:"[^"\n]*"|\'[^\'\n]*\'))?\s*\)/u', ']', $text) ?? $text;
        // [label][ref] reference-style links.
        $text = preg_replace('/\]\[[^\]\n]*\]/u', ']', $text) ?? $text;
        // [label]: target reference definitions.
        $text = preg_replace('/^[ \t]{0,3}\[[^\]\n]+\]:[ \t]*\S.*$/mu', '', $text) ?? $text;
        // Ordered-list markers, with any blockquote prefix: "1. ", "2) ".
        $text = preg_replace('/^[ \t>]*\d{1,3}[.)](?=[ \t])/mu', '', $text) ?? $text;
        $text = preg_replace('/^[ \t>]*#{1,6}(?=[ \t]|$)/mu', '', $text) ?? $text;

        return str_replace('|', ' ', $text);
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
