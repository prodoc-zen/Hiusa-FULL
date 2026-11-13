<?php

namespace App\Services\Ai\Evaluation;

/**
 * Finds numbers in a model's answer that its input never contained. Used by the live evaluation to judge
 * whether a prompt really keeps the model to the facts it was given.
 */
final class GroundingCheck
{
    private const NUMBER = '/(?<![\pL\pN])-?\d[\d,]{0,24}(?:\.\d{1,12})?%?/u';

    // ISO timestamps are deadlines the model derives from supplied times, and the server validates them separately.
    private const TIMESTAMP = '/\d{4}-\d{2}-\d{2}T[0-9:.+\-Z]{1,40}/';

    /**
     * @return array{checked: int, violations: list<string>}
     */
    public static function check(string $output, string $input): array
    {
        $allowed = self::numbers($input);
        $violations = [];
        $checked = 0;

        foreach (self::tokens($output) as $token) {
            $checked++;
            $isPercentage = str_ends_with($token, '%');
            $value = (float) str_replace([',', '%'], '', $token);
            $candidates = $isPercentage ? [$value, $value / 100] : [$value];

            $found = false;
            foreach ($allowed as $known) {
                foreach ($candidates as $candidate) {
                    if (abs($known - $candidate) < 0.005) {
                        $found = true;
                        break 2;
                    }
                }
            }
            if (! $found) {
                $violations[] = $token;
            }
        }

        return ['checked' => $checked, 'violations' => array_values(array_unique($violations))];
    }

    /** @return list<float> */
    private static function numbers(string $text): array
    {
        return array_map(fn (string $token) => (float) str_replace([',', '%'], '', $token), self::tokens($text));
    }

    /** @return list<string> */
    private static function tokens(string $text): array
    {
        $text = preg_replace(self::TIMESTAMP, ' ', $text) ?? $text;
        preg_match_all(self::NUMBER, $text, $matches);

        return $matches[0] ?? [];
    }
}
