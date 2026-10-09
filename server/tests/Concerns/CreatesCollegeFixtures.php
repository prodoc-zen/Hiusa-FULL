<?php

namespace Tests\Concerns;

use App\Models\College;
use App\Models\Organization;
use App\Models\User;

trait CreatesCollegeFixtures
{
    private function makeCollege(string $code): College
    {
        return College::create(['name' => "College of {$code}", 'code' => $code, 'is_active' => true]);
    }

    private function makeCollegeHome(College $college): Organization
    {
        return Organization::factory()->create([
            'name' => $college->name,
            'college' => $college->name,
            'college_id' => $college->id,
            'organization_type' => 'COLLEGE',
        ]);
    }

    private function makeCollegeStudentOrganization(College $college, array $overrides = []): Organization
    {
        return Organization::factory()->create([
            'college' => $college->name,
            'college_id' => $college->id,
            'organization_type' => 'STUDENT_ORGANIZATION',
            ...$overrides,
        ]);
    }

    private function makeCollegeHead(College $college, array $overrides = []): User
    {
        $home = Organization::where('organization_type', 'COLLEGE')->where('college_id', $college->id)->first()
            ?? $this->makeCollegeHome($college);

        return User::factory()->departmentHead()->create(['organization_id' => $home->id, ...$overrides]);
    }
}
