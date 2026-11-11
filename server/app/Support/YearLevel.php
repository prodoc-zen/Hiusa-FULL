<?php

namespace App\Support;

/** The year level of a student as a file or a form writes it: 1, 1st or 1st Year all mean the first year. */
final class YearLevel
{
    /** The year number, or null when the text is not a year level. */
    public static function parse(mixed $text): ?int
    {
        if (! preg_match('/^(\d{1,2})(?:st|nd|rd|th)?(?:\s+year)?$/i', trim((string) $text), $matches) || (int) $matches[1] < 1) {
            return null;
        }

        return (int) $matches[1];
    }

    /** The label stored on a student, such as 1st Year. */
    public static function label(int $year): string
    {
        return $year.(in_array($year % 100, [11, 12, 13], true) ? 'th' : ([1 => 'st', 2 => 'nd', 3 => 'rd'][$year % 10] ?? 'th')).' Year';
    }
}
