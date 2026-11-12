<?php

namespace Tests\Feature;

use App\Models\College;
use App\Models\Organization;
use App\Models\StudentRegistryEntry;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

class StudentRegistryImportTest extends TestCase
{
    use RefreshDatabase;

    private College $cit;

    private College $cbe;

    private User $sao;

    private User $dean;

    protected function setUp(): void
    {
        parent::setUp();

        $this->cit = College::create(['name' => 'College of Information Technology', 'code' => 'CIT', 'is_active' => true]);
        $this->cbe = College::create(['name' => 'College of Business', 'code' => 'CBE', 'is_active' => true]);
        $citHome = $this->home($this->cit);
        $this->home($this->cbe);
        $saoOrg = Organization::firstOrCreate(['acronym' => 'SAO'], ['name' => 'Student Affairs Office', 'slug' => 'student-affairs-office', 'organization_type' => 'UNIVERSITY', 'is_active' => true, 'lifecycle_status' => 'active']);

        $this->sao = User::factory()->superAdmin()->create(['organization_id' => $saoOrg->id]);
        $this->dean = User::factory()->departmentHead()->create(['organization_id' => $citHome->id]);
    }

    private function home(College $college): Organization
    {
        return Organization::create([
            'name' => $college->name, 'slug' => str($college->name)->slug(), 'acronym' => $college->code, 'college' => $college->name,
            'college_id' => $college->id, 'organization_type' => 'COLLEGE', 'is_active' => true, 'lifecycle_status' => 'active',
        ]);
    }

    private function csv(string $body, string $header = 'school_id,first_name,last_name,birth_date,college_code,program,year_level,section'): UploadedFile
    {
        return UploadedFile::fake()->createWithContent('records.csv', $header."\n".$body);
    }

    private function entry(array $overrides = []): StudentRegistryEntry
    {
        return StudentRegistryEntry::create([
            'school_id' => 2600001, 'first_name' => 'Ana', 'last_name' => 'Cruz', 'birth_date' => '2007-01-02',
            'college_id' => $this->cit->id, 'program' => 'BS IT', 'year_level' => '1st Year', 'section' => null, ...$overrides,
        ]);
    }

    private function upload(User $actor, UploadedFile $file): array
    {
        $preview = $this->actingAs($actor)->postJson('/api/students/registry/preview', ['file' => $file])->assertOk();

        return $preview->json();
    }

    public function test_the_sao_previews_and_applies_a_file_with_college_codes(): void
    {
        $file = $this->csv("2600001,Ana,Cruz,2007-01-02,CIT,BS IT,1,A\n2600002,Ben,Tan,2006-05-09,CBE,BS Accountancy,2nd Year,\n");
        $preview = $this->upload($this->sao, $file);

        $this->assertSame(2, $preview['counts']['created']);
        $this->assertSame('new', $preview['rows'][0]['status']);
        $this->assertSame('1st Year', $preview['rows'][0]['year_level']);
        $this->assertDatabaseCount('student_registry', 0);

        $this->actingAs($this->sao)->postJson('/api/students/registry/apply', [
            'file' => $this->csv("2600001,Ana,Cruz,2007-01-02,CIT,BS IT,1,A\n2600002,Ben,Tan,2006-05-09,CBE,BS Accountancy,2nd Year,\n"),
            'hash' => $preview['hash'], 'preview_token' => $preview['preview_token'], 'confirm' => '1',
        ])->assertOk()->assertJsonPath('created', 2);

        $this->assertSame($this->cit->id, StudentRegistryEntry::where('school_id', 2600001)->value('college_id'));
        $this->assertSame($this->cbe->id, StudentRegistryEntry::where('school_id', 2600002)->value('college_id'));
        $this->assertSame('2007-01-02', StudentRegistryEntry::where('school_id', 2600001)->first()->birth_date->format('Y-m-d'));
        $this->assertDatabaseHas('audit_logs', ['module' => 'student_registry', 'action' => 'imported', 'user_id' => $this->sao->school_id]);
    }

    public function test_the_sao_file_needs_a_known_college_code_on_every_row(): void
    {
        $preview = $this->upload($this->sao, $this->csv("2600001,Ana,Cruz,2007-01-02,,BS IT,1,\n2600002,Ben,Tan,2006-05-09,XYZ,BS IT,1,\n"));

        $this->assertSame(['College code is required.', 'Unknown college code.'], array_column($preview['rows'], 'reason'));
        $this->assertSame(2, $preview['counts']['invalid']);
    }

