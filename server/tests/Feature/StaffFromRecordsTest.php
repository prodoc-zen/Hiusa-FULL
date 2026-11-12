<?php

namespace Tests\Feature;

use App\Models\College;
use App\Models\DepartmentHeadInvitation;
use App\Models\Organization;
use App\Models\StudentRegistryEntry;
use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use Database\Seeders\StudentRegistrySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Mail;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

class StaffFromRecordsTest extends TestCase
{
    use CreatesCollegeFixtures, RefreshDatabase;

    private College $computing;

    private College $arts;

    private Organization $computingHome;

    private User $dean;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();

        $this->computing = $this->makeCollege('COC');
        $this->arts = $this->makeCollege('CAS');
        $this->computingHome = $this->makeCollegeHome($this->computing);
        $this->makeCollegeHome($this->arts);
        $this->dean = $this->makeCollegeHead($this->computing);
    }

    private function employee(int $schoolId, string $first, string $last, ?College $college = null, array $overrides = []): StudentRegistryEntry
    {
        return StudentRegistryEntry::create([
            'record_type' => 'employee', 'school_id' => $schoolId, 'first_name' => $first, 'last_name' => $last,
            'birth_date' => '1988-05-17', 'college_id' => ($college ?? $this->computing)->id,
            'program' => null, 'year_level' => null, 'position' => 'Department Secretary', ...$overrides,
        ]);
    }

    private function student(int $schoolId, ?College $college = null): StudentRegistryEntry
    {
        return StudentRegistryEntry::create([
            'school_id' => $schoolId, 'first_name' => 'Stu', 'last_name' => 'Dent', 'birth_date' => '2007-01-02',
            'college_id' => ($college ?? $this->computing)->id, 'program' => 'BSIT', 'year_level' => '1st Year',
        ]);
    }

    private function token(array $response): string
    {
        parse_str((string) parse_url($response['magic_link'], PHP_URL_QUERY), $query);

        return $query['token'];
    }

    private function inviteFromRecord(int $schoolId, ?User $actor = null)
    {
        return $this->actingAs($actor ?? $this->dean)->postJson('/api/college/staff/invitations', ['registry_school_id' => $schoolId]);
    }

    private function credentials(array $overrides = []): array
    {
        return ['email' => 'marites@example.edu', 'password' => 'SecurePass123!', 'password_confirmation' => 'SecurePass123!', ...$overrides];
    }

    private function csv(string $header, string $body): UploadedFile
    {
        return UploadedFile::fake()->createWithContent('records.csv', $header."\n".$body);
    }

    public function test_the_dean_finds_unclaimed_employee_records_of_the_own_college_by_name(): void
    {
        $this->employee(7000001, 'Marites', 'Dizon');
        $this->employee(7000002, 'Rodel', 'Fernandez', null, ['position' => 'Records Clerk']);
        $this->employee(7000003, 'Claimed', 'Person', null, ['claimed_at' => now()]);
        $this->employee(7000004, 'Other', 'College', $this->arts);
        $this->student(2600001);

        $all = $this->actingAs($this->dean)->getJson('/api/college/staff/records')->assertOk()
            ->assertJsonPath('has_records', true)->assertJsonCount(2, 'data');
        $this->assertSame(['Marites Dizon', 'Rodel Fernandez'], array_column($all->json('data'), 'name'));

        $this->actingAs($this->dean)->getJson('/api/college/staff/records?q=riteS')->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.school_id', 7000001)->assertJsonPath('data.0.position', 'Department Secretary');
        $this->actingAs($this->dean)->getJson('/api/college/staff/records?q=7000002')->assertJsonCount(1, 'data')->assertJsonPath('data.0.name', 'Rodel Fernandez');
        $this->actingAs($this->dean)->getJson('/api/college/staff/records?q=Person')->assertJsonCount(0, 'data');
        $this->actingAs($this->dean)->getJson('/api/college/staff/records?q=College')->assertJsonCount(0, 'data');
        $this->actingAs($this->dean)->getJson('/api/college/staff/records?q=Dent')->assertJsonCount(0, 'data');
        $this->actingAs($this->dean)->getJson('/api/college/staff/records?q=%25')->assertJsonCount(0, 'data');
    }

    public function test_the_list_never_exposes_the_birth_date_and_is_for_the_dean_only(): void
    {
        $this->employee(7000001, 'Marites', 'Dizon');

        $body = $this->actingAs($this->dean)->getJson('/api/college/staff/records')->assertOk()->getContent();
        $this->assertStringNotContainsString('1988-05-17', $body);
        $this->assertStringNotContainsString('birth', $body);

        $this->actingAs(User::factory()->admin()->create(['organization_id' => $this->computingHome->id]))->getJson('/api/college/staff/records')->assertForbidden();
        $this->actingAs(User::factory()->student()->create())->getJson('/api/college/staff/records')->assertForbidden();
        $this->actingAs(User::factory()->superAdmin()->create())->getJson('/api/college/staff/records')->assertForbidden();
    }

    public function test_has_records_is_false_when_the_college_has_no_unclaimed_employee_rows(): void
    {
        $this->actingAs($this->dean)->getJson('/api/college/staff/records')->assertOk()->assertJsonPath('has_records', false)->assertJsonCount(0, 'data');

        $this->employee(7000001, 'Marites', 'Dizon', null, ['claimed_at' => now()]);
        $this->employee(7000002, 'Elsewhere', 'Person', $this->arts);
        $this->student(2600001);
        $this->actingAs($this->dean)->getJson('/api/college/staff/records')->assertJsonPath('has_records', false);
    }

    public function test_a_link_made_from_a_record_stores_the_record_and_takes_its_position(): void
    {
        $this->employee(7000001, 'Marites', 'Dizon', null, ['position' => 'Records Clerk']);

        $response = $this->inviteFromRecord(7000001)->assertCreated();
        $token = $this->token($response->json());

        $this->assertDatabaseHas('department_head_invitations', [
            'college_id' => $this->computing->id, 'role' => 'COLLEGE_STAFF', 'registry_school_id' => 7000001, 'position_title' => 'Records Clerk',
        ]);

        $shown = $this->getJson("/api/department-head-invitations/{$token}")->assertOk()
            ->assertJsonPath('invitation.record.school_id', 7000001)
            ->assertJsonPath('invitation.record.first_name', 'Marites')
            ->assertJsonPath('invitation.record.last_name', 'Dizon')
            ->assertJsonPath('invitation.position_title', 'Records Clerk');
        $this->assertStringNotContainsString('1988-05-17', $shown->getContent());
    }

    public function test_a_plain_link_shows_no_record(): void
    {
        $response = $this->actingAs($this->dean)->postJson('/api/college/staff/invitations', [])->assertCreated();

        $this->getJson('/api/department-head-invitations/'.$this->token($response->json()))->assertOk()->assertJsonPath('invitation.record', null);
    }

    public function test_the_person_sets_only_email_and_password_and_gets_the_record_id_and_names(): void
    {
        $this->employee(7000001, 'Marites', 'Dizon');
        $token = $this->token($this->inviteFromRecord(7000001)->json());

        $accepted = $this->postJson("/api/department-head-invitations/{$token}/accept", $this->credentials())->assertOk();

        $accepted->assertJsonPath('user.school_id', 7000001)->assertJsonPath('user.first_name', 'Marites')
            ->assertJsonPath('user.last_name', 'Dizon')->assertJsonPath('user.role', 'ADMIN');
        $this->assertDatabaseHas('users', ['school_id' => 7000001, 'email' => 'marites@example.edu', 'organization_id' => $this->computingHome->id, 'position_title' => 'Department Secretary']);
        $this->assertDatabaseHas('account_profiles', ['user_school_id' => 7000001, 'organization_id' => $this->computingHome->id, 'role' => 'ADMIN', 'position_title' => 'Department Secretary']);
        $this->assertNotNull(StudentRegistryEntry::where('school_id', 7000001)->value('claimed_at'));
        $this->assertSame(7000001, DepartmentHeadInvitation::first()->school_id);

        $this->postJson('/api/login', ['identifier' => 'marites@example.edu', 'password' => 'SecurePass123!'])->assertOk();
        $this->actingAs($this->dean)->getJson('/api/college/staff')->assertOk()->assertJsonFragment(['email' => 'marites@example.edu']);
        $this->actingAs($this->dean)->getJson('/api/college/staff/records')->assertJsonPath('has_records', false);
    }

    public function test_the_client_cannot_override_the_id_or_the_names_of_a_record_link(): void
    {
        $this->employee(7000001, 'Marites', 'Dizon');
        $token = $this->token($this->inviteFromRecord(7000001)->json());

        foreach ([['school_id' => 123456], ['first_name' => 'Someone'], ['last_name' => 'Else']] as $override) {
            $this->postJson("/api/department-head-invitations/{$token}/accept", $this->credentials($override))
                ->assertUnprocessable()->assertJsonValidationErrors(array_key_first($override));
        }

        $this->assertDatabaseMissing('users', ['email' => 'marites@example.edu']);
        $this->assertNull(StudentRegistryEntry::where('school_id', 7000001)->value('claimed_at'));
        $this->assertNull(DepartmentHeadInvitation::first()->accepted_at);
    }

    public function test_a_record_link_works_once(): void
    {
        $this->employee(7000001, 'Marites', 'Dizon');
        $token = $this->token($this->inviteFromRecord(7000001)->json());

        $this->postJson("/api/department-head-invitations/{$token}/accept", $this->credentials())->assertOk();
        $this->postJson("/api/department-head-invitations/{$token}/accept", $this->credentials(['email' => 'second@example.edu']))->assertStatus(410);
        $this->assertSame(1, User::where('school_id', 7000001)->count());
    }

    public function test_a_record_claimed_after_the_link_was_made_creates_no_account(): void
    {
        $this->employee(7000001, 'Marites', 'Dizon');
        $token = $this->token($this->inviteFromRecord(7000001)->json());
        StudentRegistryEntry::where('school_id', 7000001)->update(['claimed_at' => now()]);

        $this->postJson("/api/department-head-invitations/{$token}/accept", $this->credentials())
            ->assertUnprocessable()->assertJsonValidationErrors('registry_school_id');
        $this->assertDatabaseMissing('users', ['email' => 'marites@example.edu']);
        $this->assertNull(DepartmentHeadInvitation::first()->accepted_at);
    }

    public function test_a_new_link_for_the_same_record_replaces_the_pending_one(): void
    {
        $this->employee(7000001, 'Marites', 'Dizon');
        $first = $this->token($this->inviteFromRecord(7000001)->json());
        $second = $this->token($this->inviteFromRecord(7000001)->json());

        $this->assertSame(1, DepartmentHeadInvitation::where('registry_school_id', 7000001)->count());
        $this->getJson("/api/department-head-invitations/{$first}")->assertNotFound();
        $this->getJson("/api/department-head-invitations/{$second}")->assertOk();
    }

    public function test_a_link_cannot_be_made_for_another_colleges_claimed_or_student_or_missing_record(): void
    {
        $this->employee(7000001, 'Other', 'College', $this->arts);
        $this->employee(7000002, 'Already', 'Claimed', null, ['claimed_at' => now()]);
        $this->student(2600001);

        foreach ([7000001, 7000002, 2600001, 7999999] as $schoolId) {
            $this->inviteFromRecord($schoolId)->assertUnprocessable()->assertJsonValidationErrors('registry_school_id');
        }
        $this->assertDatabaseCount('department_head_invitations', 0);
    }

    public function test_a_plain_link_asks_the_person_for_their_own_name_and_school_id(): void
    {
        $token = $this->token($this->actingAs($this->dean)->postJson('/api/college/staff/invitations', ['position_title' => 'Clerk'])->assertCreated()->json());

        $this->postJson("/api/department-head-invitations/{$token}/accept", $this->credentials(['first_name' => 'Clara', 'last_name' => 'Cruz']))
            ->assertUnprocessable()->assertJsonValidationErrors('school_id');
        $accepted = $this->postJson("/api/department-head-invitations/{$token}/accept", $this->credentials(['first_name' => 'Clara', 'last_name' => 'Cruz', 'school_id' => 7000555]))->assertOk();

        $this->assertSame(7000555, $accepted->json('user.school_id'));
        $this->assertDatabaseHas('users', ['school_id' => 7000555, 'position_title' => 'Clerk']);
        $this->assertDatabaseHas('department_head_invitations', ['registry_school_id' => null, 'role' => 'COLLEGE_STAFF', 'school_id' => 7000555]);
    }

    public function test_a_record_without_a_position_gives_office_staff(): void
    {
        $this->employee(7000001, 'Marites', 'Dizon', null, ['position' => null]);
        $token = $this->token($this->inviteFromRecord(7000001)->json());

        $this->postJson("/api/department-head-invitations/{$token}/accept", $this->credentials())->assertOk();

        $this->assertDatabaseHas('users', ['school_id' => 7000001, 'position_title' => 'Office staff']);
    }

    public function test_a_record_link_cannot_be_made_for_the_head_role(): void
    {
        $sao = User::factory()->superAdmin()->create();
        $this->employee(7000001, 'Marites', 'Dizon');

        $this->actingAs($sao)->postJson("/api/system/colleges/{$this->arts->id}/invite-department-head", ['registry_school_id' => 7000001])->assertCreated();
        $this->assertDatabaseMissing('department_head_invitations', ['registry_school_id' => 7000001]);
    }

    public function test_employee_records_can_never_be_used_to_sign_up_as_a_student(): void
    {
        $this->employee(7000001, 'Marites', 'Dizon');

        $payload = ['school_id' => 7000001, 'birth_date' => '1988-05-17', 'email' => 'marites@example.edu', 'password' => 'a-long-passphrase', 'password_confirmation' => 'a-long-passphrase'];
        $this->postJson('/api/register', $payload)->assertUnprocessable()->assertJsonValidationErrors('school_id');
        $this->postJson('/api/register/lookup', ['school_id' => 7000001, 'birth_date' => '1988-05-17'])->assertUnprocessable();
        $this->assertDatabaseMissing('users', ['school_id' => 7000001]);
    }

    public function test_the_students_tab_of_the_people_page_does_not_list_employee_records(): void
    {
        $this->employee(7000001, 'Marites', 'Dizon');
        $this->student(2600001);

        $rows = $this->actingAs($this->dean)->getJson('/api/college/people?tab=students&per_page=50')->assertOk()->json('data');
        $this->assertSame([2600001], array_column($rows, 'school_id'));
    }

    public function test_the_dean_imports_employee_rows_with_a_position_and_no_program(): void
    {
        $header = 'school_id,first_name,last_name,birth_date,record_type,position,program,year_level';
        $body = "7000010,Marites,Dizon,1988-05-17,employee,Department Secretary,,\n2600010,Ana,Cruz,2007-01-02,student,,BSIT,1\n";

        $preview = $this->actingAs($this->dean)->postJson('/api/students/registry/preview', ['file' => $this->csv($header, $body)])->assertOk();
        $this->assertSame(2, $preview->json('counts.created'));
        $this->assertSame('employee', $preview->json('rows.0.record_type'));
        $this->assertSame('Department Secretary', $preview->json('rows.0.position'));

        $this->actingAs($this->dean)->postJson('/api/students/registry/apply', [
            'file' => $this->csv($header, $body), 'hash' => $preview['hash'], 'preview_token' => $preview['preview_token'], 'confirm' => '1',
        ])->assertOk()->assertJsonPath('created', 2);

        $employee = StudentRegistryEntry::where('school_id', 7000010)->first();
        $this->assertSame('employee', $employee->record_type);
        $this->assertSame('Department Secretary', $employee->position);
        $this->assertNull($employee->program);
        $this->assertNull($employee->year_level);
        $this->assertSame($this->computing->id, (int) $employee->college_id);

        $student = StudentRegistryEntry::where('school_id', 2600010)->first();
        $this->assertSame('student', $student->record_type);
        $this->assertNull($student->position);
        $this->assertSame('1st Year', $student->year_level);
    }

    public function test_a_file_without_a_record_type_column_still_means_students(): void
    {
        $header = 'school_id,first_name,last_name,birth_date,program,year_level';
        $preview = $this->actingAs($this->dean)->postJson('/api/students/registry/preview', ['file' => $this->csv($header, "2600010,Ana,Cruz,2007-01-02,BSIT,2\n")])->assertOk();

        $this->assertSame('student', $preview->json('rows.0.record_type'));
        $this->assertSame(1, $preview->json('counts.created'));
    }

    public function test_import_rows_that_break_the_employee_or_student_rules_are_marked_invalid(): void
    {
        $this->student(2600001);
        $header = 'school_id,first_name,last_name,birth_date,record_type,position,program,year_level';
        $body = "95000001,Too,High,1988-05-17,employee,Clerk,,\n"
            ."7000011,Bad,Type,1988-05-17,teacher,,,\n"
            ."2600011,No,Program,2007-01-02,student,,,1\n"
            ."2600001,Switch,Type,1988-05-17,employee,Clerk,,\n";

        $rows = $this->actingAs($this->dean)->postJson('/api/students/registry/preview', ['file' => $this->csv($header, $body)])->assertOk()->json('rows');

        $this->assertSame(['invalid', 'invalid', 'invalid', 'invalid'], array_column($rows, 'status'));
        $this->assertStringContainsString('below 95000000', $rows[0]['reason']);
        $this->assertStringContainsString('student or employee', $rows[1]['reason']);
        $this->assertStringContainsString('program', $rows[2]['reason']);
        $this->assertStringContainsString('already in the records as a student', $rows[3]['reason']);
    }

    public function test_a_deans_employee_rows_for_another_college_are_refused_and_the_registry_filters_by_type(): void
    {
        $this->employee(7000001, 'Marites', 'Dizon');
        $this->student(2600001);
        $this->employee(7000002, 'Other', 'College', $this->arts);

        $header = 'school_id,first_name,last_name,birth_date,college_code,record_type,position';
        $rows = $this->actingAs($this->dean)->postJson('/api/students/registry/preview', ['file' => $this->csv($header, "7000020,Far,Away,1988-05-17,CAS,employee,Clerk\n")])->json('rows');
        $this->assertSame('invalid', $rows[0]['status']);

        $this->actingAs($this->dean)->getJson('/api/students/registry?record_type=employee')->assertOk()
            ->assertJsonPath('summary.total', 1)->assertJsonCount(1, 'data')->assertJsonPath('data.0.position', 'Department Secretary')->assertJsonPath('data.0.record_type', 'employee');
        $this->actingAs($this->dean)->getJson('/api/students/registry?record_type=student')->assertJsonPath('summary.total', 1)->assertJsonPath('data.0.school_id', 2600001);
        $this->actingAs($this->dean)->getJson('/api/students/registry')->assertJsonPath('summary.total', 2);
        $this->actingAs($this->dean)->getJson('/api/students/registry?record_type=other')->assertUnprocessable();
    }

    public function test_the_demo_seed_gives_every_college_an_unclaimed_secretary_with_a_birth_date(): void
    {
        $this->seed(DatabaseSeeder::class);

        foreach (array_keys(StudentRegistrySeeder::EMPLOYEES) as $code) {
            $collegeId = College::where('code', $code)->value('id');
            $secretary = StudentRegistryEntry::employees()->where('college_id', $collegeId)->where('position', 'Department Secretary')->first();
            $this->assertNotNull($secretary, "No secretary record for {$code}");
            $this->assertNull($secretary->claimed_at);
            $this->assertNotNull($secretary->birth_date);
            $this->assertNull($secretary->program);
        }
        $this->assertFalse(StudentRegistryEntry::employees()->whereNotNull('program')->exists());
    }
}
