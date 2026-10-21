<?php

namespace App\Console\Commands;

use App\Models\AcademicSemester;
use App\Models\ComplianceRequirementType;
use App\Models\User;
use Illuminate\Console\Command;

class SeedSemestralReportRequirement extends Command
{
    protected $signature = 'compliance:seed-semestral-report';

    protected $description = 'Add the Semestral and Financial Report requirements to the active semester when missing';

    public function handle(): int
    {
        $semester = AcademicSemester::active();

        if (! $semester) {
            $this->error('There is no active academic semester.');

            return Command::FAILURE;
        }

        $director = User::where('role', 'SUPER_ADMIN')->orderBy('school_id')->value('school_id');

        if (! $director) {
            $this->error('There is no SAO director to own the requirement.');

            return Command::FAILURE;
        }

        $created = 0;
        foreach (ComplianceRequirementType::SEMESTRAL_REPORT_NAMES as $name) {
            $type = ComplianceRequirementType::firstOrCreate(
                ['academic_semester_id' => $semester->id, 'name' => $name],
                [
                    'academic_year' => $semester->academicYear->label,
                    'allowed_extensions' => ['pdf'],
                    'deadline_at' => $semester->ends_on->endOfDay(),
                    'is_active' => false,
                    'created_by' => $director,
                ],
            );
            if ($type->wasRecentlyCreated) {
                $created++;
            }
        }

        $this->info($created > 0 ? "Added {$created} inactive Semestral and Financial Report requirement(s). SAO must attach sample formats before activating them." : 'The Semestral and Financial Report requirements already exist.');

        return Command::SUCCESS;
    }
}