    public function test_a_dean_file_is_forced_to_the_own_college_and_other_college_codes_are_rejected_per_row(): void
    {
        $body = "2600001,Ana,Cruz,2007-01-02,,BS IT,1,\n2600002,Ben,Tan,2006-05-09,CIT,BS IT,2,\n2600003,Cy,Uy,2006-06-06,CBE,BS Accountancy,2,\n";
        $header = 'school_id,first_name,last_name,birth_date,college_code,program,year_level,section';
        $preview = $this->upload($this->dean, $this->csv($body, $header));

        $this->assertSame(['new', 'new', 'invalid'], array_column($preview['rows'], 'status'));
        $this->assertSame('That row is for another college.', $preview['rows'][2]['reason']);

        $this->actingAs($this->dean)->postJson('/api/students/registry/apply', [
            'file' => $this->csv($body, $header), 'hash' => $preview['hash'], 'preview_token' => $preview['preview_token'], 'confirm' => '1',
        ])->assertOk()->assertJsonPath('created', 2)->assertJsonPath('invalid', 1);

        $this->assertSame([$this->cit->id, $this->cit->id], StudentRegistryEntry::orderBy('school_id')->pluck('college_id')->all());
        $this->assertDatabaseMissing('student_registry', ['school_id' => 2600003]);
    }

    public function test_a_dean_file_does_not_need_a_college_code_column(): void
    {
        $preview = $this->upload($this->dean, $this->csv("2600001,Ana,Cruz,2007-01-02,BS IT,3rd Year\n", 'school_id,first_name,last_name,birth_date,program,year_level'));

        $this->assertSame('new', $preview['rows'][0]['status']);
        $this->assertSame('3rd Year', $preview['rows'][0]['year_level']);
    }

    public function test_a_dean_cannot_overwrite_another_colleges_record(): void
    {
        $this->entry(['school_id' => 2600009, 'college_id' => $this->cbe->id]);

        $preview = $this->upload($this->dean, $this->csv("2600009,Ana,Cruz,2007-01-02,CIT,BS IT,1,\n"));

        $this->assertSame('invalid', $preview['rows'][0]['status']);
        $this->assertSame("That school ID is in another college's records.", $preview['rows'][0]['reason']);
    }

    public function test_unchanged_updated_and_claimed_rows_are_classified_and_a_claimed_row_is_never_changed(): void
    {
        $this->entry();
        $this->entry(['school_id' => 2600002, 'first_name' => 'Ben']);
        $this->entry(['school_id' => 2600003, 'first_name' => 'Cy', 'claimed_at' => now()]);

        $body = "2600001,Ana,Cruz,2007-01-02,CIT,BS IT,1,\n2600002,Benjamin,Cruz,2007-01-02,CIT,BS IT,1,\n2600003,Cyrus,Cruz,2007-01-02,CIT,BS IT,1,\n";
        $preview = $this->upload($this->sao, $this->csv($body));
        $this->assertSame(['unchanged', 'update', 'claimed'], array_column($preview['rows'], 'status'));

        $this->actingAs($this->sao)->postJson('/api/students/registry/apply', [
            'file' => $this->csv($body), 'hash' => $preview['hash'], 'preview_token' => $preview['preview_token'], 'confirm' => '1',
        ])->assertOk()->assertJsonPath('updated', 1)->assertJsonPath('claimed', 1);

        $this->assertSame('Benjamin', StudentRegistryEntry::where('school_id', 2600002)->value('first_name'));
        $this->assertSame('Cy', StudentRegistryEntry::where('school_id', 2600003)->value('first_name'));
    }

    public function test_a_row_for_an_existing_account_is_created_as_already_claimed(): void
    {
        User::factory()->student()->create(['school_id' => 2600001]);
        $body = "2600001,Ana,Cruz,2007-01-02,CIT,BS IT,1,\n";
        $preview = $this->upload($this->sao, $this->csv($body));

        $this->actingAs($this->sao)->postJson('/api/students/registry/apply', [
            'file' => $this->csv($body), 'hash' => $preview['hash'], 'preview_token' => $preview['preview_token'], 'confirm' => '1',
        ])->assertOk();

        $this->assertNotNull(StudentRegistryEntry::where('school_id', 2600001)->value('claimed_at'));
    }

    public function test_bad_rows_are_flagged_with_a_plain_reason(): void
    {
        $body = "abc,Ana,Cruz,2007-01-02,CIT,BS IT,1,\n"
            ."2600002,Ben,Tan,02/01/2007,CIT,BS IT,1,\n"
            ."2600003,Cy,Uy,2007-01-02,CIT,BS IT,9,\n"
            ."2600004,Di,Go,2999-01-02,CIT,BS IT,1,\n"
            ."2600005,Ed,Ng,2007-01-02,CIT,BS IT,1,\n2600005,Ed,Ng,2007-01-02,CIT,BS IT,1,\n";
        $preview = $this->upload($this->sao, $this->csv($body));

        $this->assertSame(['invalid', 'invalid', 'invalid', 'invalid', 'duplicate', 'duplicate'], array_column($preview['rows'], 'status'));
        $this->assertSame('School ID must contain 1 to 8 digits.', $preview['rows'][0]['reason']);
        $this->assertSame('Birth date must be a real date written as YYYY-MM-DD.', $preview['rows'][1]['reason']);
        $this->assertSame('Year level must be 1 to 8, for example 3 or 3rd Year.', $preview['rows'][2]['reason']);
    }

