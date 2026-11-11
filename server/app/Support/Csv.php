<?php

namespace App\Support;

class Csv
{
    // Names, emails and descriptions are user-entered; a leading = + - @ would run as a spreadsheet formula.
    public static function cell(mixed $value): string
    {
        $text = (string) $value;

        // A signed amount such as -325.00 is a number, not a formula, so it is exported as it is.
        if (preg_match('/^[+\-]?\d{1,30}(?:\.\d{1,30})?\z/', $text) === 1) {
            return $text;
        }

        return preg_match('/^[=+\-@\t\r]/', $text) === 1 ? "'".$text : $text;
    }

    /**
     * @param  array<int, mixed>  $values
     * @return array<int, string>
     */
    public static function row(array $values): array
    {
        return array_map(static::cell(...), $values);
    }
}
