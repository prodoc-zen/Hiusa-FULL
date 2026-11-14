<?php

namespace App\Services\Ai\Concerns;

use Illuminate\Support\Facades\Log;

/**
 * Provider-independent checks on model-authored copy, shared by every TextGenerator.
 */
trait GuardsGeneratedText
{
    // A comma is a thousands separator only when exactly three digits follow it, so "1,2" is two numbers.
    // Digits glued to a letter ("PHP9999") count; codes such as Q4 pass only when the facts carry them.
    private const NUMBER_TOKEN = '/(?<![\pN.,])(?:-?\d{1,3}(?:,\d{3})+(?:\.\d+)?%?|-?\d+(?:\.\d+)?%?)/u';

    /**
     * Reject explanatory copy that introduces numeric claims absent from the
     * structured facts supplied by HIUSA. Calculations remain server-owned;
     * the model is only allowed to verbalize existing values.
     */
    public function preservesNumericFacts(string $text, array $facts): bool
    {
        $allowed = $this->numericValues($facts);
        $codes = $this->letterDigitCodes($facts);
        $checked = preg_replace_callback(
            '/(?<![\pL\pN])\pL+\d+(?![\pL\pN])/u',
            fn (array $match) => in_array(mb_strtolower($match[0]), $codes, true) ? ' ' : $match[0],
            $this->withoutMarkdownSyntax($text)
        ) ?? $text;
        preg_match_all(self::NUMBER_TOKEN, $checked, $matches);

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
        // [label]: target "title" reference definitions; any other line that starts that way is visible prose.
        $text = preg_replace('/^[ \t]{0,3}\[[^\]\n]+\]:[ \t]*(?:<[^>\n]*>|\S+)(?:[ \t]+(?:"[^"\n]*"|\'[^\'\n]*\'|\([^)\n]*\)))?[ \t]*$/mu', '', $text) ?? $text;
        // Ordered-list markers, with any blockquote prefix: "1. ", "2) ". A big number here is a figure, not list numbering.
        $text = preg_replace_callback('/^([ \t>]*)(\d{1,2})[.)](?=[ \t])/mu', fn (array $match) => (int) $match[2] <= 20 ? $match[1] : $match[0], $text) ?? $text;
        // The prompt's progress bar is out of 100, which is a scale and not a claim.
        $text = preg_replace('/(<progress\b[^>]*?)\s+max="100"/iu', '$1', $text) ?? $text;
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

        preg_match_all('/(?<![\pL\pN])(?:-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?)/u', $value, $matches);

        return array_map(fn (string $token) => (float) str_replace(',', '', $token), $matches[0] ?? []);
    }

    /** Letter-plus-digit tokens (Q4, H1) the facts themselves contain, lowercased. */
    private function letterDigitCodes(mixed $value): array
    {
        if (is_array($value)) {
            $codes = [];
            foreach ($value as $item) {
                array_push($codes, ...$this->letterDigitCodes($item));
            }

            return array_values(array_unique($codes));
        }
        if (! is_string($value)) {
            return [];
        }

        preg_match_all('/(?<![\pL\pN])\pL+\d+(?![\pL\pN])/u', $value, $matches);

        return array_map('mb_strtolower', $matches[0] ?? []);
    }
}
