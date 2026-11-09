<?php

namespace App\Support;

use Illuminate\Contracts\Database\Query\Builder;

/** The position titles of a faculty organization adviser, who sits in a student organization without being a student. */
final class AdviserPosition
{
    public const TITLES = ['adviser', 'advisor', 'organization adviser', 'organization advisor'];

    public static function is(mixed $title): bool
    {
        return in_array(strtolower(trim((string) $title)), self::TITLES, true);
    }

    /** Keeps only rows whose position title column is not an adviser title (no title at all counts as not an adviser). */
    public static function whereNot(Builder $query, string $column): Builder
    {
        return $query->whereRaw('LOWER(TRIM(COALESCE('.$column.", ''))) NOT IN (".implode(', ', array_fill(0, count(self::TITLES), '?')).')', self::TITLES);
    }
}