    public function test_apply_refuses_a_file_that_changed_since_preview(): void
    {
        $preview = $this->upload($this->sao, $this->csv("2600001,Ana,Cruz,2007-01-02,CIT,BS IT,1,\n"));

        $this->actingAs($this->sao)->postJson('/api/students/registry/apply', [
            'file' => $this->csv("2600001,Ana,Cruz,2007-01-02,CIT,BS IT,1,\n2600002,Ben,Tan,2006-05-09,CIT,BS IT,1,\n"),
            'hash' => $preview['hash'], 'preview_token' => $preview['preview_token'], 'confirm' => '1',
        ])->assertUnprocessable()->assertJsonValidationErrors('file');

        $this->assertDatabaseCount('student_registry', 0);
    }

    public function test_a_preview_token_cannot_be_used_by_someone_else(): void
    {
        $body = "2600001,Ana,Cruz,2007-01-02,CIT,BS IT,1,\n";
        $preview = $this->upload($this->sao, $this->csv($body));

        $this->actingAs($this->dean)->postJson('/api/students/registry/apply', [
            'file' => $this->csv($body), 'hash' => $preview['hash'], 'preview_token' => $preview['preview_token'], 'confirm' => '1',
        ])->assertUnprocessable();
    }

    public function test_wrong_headers_and_non_csv_files_are_refused(): void
    {
        $this->actingAs($this->sao)->postJson('/api/students/registry/preview', ['file' => $this->csv("1,2\n", 'school_id,name')])
            ->assertUnprocessable()->assertJsonValidationErrors('file');
        $this->actingAs($this->sao)->postJson('/api/students/registry/preview', ['file' => UploadedFile::fake()->createWithContent('records.txt', 'x')])
            ->assertUnprocessable()->assertJsonValidationErrors('file');
    }

    public function test_the_list_shows_claimed_state_searches_and_gives_the_sao_each_birth_date(): void
    {
        $this->entry();
        $this->entry(['school_id' => 2600002, 'first_name' => 'Ben', 'last_name' => 'Tan', 'birth_date' => '2004-03-05', 'claimed_at' => now(), 'college_id' => $this->cbe->id]);

        $this->actingAs($this->sao)->getJson('/api/students/registry')->assertOk()
            ->assertJsonPath('summary.total', 2)->assertJsonPath('summary.claimed', 1)->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.birth_date', '2007-01-02')->assertJsonPath('data.1.birth_date', '2004-03-05');

        $this->actingAs($this->sao)->getJson('/api/students/registry?q=tan')->assertJsonCount(1, 'data')->assertJsonPath('data.0.claimed', true);
        $this->actingAs($this->sao)->getJson('/api/students/registry?q=2600001')->assertJsonCount(1, 'data')->assertJsonPath('data.0.claimed', false);
        $this->actingAs($this->sao)->getJson('/api/students/registry?claimed=unclaimed')->assertJsonCount(1, 'data');
        $this->actingAs($this->sao)->getJson('/api/students/registry?college_id='.$this->cbe->id)->assertJsonCount(1, 'data');
        $this->actingAs($this->sao)->getJson('/api/students/registry?q=%25')->assertJsonCount(0, 'data');
    }

    public function test_a_dean_never_receives_a_birth_date_from_the_registry(): void
    {
        $this->entry();
        $this->entry(['school_id' => 2600003, 'record_type' => 'employee', 'position' => 'Registrar']);

        $response = $this->actingAs($this->dean)->getJson('/api/students/registry')->assertOk()->assertJsonCount(2, 'data');

        $this->assertStringNotContainsString('2007-01-02', $response->getContent());
        $this->assertStringNotContainsString('birth', $response->getContent());
    }

    public function test_a_dean_sees_only_the_own_college_whatever_the_filter_says(): void
    {
        $this->entry();
        $this->entry(['school_id' => 2600002, 'college_id' => $this->cbe->id]);

        $this->actingAs($this->dean)->getJson('/api/students/registry?college_id='.$this->cbe->id)
            ->assertOk()->assertJsonPath('summary.total', 1)->assertJsonCount(1, 'data')->assertJsonPath('data.0.school_id', 2600001);
    }

    public function test_students_and_org_staff_cannot_reach_the_registry(): void
    {
        $student = User::factory()->student()->create();
        $admin = User::factory()->admin()->create();

        foreach ([$student, $admin] as $actor) {
            $this->actingAs($actor)->getJson('/api/students/registry')->assertForbidden();
            $this->actingAs($actor)->postJson('/api/students/registry/preview', ['file' => $this->csv("1\n")])->assertForbidden();
        }
    }

    public function test_the_registry_needs_a_signed_in_user(): void
    {
        $this->getJson('/api/students/registry')->assertUnauthorized();
        $this->postJson('/api/students/registry/apply', [])->assertUnauthorized();
    }
}
