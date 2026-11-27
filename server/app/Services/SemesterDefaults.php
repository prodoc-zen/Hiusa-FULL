<?php

namespace App\Services;

use App\Models\AcademicSemester;
use App\Models\ComplianceRequirementType;
use App\Models\EventRequirement;
use App\Services\Compliance\RegistrationRequirementCatalog;

/**
 * The requirement rows every semester opens with: the registration (organization) and renewal requirements, the
 * semestral report requirements, and the event requirements. The SAO creating a semester, the demo seeder and the
 * backfill command all file them here, so a semester opened any other way is not left without them.
 *
 * Each group is keyed on the semester alone: a group that already has any row for the semester is left as it is, so
 * running this again, or after the SAO has edited or removed individual requirements, never adds a duplicate or brings
 * a removed requirement back.
 */
class SemesterDefaults
{
    private const EVENT_REQUIREMENTS = [
        'on_campus' => [
            'Venue Reservation Letter',
            'Request Letter',
            'Equipment & Technical Request Forms',
        ],
        'off_campus' => [
            'Approved Letter of Intent for the Proposed Activity',
            'Document Tracking Slip',
            'Student Activity Clearance/Permit Form',
            'Modified Checklist Requirements for Off-Campus Activity',
            'Report of Compliance',
            'Designation Letter for Personnel In Charge',
            "Participants' Parents Consent Form",
            'Minutes of the Meeting (Planning Stage)',
            'Curriculum Requirement',
            'Journal',
            'Sanitary Permit (If Applicable)',
            'Emergency Preparedness Plan',
            'Mobility of Students',
            'LGU/NGO',
            'Gate Pass from PCO (If Applicable)',
        ],
    ];

    /**
     * What create() would add for this semester right now.
     *
     * @return array{compliance: int, events: int}
     */
    public function missing(AcademicSemester $semester): array
    {
        $eventCount = count(self::EVENT_REQUIREMENTS['on_campus']) + count(self::EVENT_REQUIREMENTS['off_campus']);

        return [
            'compliance' => ComplianceRequirementType::where('academic_semester_id', $semester->id)->exists()
                ? 0
                : count(RegistrationRequirementCatalog::NAMES) * 2 + count(ComplianceRequirementType::SEMESTRAL_REPORT_NAMES),
            'events' => EventRequirement::where('academic_semester_id', $semester->id)->exists() ? 0 : $eventCount,
        ];
    }

    public function create(AcademicSemester $semester, int $createdBy): void
    {
        $missing = $this->missing($semester);

        if ($missing['compliance'] > 0) {
            $label = $semester->academicYear->label;
            $deadline = $semester->ends_on->endOfDay();
            $row = fn (string $category, string $name) => [
                'category' => $category,
                'academic_year' => $label,
                'academic_semester_id' => $semester->id,
                'name' => $name,
                'allowed_extensions' => ['pdf'],
                'deadline_at' => $deadline,
                'is_active' => true,
                'created_by' => $createdBy,
            ];
            foreach (RegistrationRequirementCatalog::NAMES as $name) {
                ComplianceRequirementType::create($row('organization', $name));
                ComplianceRequirementType::create($row('renewal', $name));
            }
            foreach (ComplianceRequirementType::SEMESTRAL_REPORT_NAMES as $name) {
                ComplianceRequirementType::create($row('semestral_report', $name));
            }
        }

        if ($missing['events'] > 0) {
            $sortOrder = 0;
            foreach (self::EVENT_REQUIREMENTS as $venueType => $names) {
                foreach ($names as $name) {
                    EventRequirement::create([
                        'name' => $name,
                        'venue_type' => $venueType,
                        'academic_semester_id' => $semester->id,
                        'allowed_extensions' => ['pdf'],
                        'is_active' => true,
                        'is_optional' => str_contains($name, '(If Applicable)'),
                        'sort_order' => ++$sortOrder,
                    ]);
                }
            }
        }
    }
}
