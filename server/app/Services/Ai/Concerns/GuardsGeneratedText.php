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
    // A hyphen straight after a letter joins the parts of a code ("HIUSA-2-00000015"), so it is no minus sign.
    private const NUMBER_TOKEN = '/(?<![\pN.,])(?:(?:(?<!\pL)-)?\d{1,3}(?:,\d{3})+(?:\.\d+)?%?|(?:(?<!\pL)-)?\d+(?:\.\d+)?%?)/u';

    // The most money figures a derived sum, difference or percentage is searched over; the exact check always sees them all.
    private const DERIVED_POOL = 200;

    // The most money figures one fact object contributes to the percentage search.
    private const GROUP_LIMIT = 200;

    /**
     * Reject explanatory copy that introduces numeric claims absent from the
     * structured facts supplied by HIUSA. Calculations remain server-owned;
     * the model is only allowed to verbalize existing values.
     *
     * With $allowDerived (the Ask AI chat, whose prompt lets the writer add up or compare the figures it was given) a
     * number that is also the sum or the difference of two money figures in the facts, or a percentage that is one
     * figure over another inside the same fact object (one row's own amounts, the highlights), passes. Only money
     * figures take part: an amount with centavos or a thousands separator, or a whole number of 100 or more that is
     * not a year. Counts, dates and years are never worked out, a percentage is never taken across two rows, and a
     * small whole number must appear in the facts, because any of them is too easily a sum or a ratio by chance.
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
        $figures = null;

        foreach ($matches[0] ?? [] as $token) {
            $isPercentage = str_ends_with($token, '%');
            $value = (float) str_replace([',', '%'], '', $token);
            $candidates = $isPercentage ? [$value, $value / 100] : [$value];
            if (collect($allowed)->contains(fn (float $allowedValue) => collect($candidates)->contains(fn (float $candidate) => abs($allowedValue - $candidate) < 0.005))) {
                continue;
            }
            if ($allowDerived && $this->isDerivedFrom($token, $value, $isPercentage, $figures ??= $this->moneyFigures($facts))) {
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
     * The money figures of the facts in whole cents (money is worked out in cents, so a sum is compared exactly and never
     * through floating point drift): 'pool' holds each one once, 'groups' holds them per fact object, where an object
     * is an array's own scalar values and 'highlights' and 'ledger' count as one object each.
     *
     * @return array{pool: array<int, true>, groups: array<int, array<int, int>>}
     */
    private function moneyFigures(array $facts): array
    {
        $groups = [];
        $this->collectFigureGroups($facts, $groups);

        $pool = [];
        foreach ($groups as $group) {
            foreach ($group as $cents) {
                $pool[$cents] = true;
                if (count($pool) >= self::DERIVED_POOL) {
                    break 2;
                }
            }
        }

        return ['pool' => $pool, 'groups' => $groups];
    }

    /** @param array<int, array<int, int>> $groups */
    private function collectFigureGroups(array $node, array &$groups): void
    {
        $own = [];
        foreach ($node as $key => $child) {
            if (is_array($child)) {
                $this->collectFigureGroups($child, $groups);
                if ($key === 'highlights' || $key === 'ledger') {
                    $all = [];
                    $this->flattenFigures($child, $all);
                    $groups[] = array_slice(array_values(array_unique($all)), 0, self::GROUP_LIMIT);
                }

                continue;
            }
            array_push($own, ...$this->figuresIn($child));
        }
        if ($own !== []) {
            $groups[] = array_slice(array_values(array_unique($own)), 0, self::GROUP_LIMIT);
        }
    }

    /** @param array<int, int> $into */
    private function flattenFigures(array $node, array &$into): void
    {
        foreach ($node as $child) {
            if (is_array($child)) {
                $this->flattenFigures($child, $into);
            } else {
                array_push($into, ...$this->figuresIn($child));
            }
        }
    }

    /**
     * The money figures in one scalar, in cents. A number glued to a date by a dash, a slash or a colon is a date or time
     * part, a bare whole number from 1900 to 2100 is a year, and a whole number under 100 is a count; none is money.
     *
     * @return array<int, int>
     */
    private function figuresIn(mixed $value): array
    {
        if (is_int($value)) {
            return $value >= 100 && ! ($value >= 1900 && $value <= 2100) ? [$value * 100] : [];
        }
        if (is_float($value)) {
            $value = abs($value);

            return $value >= 100 || fmod($value, 1.0) !== 0.0 ? [(int) round($value * 100)] : [];
        }
        if (! is_string($value)) {
            return [];
        }

        preg_match_all('/(?<![\pL\pN])(?<![\pN][-\/:])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?![\pN]|[-\/:]\pN)/u', $value, $matches);

        $figures = [];
        foreach ($matches[1] ?? [] as $token) {
            $number = (float) str_replace(',', '', $token);
            $hasCents = str_contains($token, '.') || str_contains($token, ',');
            if ($number <= 0 || (! $hasCents && ($number < 100 || ($number >= 1900 && $number <= 2100)))) {
                continue;
            }
            $figures[] = (int) round($number * 100);
        }

        return $figures;
    }

    /**
     * Whether $value is the sum or the difference of two money figures, or a percentage of one figure in another within
     * one fact object, to two decimal places.
     *
     * @param  array{pool: array<int, true>, groups: array<int, array<int, int>>}  $figures
     */
    private function isDerivedFrom(string $token, float $value, bool $isPercentage, array $figures): bool
    {
        if ($isPercentage) {
            return $this->isShareOf($token, $value, $figures['groups']);
        }

        // A count such as 3 or 12 is never worked out: it is either in the facts or it is wrong.
        if (abs($value) < 100 && ! str_contains($token, '.')) {
            return false;
        }

        $target = (int) round(abs($value) * 100);
        $pool = $figures['pool'];

        foreach (array_keys($pool) as $a) {
            // a + b, a - b and b - a.
            if (isset($pool[$target - $a]) || isset($pool[$a - $target])) {
                return true;
            }
        }

        return false;
    }

    /**
     * A percentage that is one figure over a larger one in the same fact object, or what is left of 100 after it, rounded
     * as the token is written.
     *
     * @param  array<int, array<int, int>>  $groups
     */
    private function isShareOf(string $token, float $value, array $groups): bool
    {
        $decimals = str_contains($token, '.') ? strlen(rtrim(explode('.', $token)[1], '%')) : 0;
        $tolerance = 0.5 * (10 ** -$decimals) + 1e-9;

        foreach ($groups as $group) {
            foreach ($group as $part) {
                foreach ($group as $whole) {
                    if ($part > $whole) {
                        continue;
                    }
                    $share = $part / $whole * 100;
                    if (abs($share - $value) <= $tolerance || abs(100 - $share - $value) <= $tolerance) {
                        return true;
                    }
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
