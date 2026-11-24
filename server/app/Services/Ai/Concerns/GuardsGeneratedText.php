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

    // The most fact numbers a derived sum, difference or percentage is searched over; the exact check always sees them all.
    private const DERIVED_POOL = 200;

    /**
     * Reject explanatory copy that introduces numeric claims absent from the
     * structured facts supplied by HIUSA. Calculations remain server-owned;
     * the model is only allowed to verbalize existing values.
     *
     * With $allowDerived (the Ask AI chat, whose prompt lets the writer add up or compare the figures it was given) a
     * number that is also a sum of up to three fact numbers, the difference of two, or a share of one fact number in
     * another (as a percentage) passes. A small whole number (under 100) must still appear in the facts: counts are
     * never worked out, and a small integer is too easily the sum of two others by chance.
     */
    public function preservesNumericFacts(string $text, array $facts, bool $allowDerived = false): bool
    {
        $allowed = $this->numericValues($facts);
        $codes = $this->letterDigitCodes($facts);
        $checked = preg_replace_callback(
            '/(?<![\pL\pN])\pL+\d+(?![\pL\pN])/u',
            fn (array $match) => in_array(mb_strtolower($match[0]), $codes, true) ? ' ' : $match[0],
            $this->withoutMarkdownSyntax($text)
        ) ?? $text;
        preg_match_all(self::NUMBER_TOKEN, $checked, $matches);
        $pool = null;

        foreach ($matches[0] ?? [] as $token) {
            $isPercentage = str_ends_with($token, '%');
            $value = (float) str_replace([',', '%'], '', $token);
            $candidates = $isPercentage ? [$value, $value / 100] : [$value];
            if (collect($allowed)->contains(fn (float $allowedValue) => collect($candidates)->contains(fn (float $candidate) => abs($allowedValue - $candidate) < 0.005))) {
                continue;
            }
            if ($allowDerived && $this->isDerivedFrom($token, $value, $isPercentage, $pool ??= $this->derivedPool($allowed))) {
                continue;
            }

            Log::warning('AI explanation introduced a numeric value not present in its facts.', [
                'unexpected_value' => $value,
            ]);

            return false;
        }

        return true;
    }

    /**
     * The fact numbers in whole cents, each once and never zero, as a lookup set; money is worked out in cents so
     * a sum of two amounts is compared exactly and never through floating point drift.
     *
     * @param  array<int, float>  $allowed
     * @return array<int, true>
     */
    private function derivedPool(array $allowed): array
    {
        $pool = [];
        foreach ($allowed as $number) {
            $cents = (int) round($number * 100);
            if ($cents !== 0) {
                $pool[$cents] = true;
            }
            if (count($pool) >= self::DERIVED_POOL) {
                break;
            }
        }

        return $pool;
    }

    /**
     * Whether $value is a total, a difference or a percentage of the numbers in $pool, to two decimal places.
     *
     * @param  array<int, true>  $pool  fact numbers in cents
     */
    private function isDerivedFrom(string $token, float $value, bool $isPercentage, array $pool): bool
    {
        if ($isPercentage) {
            return $this->isShareOf($token, $value, $pool);
        }

        // A count such as 3 or 12 is never worked out: it is either in the facts or it is wrong.
        if (abs($value) < 100 && ! str_contains($token, '.')) {
            return false;
        }

        $target = (int) round($value * 100);
        $numbers = array_keys($pool);

        foreach ($numbers as $a) {
            // a + b, a - b and b - a.
            if (isset($pool[$target - $a]) || isset($pool[$a - $target])) {
                return true;
            }
            foreach ($numbers as $b) {
                // a + b + c, a + b - c and a - b - c.
                if (isset($pool[$target - $a - $b]) || isset($pool[$a + $b - $target]) || isset($pool[$a - $b - $target])) {
                    return true;
                }
            }
        }

        return false;
    }

    /** A percentage that is one fact number over another, or what is left of 100 after one, rounded as the token is written. */
    private function isShareOf(string $token, float $value, array $pool): bool
    {
        $decimals = str_contains($token, '.') ? strlen(rtrim(explode('.', $token)[1], '%')) : 0;
        $tolerance = 0.5 * (10 ** -$decimals) + 1e-9;
        $positive = array_filter(array_keys($pool), fn (int $cents) => $cents > 0);

        foreach ($positive as $part) {
            foreach ($positive as $whole) {
                $share = $part / $whole * 100;
                if (abs($share - $value) <= $tolerance || abs(100 - $share - $value) <= $tolerance) {
                    return true;
                }
            }
        }

        return false;
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
