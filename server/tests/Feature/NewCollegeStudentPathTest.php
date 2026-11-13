<?php

namespace Tests\Feature;

use App\Models\College;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * A college the SAO adds on the day has no students until the SAO loads its school records, and the
 * import finds the college only by its code.
 */
class NewCollegeStudentPathTest extends TestCase
{
    use RefreshDatabase;

    private const HEADER = 'school_id,first_name,last_name,birth_date,college_code,record_type,position,program,year_level,section';

    private User $sao;

    protected function setUp(): void
    {
        parent::setUp();

        $saoOrg = Organization::firstOrCreate(['slug' => 'student-affairs-office'], [
            'name' => 'Student Affairs Office', 'acronym' => 'SAO',
            'organization_type' => 'UNIVERSITY', 'is_active' => true, 'lifecycle_status' => 'active',
        ]);
        $this->sao = User::factory()->superAdmin()->create(['organization_id' => $saoOrg->id]);
    }

    private function csv(string $row): UploadedFile
    {
        return UploadedFile::fake()->createWithContent('records.csv', self::HEADER."\n".$row."\n");
    }

    private function createCollege(array $payload): College
    {
        Sanctum::actingAs($this->sao);
        $this->postJson('/api/system/colleges', $payload)->assertCreated();

        return College::where('name', $payload['name'])->firstOrFail();
    }

    public function test_a_college_added_today_gets_a_student_who_signs_up_and_can_be_allowed_to_apply(): void
    {
        $college = $this->createCollege(['name' => 'Test College', 'code' => 'TEST']);
        $row = '2609001,Tessa,Lim,2007-04-02,TEST,student,,BS Testing,1st Year,A';

        $preview = $this->postJson('/api/students/registry/preview', ['file' => $this->csv($row)])->assertOk()->json();
        $this->assertSame(1, $preview['counts']['created']);
        $this->postJson('/api/students/registry/apply', [
            'file' => $this->csv($row), 'hash' => $preview['hash'], 'preview_token' => $preview['preview_token'], 'confirm' => '1',
        ])->assertOk()->assertJsonPath('created', 1);

        $this->app['auth']->forgetGuards();
        $this->postJson('/api/register', [
            'school_id' => 2609001, 'birth_date' => '2007-04-02', 'email' => 'tessa@example.edu',
            'password' => 'a-long-passphrase', 'password_confirmation' => 'a-long-passphrase',
        ])->assertCreated();

        $home = Organization::where('college_id', $college->id)->where('organization_type', 'COLLEGE')->firstOrFail();
        $this->assertSame($home->id, User::where('school_id', 2609001)->value('organization_id'));

        $dean = User::factory()->departmentHead()->create(['organization_id' => $home->id]);
        Sanctum::actingAs($dean);
        $this->postJson('/api/college/applicant-grants', ['school_id' => 2609001])->assertCreated();
    }

    public function test_a_college_cannot_be_added_without_the_code_the_import_needs(): void
    {
        Sanctum::actingAs($this->sao);
        $this->postJson('/api/system/colleges', ['name' => 'Codeless College'])->assertUnprocessable()->assertJsonValidationErrors('code');
        $this->postJson('/api/system/colleges', ['name' => 'Codeless College', 'code' => '  '])->assertUnprocessable()->assertJsonValidationErrors('code');
    }

    public function test_an_edit_cannot_clear_a_code_but_a_college_that_never_had_one_stays_editable(): void
    {
        $coded = $this->createCollege(['name' => 'Coded College', 'code' => 'CODED']);
        $this->putJson('/api/system/colleges/'.$coded->id, ['name' => 'Coded College', 'code' => ''])
            ->assertUnprocessable()->assertJsonValidationErrors('code');
        $this->assertSame('CODED', $coded->fresh()->code);

        $legacy = College::create(['name' => 'Legacy College', 'code' => null, 'is_active' => true]);
        $this->putJson('/api/system/colleges/'.$legacy->id, ['name' => 'Legacy College Renamed'])->assertOk();
    }

    public function test_a_blank_college_code_never_lands_in_an_older_college_without_a_code(): void
    {
        College::create(['name' => 'Codeless College', 'code' => null, 'is_active' => true]);
        Sanctum::actingAs($this->sao);

        $preview = $this->postJson('/api/students/registry/preview', [
            'file' => $this->csv('2609002,Nico,Uy,2007-05-03,,student,,BS Testing,1st Year,A'),
        ])->assertOk()->json();

        $this->assertSame(0, $preview['counts']['created']);
        $this->assertSame('College code is required.', $preview['rows'][0]['reason']);
    }
}
