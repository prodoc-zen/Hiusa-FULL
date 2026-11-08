<?php

namespace Database\Seeders;

use App\Models\College;
use App\Models\StudentRegistryEntry;
use App\Models\User;
use Illuminate\Database\Seeder;

class StudentRegistrySeeder extends Seeder
{
    private const PROGRAM_BY_COLLEGE = [
        'CCS' => 'BS Information Technology',
        'CBE' => 'BS Accountancy',
        'CTE' => 'Bachelor of Secondary Education',
        'CHS' => 'BS Nursing',
        'COE' => 'BS Civil Engineering',
    ];

    /** Students with no account yet, used to demo sign-up. Listed in docs/DEMO_SCRIPT.md. */
    public const UNCLAIMED = [
        ['school_id' => 2500101, 'first_name' => 'Hannah', 'last_name' => 'Reyes', 'birth_date' => '2007-03-14', 'college' => 'CCS', 'program' => 'BS Information Technology', 'year_level' => '1st Year', 'section' => 'A'],
        ['school_id' => 2500102, 'first_name' => 'Kyle', 'last_name' => 'Lim', 'birth_date' => '2006-11-02', 'college' => 'CCS', 'program' => 'BS Computer Science', 'year_level' => '1st Year', 'section' => 'B'],
        ['school_id' => 2400210, 'first_name' => 'Bianca', 'last_name' => 'Ocampo', 'birth_date' => '2005-07-21', 'college' => 'CBE', 'program' => 'BS Accountancy', 'year_level' => '2nd Year', 'section' => 'A'],
        ['school_id' => 2300215, 'first_name' => 'Joaquin', 'last_name' => 'Mercado', 'birth_date' => '2004-01-09', 'college' => 'CTE', 'program' => 'Bachelor of Secondary Education', 'year_level' => '3rd Year', 'section' => 'A'],
        ['school_id' => 2200320, 'first_name' => 'Patricia', 'last_name' => 'Soriano', 'birth_date' => '2003-09-30', 'college' => 'CHS', 'program' => 'BS Nursing', 'year_level' => '4th Year', 'section' => 'A'],
        ['school_id' => 2400330, 'first_name' => 'Renzo', 'last_name' => 'Abella', 'birth_date' => '2005-05-17', 'college' => 'COE', 'program' => 'BS Civil Engineering', 'year_level' => '2nd Year', 'section' => null],
    ];

    /** Office staff in the school records, unclaimed, so a dean can invite them from the People page. One secretary per college. */
    public const EMPLOYEES = [
        'CCS' => [
            ['school_id' => 7100101, 'first_name' => 'Marites', 'last_name' => 'Dizon', 'birth_date' => '1985-02-11', 'position' => 'Department Secretary'],
            ['school_id' => 7100102, 'first_name' => 'Rodel', 'last_name' => 'Fernandez', 'birth_date' => '1990-08-23', 'position' => 'Records Clerk'],
        ],
        'CBE' => [
            ['school_id' => 7100201, 'first_name' => 'Lorna', 'last_name' => 'Pangilinan', 'birth_date' => '1983-06-05', 'position' => 'Department Secretary'],
            ['school_id' => 7100202, 'first_name' => 'Edgar', 'last_name' => 'Villareal', 'birth_date' => '1992-12-17', 'position' => 'Records Clerk'],
        ],
        'CTE' => [
            ['school_id' => 7100301, 'first_name' => 'Gina', 'last_name' => 'Macaraeg', 'birth_date' => '1987-04-29', 'position' => 'Department Secretary'],
            ['school_id' => 7100302, 'first_name' => 'Noel', 'last_name' => 'Bautista', 'birth_date' => '1991-10-03', 'position' => 'Program Assistant'],
        ],
        'CHS' => [
            ['school_id' => 7100401, 'first_name' => 'Cecilia', 'last_name' => 'Ramirez', 'birth_date' => '1984-01-19', 'position' => 'Department Secretary'],
            ['school_id' => 7100402, 'first_name' => 'Jomar', 'last_name' => 'Tolentino', 'birth_date' => '1993-07-08', 'position' => 'Clinic Coordinator'],
        ],
        'COE' => [
            ['school_id' => 7100501, 'first_name' => 'Annabelle', 'last_name' => 'Soriano', 'birth_date' => '1986-09-14', 'position' => 'Department Secretary'],
            ['school_id' => 7100502, 'first_name' => 'Ramon', 'last_name' => 'Delos Reyes', 'birth_date' => '1989-03-26', 'position' => 'Laboratory Technician'],
        ],
    ];

    public function run(): void
    {
        if (app()->isProduction()) {
            return;
        }

        $colleges = College::pluck('id', 'code');

        // Students the user seeder already created get a record too, marked as signed up, so the
        // registry and the demo accounts tell the same story.
        User::where('role', 'STUDENT')->with('organization:id,college_id')->orderBy('school_id')->get()->each(function (User $user) use ($colleges) {
            $collegeId = $user->organization?->college_id;
            $code = $colleges->search($collegeId);
            if (! $collegeId || ! $code) {
                return;
            }
            $prefix = (int) substr((string) $user->school_id, 0, 2);
            $yearIndex = max(1, min(4, 25 - $prefix));
            $birthYear = 2000 + $prefix - 18;

            StudentRegistryEntry::updateOrCreate(['school_id' => $user->school_id], [
                'first_name' => $user->first_name,
                'last_name' => $user->last_name,
                'birth_date' => sprintf('%d-%02d-%02d', $birthYear, $user->school_id % 12 + 1, $user->school_id % 27 + 1),
                'college_id' => $collegeId,
                'program' => $user->program ?: self::PROGRAM_BY_COLLEGE[$code],
                'year_level' => $user->year_level ?: [1 => '1st Year', 2 => '2nd Year', 3 => '3rd Year', 4 => '4th Year'][$yearIndex],
                'section' => $user->section,
                'claimed_at' => now(),
            ]);
        });

        foreach (self::UNCLAIMED as $row) {
            if (! isset($colleges[$row['college']]) || User::whereKey($row['school_id'])->exists()) {
                continue;
            }
            StudentRegistryEntry::updateOrCreate(['school_id' => $row['school_id']], [
                'first_name' => $row['first_name'],
                'last_name' => $row['last_name'],
                'birth_date' => $row['birth_date'],
                'college_id' => $colleges[$row['college']],
                'program' => $row['program'],
                'year_level' => $row['year_level'],
                'section' => $row['section'],
                'claimed_at' => null,
            ]);
        }

        foreach (self::EMPLOYEES as $code => $employees) {
            if (! isset($colleges[$code])) {
                continue;
            }
            foreach ($employees as $row) {
                if (User::whereKey($row['school_id'])->exists()) {
                    continue;
                }
                StudentRegistryEntry::updateOrCreate(['school_id' => $row['school_id']], [
                    'record_type' => StudentRegistryEntry::EMPLOYEE,
                    'first_name' => $row['first_name'],
                    'last_name' => $row['last_name'],
                    'birth_date' => $row['birth_date'],
                    'college_id' => $colleges[$code],
                    'program' => null,
                    'year_level' => null,
                    'section' => null,
                    'position' => $row['position'],
                    'claimed_at' => null,
                ]);
            }
        }
    }
}
