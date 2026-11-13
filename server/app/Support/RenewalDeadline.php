<?php

namespace App\Support;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\ComplianceRequirementType;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/**
 * The official renewal deadline is read from Compliance, never stored: the earliest deadline still ahead among the
 * active renewal requirement types of the current academic year. Requirement types are not organization specific, so
 * the organization only exists to keep the call shape stable if they ever become so.
 */
final class RenewalDeadline
{
    public static function for(int $organizationId): ?Carbon
    {
        return self::types($organizationId)
            ->filter(fn (ComplianceRequirementType $type) => $type->deadline_at?->isFuture())
            ->min('deadline_at');
    }

    /**
     * The active renewal requirement types that apply to an organization, soonest deadline first. The scoping is the
     * one Compliance's requirement index applies: the academic year in force, for the active semester or for the whole year.
     *
     * @return Collection<int, ComplianceRequirementType>
     */
    public static function types(int $organizationId): Collection
    {
        $semester = AcademicSemester::active();
        $academicYear = $semester?->academicYear?->label ?? AcademicYear::currentLabel()
            ?? ComplianceRequirementType::where('is_active', true)->where('category', 'renewal')->max('academic_year');

        return ComplianceRequirementType::query()
            ->where('category', 'renewal')
            ->where('is_active', true)
            ->when($academicYear, fn ($query, $year) => $query->where('academic_year', $year))
            ->where(fn ($period) => $period->whereNull('academic_semester_id')->orWhere('academic_semester_id', $semester?->id))
            ->orderBy('deadline_at')
            ->orderBy('id')
            ->get();
    }
}
