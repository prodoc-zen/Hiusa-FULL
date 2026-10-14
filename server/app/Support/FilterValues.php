<?php

namespace App\Support;

use Closure;
use Illuminate\Support\Facades\Validator;

final class FilterValues
{
    public static function values(mixed $value): array
    {
        if (is_string($value) && str_starts_with($value, '[')) {
            $decoded = json_decode($value, true);
            if (is_array($decoded) && array_is_list($decoded)) {
                return $decoded;
            }
        }

        return $value === null || $value === '' ? [] : [$value];
    }

    public static function rule(array $rules): Closure
    {
        return function (string $attribute, mixed $value, Closure $fail) use ($rules) {
            $values = self::values($value);
            if (count($values) > 100 || Validator::make(['values' => $values], ['values' => ['array', 'max:100'], 'values.*' => ['distinct', ...$rules]])->fails()) {
                $fail('The selected '.$attribute.' filter is invalid.');
            }
        };
    }
}
