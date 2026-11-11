<?php

namespace Tests\Feature;

use App\Models\AcademicProgram;
use App\Models\AcademicSection;
use App\Models\Organization;
use App\Models\StudentRegistryEntry;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

class ClassListRegistryTest extends TestCase
{
    use CreatesCollegeFixtures, RefreshDatabase;

    private Organization $organization;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $college = $this->makeCollege('CBE');
        $this->makeCollegeHome($college);
        $this->organization = $this->makeCollegeStudentOrganization($college);
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        $program = AcademicProgram::create(['organization_id' => $this->organization->id, 'name' => 'BSIT', 'duration_years' => 4]);
        AcademicSection::create(['academic_program_id' => $program->id, 'year_level' => 1, 'name' => '1-A']);
    }

    private function registry(int $schoolId): void
    {
        StudentRegistryEntry::create([
            'school_id' => $schoolId, 'first_name' => 'Reg', 'last_name' => 'Istered', 'birth_date' => '2005-01-02',
            'college_id' => $this->organization->college_id, 'program' => 'BSIT', 'year_level' => '1st Year',
        ]);
    }

    private function preview(string $csv)
    {
        Sanctum::actingAs($this->admin);

        return $this->post('/api/academic-structure/class-list/preview', ['file' => UploadedFile::fake()->createWithContent('students.csv', $csv)], ['Accept' => 'application/json']);
    }

    public function test_a_class_list_does_not_create_an_account_for_an_id_the_registry_does_not_know(): void
    {
        $this->registry(20260001);
        $csv = "school_id,first_name,last_name,email,program,year_level,section\n"
            ."20260001,Ana,Reyes,ana@example.test,BSIT,1,1-A\n"
            ."20269999,Ben,Cruz,ben@example.test,BSIT,1,1-A\n";

        $preview = $this->preview($csv)->assertOk()
            ->assertJsonPath('rows.0.status', 'new')
            ->assertJsonPath('rows.1.status', 'invalid')
            ->assertJsonPath('rows.1.reason', 'This school ID is not in the student registry of your college. Ask your dean or the SAO to add the student there first.');

        $this->post('/api/academic-structure/class-list/apply', [
            'file' => UploadedFile::fake()->createWithContent('students.csv', $csv), 'hash' => $preview->json('hash'), 'preview_token' => $preview->json('preview_token'), 'confirm' => 1,
        ], ['Accept' => 'application/json'])->assertOk()->assertJsonPath('created', 1);

        $this->assertDatabaseHas('users', ['school_id' => 20260001]);
        $this->assertDatabaseMissing('users', ['school_id' => 20269999]);
    }

    public function test_a_college_without_a_loaded_registry_can_still_create_students_from_a_class_list(): void
    {
        $csv = "school_id,first_name,last_name,email,program,year_level,section\n20269999,Ben,Cruz,ben@example.test,BSIT,1,1-A\n";

        $this->preview($csv)->assertOk()->assertJsonPath('rows.0.status', 'new');
    }

    public function test_the_year_level_can_be_a_number_or_written_out(): void
    {
        $csv = "school_id,first_name,last_name,email,program,year_level,section\n"
            ."20260010,Ana,Reyes,ana@example.test,BSIT,1,1-A\n"
            ."20260011,Ben,Cruz,ben@example.test,BSIT,1st Year,1-A\n"
            ."20260012,Cara,Lim,cara@example.test,BSIT,Freshman,1-A\n";

        $this->preview($csv)->assertOk()
            ->assertJsonPath('rows.0.status', 'new')
            ->assertJsonPath('rows.0.year_level', '1st Year')
            ->assertJsonPath('rows.1.status', 'new')
            ->assertJsonPath('rows.1.year_level', '1st Year')
            ->assertJsonPath('rows.2.status', 'invalid')
            ->assertJsonPath('rows.2.reason', 'Year level must be a number such as 1, or written like 1st Year.');
    }
}
