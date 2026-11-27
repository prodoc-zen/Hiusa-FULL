<?php

namespace Database\Seeders;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\User;
use App\Services\SemesterDefaults;
use Illuminate\Database\Seeder;

/**
 * A fresh demo database has an academic year but no open semester, so the semester-filtered lists hide every
 * seeded event the moment the SAO opens one. This opens the current semester first, and the seeders that follow
 * file their events, tasks and announcements in it. It also files the semester's requirement rows, the same ones the
 * SAO's own semester creation files, so the student application page has requirements to show; the seeded compliance
 * demo still seeds its own requirements alongside them.
 */
class AcademicSemesterSeeder extends Seeder
{
    public function run(): void
    {
        if (app()->isProduction() || AcademicSemester::active()) {
            return;
        }

        $start = now()->month >= 6 ? now()->year : now()->year - 1;
        $createdBy = User::where('role', 'SUPER_ADMIN')->orderBy('school_id')->value('school_id');
        $year = AcademicYear::firstOrCreate(['label' => $start.'-'.($start + 1)], [
            'starts_on' => $start.'-06-01',
            'ends_on' => ($start + 1).'-05-31',
            'is_current' => false,
            'created_by' => $createdBy,
        ]);

        // June to December is the first semester, January to May the second.
        $number = now()->month >= 6 ? 1 : 2;
        $semester = $year->semesters()->firstOrCreate(['number' => $number], [
            'starts_on' => $number === 1 ? $start.'-06-01' : ($start + 1).'-01-01',
            'ends_on' => $number === 1 ? $start.'-12-31' : ($start + 1).'-05-31',
            'status' => 'upcoming',
            'created_by' => $createdBy,
        ]);

        AcademicYear::where('is_current', true)->update(['is_current' => false]);
        $year->update(['is_current' => true]);
        $semester->update(['status' => 'active']);

        // The requirement rows are owned by the SAO account; without one there is nobody to own them.
        if ($createdBy !== null) {
            app(SemesterDefaults::class)->create($semester, (int) $createdBy);
        }
    }
}
