<?php

namespace App\Services\Compliance;

use App\Models\ComplianceRequirementType;
use App\Models\OrganizationComplianceSubmission;
use Illuminate\Support\Collection;

/**
 * Resolves an organization's accreditation status from the active
 * requirement types for an academic year and that organization's
 * submissions against them. Shared by ComplianceController::status() (one
 * organization, with the full per-requirement breakdown) and
 * DashboardBriefingService's SUPER_ADMIN organizations overview (every
 * organization, status only), so the two never compute this differently.
 */
class AccreditationStatusService
{
    public function currentAcademicYear(): ?string
    {
        return ComplianceRequirementType::where('is_active', true)->max('academic_year');
    }

    /**
     * One accreditation status per organization ID. An organization with no
     * active requirement types for the resolved academic year is
     * 'not_applicable' rather than 'accredited', since nothing was asked of
     * it.
     *
     * @param  Collection<int, int>  $organizationIds
     * @return array<int, string>
     */
    public function forOrganizations(Collection $organizationIds, ?string $academicYear = null): array
    {
        $academicYear ??= $this->currentAcademicYear();

        if ($academicYear === null) {
            return $organizationIds->mapWithKeys(fn ($id) => [$id => 'not_applicable'])->all();
        }

        $requirementTypes = ComplianceRequirementType::where('academic_year', $academicYear)->where('is_active', true)->get();

        if ($requirementTypes->isEmpty()) {
            return $organizationIds->mapWithKeys(fn ($id) => [$id => 'not_applicable'])->all();
        }

        $submissions = OrganizationComplianceSubmission::whereIn('organization_id', $organizationIds)
            ->whereIn('requirement_type_id', $requirementTypes->pluck('id'))
            ->get()
            ->groupBy('organization_id');

        return $organizationIds->mapWithKeys(function ($organizationId) use ($requirementTypes, $submissions) {
            $bySubmission = ($submissions->get($organizationId) ?? collect())->keyBy('requirement_type_id');
            $statuses = $requirementTypes->map(fn (ComplianceRequirementType $type) => $bySubmission->get($type->id)->status ?? 'not_submitted');

            return [$organizationId => $this->resolve($statuses)];
        })->all();
    }

    public function forOrganization(int $organizationId, ?string $academicYear = null): string
    {
        return $this->forOrganizations(collect([$organizationId]), $academicYear)[$organizationId] ?? 'not_applicable';
    }

    /**
     * @param  Collection<int, string>  $requirementStatuses  one entry per
     *                                                         requirement type: not_submitted|submitted|approved|returned
     */
    public function resolve(Collection $requirementStatuses): string
    {
        if ($requirementStatuses->isEmpty()) {
            return 'not_applicable';
        }
        if ($requirementStatuses->contains('not_submitted')) {
            return 'incomplete';
        }
        if ($requirementStatuses->contains('returned')) {
            return 'returned';
        }
        if ($requirementStatuses->contains('submitted')) {
            return 'pending_review';
        }

        return 'accredited';
    }
}
