<?php

namespace App\Support;

use App\Models\AcademicSemester;
use Illuminate\Database\Eloquent\Builder;

/**
 * Finance rows carry no semester column, so a semester is read as its date range. The top bar semester (the
 * X-Academic-Semester header) picks it the same way it does for events and tasks.
 */
final class SemesterScope
{
    /** Keep the rows whose date column falls inside any of the given semesters. */
    public static function dated(Builder $query, string $column, iterable $semesters): Builder
    {
        return $query->where(function ($matches) use ($column, $semesters) {
            foreach ($semesters as $semester) {
                $matches->orWhereBetween($column, [$semester->starts_on->startOfDay(), $semester->ends_on->endOfDay()]);
            }
        });
    }

    /** Keep the rows whose date column falls inside the semester selected in the top bar, if there is one. */
    public static function selected(Builder $query, string $column, ?AcademicSemester $semester): Builder
    {
        return $semester ? self::dated($query, $column, [$semester]) : $query;
    }

    /** A budget belongs to its event's semester, or to the semester it was created in when it has no scheduled event. */
    public static function budgets(Builder $query, ?AcademicSemester $semester): Builder
    {
        if (! $semester) {
            return $query;
        }

        return $query->where(fn ($budgets) => $budgets
            ->whereHas('event', fn ($event) => $event->where('academic_semester_id', $semester->id))
            ->orWhere(fn ($general) => self::dated(
                $general->whereDoesntHave('event', fn ($event) => $event->whereNotNull('academic_semester_id')),
                'created_at',
                [$semester],
            )));
    }

    /**
     * A report belongs to every semester its period overlaps; one saved without a period belongs to where it was generated.
     * Only an approved (finished) report is filtered by it: a draft, rejected or pending one is still somebody's work.
     */
    public static function reports(Builder $query, ?AcademicSemester $semester): Builder
    {
        if (! $semester) {
            return $query;
        }

        return $query->where(fn ($reports) => $reports
            ->where('submission_status', '!=', 'approved')
            ->orWhere(fn ($approved) => $approved
                ->where(fn ($dated) => $dated
                    ->whereDate('period_start', '<=', $semester->ends_on)
                    ->whereDate('period_end', '>=', $semester->starts_on))
                ->orWhere(fn ($undated) => self::dated(
                    $undated->where(fn ($missing) => $missing->whereNull('period_start')->orWhereNull('period_end')),
                    'generated_at',
                    [$semester],
                ))));
    }

    /**
     * A collection still waiting on someone (pending verification, or verified with a balance left to remit) is shown
     * whatever the semester; only a verified, fully remitted one belongs to the semester it was collected in.
     */
    public static function collections(Builder $query, ?AcademicSemester $semester): Builder
    {
        if (! $semester) {
            return $query;
        }

        return $query->where(fn ($collections) => $collections
            ->where('status', '!=', 'verified')
            ->orWhereRaw('amount_collected > COALESCE((SELECT SUM(remittances.amount) FROM remittances WHERE remittances.collection_id = collections.id AND remittances.status = ?), 0)', ['recorded'])
            ->orWhere(fn ($settled) => self::selected($settled, 'collected_at', $semester)));
    }
}
