<?php

namespace App\Support;

class Csv
{
    // Names, emails and descriptions are user-entered; a leading = + - @ would run as a spreadsheet formula.
    public static function cell(mixed $value): string
    {
        $text = (string) $value;

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
