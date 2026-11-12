<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;

final class FullNameSearch
{
    /**
     * Adds the full-name alternatives to a grouped where, so "Juan Dela Cruz", "Dela Cruz Juan" and
     * "Dela Cruz, Juan" find a person whose name sits across two columns.
     */
    public static function orWhereMatches($query, string $search, string $table = 'users'): void
    {
        $search = preg_replace('/\s*,\s*/', ', ', preg_replace('/\s+/', ' ', trim($search)));
        if (! str_contains($search, ' ')) {
            return;
        }

        foreach ([['first_name', "' '", 'last_name'], ['last_name', "' '", 'first_name'], ['last_name', "', '", 'first_name']] as [$leading, $separator, $trailing]) {
            $query->orWhereRaw(self::concatenated(["{$table}.{$leading}", $separator, "{$table}.{$trailing}"]).' like ?', ["%{$search}%"]);
        }
    }

    private static function concatenated(array $parts): string
    {
        return DB::getDriverName() === 'sqlite' ? '('.implode(' || ', $parts).')' : 'concat('.implode(', ', $parts).')';
    }
}
