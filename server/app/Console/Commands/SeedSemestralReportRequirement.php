<?php

namespace App\Console\Commands;

use App\Models\AcademicSemester;
use App\Models\ComplianceRequirementType;
use App\Models\User;
use Illuminate\Console\Command;

class SeedSemestralReportRequirement extends Command
{
    protected $signature = 'compliance:seed-semestral-report';

    protected $description = 'Add the Semestral Accomplishment Report requirement to the active semester when it is missing';

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

        $type = ComplianceRequirementType::firstOrCreate(
            ['academic_semester_id' => $semester->id, 'name' => ComplianceRequirementType::SEMESTRAL_ACCOMPLISHMENT_REPORT],
            [
                'academic_year' => $semester->academicYear->label,
                'deadline_at' => $semester->ends_on->endOfDay(),
                'is_active' => true,
                'created_by' => $director,
            ],
        );

        $this->info($type->wasRecentlyCreated ? 'Added the Semestral Accomplishment Report requirement.' : 'The Semestral Accomplishment Report requirement already exists.');

        return Command::SUCCESS;
    }
}
