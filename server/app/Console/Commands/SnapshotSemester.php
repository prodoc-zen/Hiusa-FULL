<?php

namespace App\Console\Commands;

use App\Models\AcademicSemester;
use App\Services\Records\SemesterSnapshotService;
use Illuminate\Console\Command;

class SnapshotSemester extends Command
{
    protected $signature = 'hiusa:snapshot-semester {semester? : Semester id; the active semester when omitted}';

    protected $description = 'Record each student organization\'s status and officers for a semester, for the Records page';

    public function handle(SemesterSnapshotService $snapshots): int
    {
        $semester = $this->argument('semester')
            ? AcademicSemester::find($this->argument('semester'))
            : AcademicSemester::active();

        if (! $semester) {
            $this->error('There is no such semester.');

            return Command::FAILURE;
        }

        $count = $snapshots->snapshot($semester);
        $this->info("Recorded {$count} organizations for semester {$semester->id}.");

        return Command::SUCCESS;
    }
}
