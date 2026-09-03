<?php

namespace Database\Seeders;

use App\Models\AcademicProgram;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Database\Seeder;

class AcademicStructureSeeder extends Seeder
{
    /**
     * Programs per college, with the number of lettered sections per year level.
     * Keyed by the organization's college so an organization whose college is not
     * listed still gets a usable structure instead of an empty admin screen.
     */
    private const PROGRAMS_BY_COLLEGE = [
        'College of Computer Studies' => [
            'BS Information Technology' => [1 => 2, 2 => 2, 3 => 1, 4 => 1],
            'BS Computer Science' => [1 => 1, 2 => 1, 3 => 1, 4 => 1],
        ],
        'College of Business Education' => [
            'BS Accountancy' => [1 => 1, 2 => 1, 3 => 1, 4 => 1],
        ],
        'College of Teacher Education' => [
            'Bachelor of Secondary Education' => [1 => 1, 2 => 1, 3 => 1, 4 => 1],
        ],
        'College of Health Sciences' => [
            'BS Nursing' => [1 => 1, 2 => 1, 3 => 1, 4 => 1],
        ],
    ];

    private const FALLBACK_PROGRAMS = [
        'General Program' => [1 => 1, 2 => 1, 3 => 1, 4 => 1],
    ];

    private const YEAR_LABELS = [1 => '1st Year', 2 => '2nd Year', 3 => '3rd Year', 4 => '4th Year'];

    public function run(): void
    {
        Organization::query()->orderBy('id')->each(function (Organization $organization) {
            $programs = self::PROGRAMS_BY_COLLEGE[$organization->college] ?? self::FALLBACK_PROGRAMS;

            foreach ($programs as $name => $letteredPerYear) {
                $program = AcademicProgram::firstOrCreate([
                    'organization_id' => $organization->id,
                    'name' => $name,
                ]);

                foreach ([1, 2, 3, 4] as $year) {
                    // 2026_08_31_000003 backfills "Non Block" only for programs that exist
                    // when it runs; on a fresh seed that is none, so it is created here.
                    $program->sections()->firstOrCreate(['year_level' => $year, 'name' => "{$year} - Non Block"]);

                    for ($i = 0; $i < ($letteredPerYear[$year] ?? 0); $i++) {
                        $letter = chr(ord('A') + $i);
                        $program->sections()->firstOrCreate(['year_level' => $year, 'name' => "{$year}-{$letter}"]);
                    }
                }
            }

            $this->placeStudents($organization);
        });
    }

    /**
     * Spread the organization's seeded students across its programs, year levels and
     * lettered sections so the register filters and the academic CRUD have real data.
     */
    private function placeStudents(Organization $organization): void
    {
        $programs = AcademicProgram::with('sections')
            ->where('organization_id', $organization->id)
            ->orderBy('id')
            ->get();

        if ($programs->isEmpty()) {
            return;
        }

        $students = User::where('organization_id', $organization->id)
            ->where('role', 'STUDENT')
            ->orderBy('school_id')
            ->get();

        foreach ($students as $index => $student) {
            $program = $programs[$index % $programs->count()];
            $year = (intdiv($index, $programs->count()) % 4) + 1;

            $lettered = $program->sections
                ->where('year_level', $year)
                ->reject(fn ($section) => str_contains($section->name, 'Non Block'))
                ->values();

            $section = $lettered->isNotEmpty()
                ? $lettered[intdiv($index, $programs->count() * 4) % $lettered->count()]
                : $program->sections->firstWhere('year_level', $year);

            $student->forceFill([
                'department' => $organization->college,
                'program' => $program->name,
                'year_level' => self::YEAR_LABELS[$year],
                'section' => $section?->name,
            ])->save();
        }
    }
}
