<?php

namespace Tests\Feature;

use App\Models\AcademicProgram;
use App\Models\AuditLog;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class UserImportTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->organization = Organization::factory()->create();
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        AcademicProgram::create(['organization_id' => $this->organization->id, 'name' => 'BSIT', 'duration_years' => 4]);
    }

    private function csv(string $content): UploadedFile
    {
        return UploadedFile::fake()->createWithContent('roster.csv', $content);
    }

    private function upload(string $content, bool $dryRun)
    {
        Sanctum::actingAs($this->admin);

        return $this->post('/api/users/import', ['file' => $this->csv($content), 'dry_run' => $dryRun ? '1' : '0'], ['Accept' => 'application/json']);
    }

    public function test_a_dry_run_reports_every_problem_per_row_and_writes_nothing(): void
    {
        User::factory()->create(['school_id' => 20260001, 'organization_id' => $this->organization->id]);
        $content = "\xEF\xBB\xBFSchool ID,First Name,Last Name,Email,Role,Program\n"
            ."20260001,Taken,Id,taken@example.com,Student,BSIT\n"
            ."20260002,Ana,Reyes,ana@example.com,Student,BSIT\n"
            ."20260003,Ben,Cruz,ana@example.com,SBO Officer,\n"
            ."20260004,Cara,Lim,cara@example.com,Admin,\n"
            ."\n"
            ."20260005,Dan,Uy,not-an-email,Student,BSIT\n";

        $response = $this->upload($content, true)->assertOk();

        $this->assertFalse($response->json('imported'));
        $this->assertSame(['total' => 5, 'ready' => 1, 'invalid' => 4], $response->json('summary'));
        $rows = collect($response->json('rows'))->keyBy('row');
        $this->assertSame('ready', $rows[3]['status']);
        $this->assertStringContainsString('school id has already been taken', strtolower(implode(' ', $rows[2]['errors'])));
        $this->assertContains('The email ana@example.com is also on row 3.', $rows[4]['errors']);
        $this->assertNotEmpty($rows[5]['errors'], 'Admin accounts are never created in bulk.');
        $this->assertArrayHasKey(7, $rows->all(), 'Row numbers match the file, skipping the blank line.');
        $this->assertArrayNotHasKey('data', $rows[3]);
        $this->assertDatabaseMissing('users', ['school_id' => 20260002]);
    }

    public function test_a_clean_file_creates_every_account_with_an_unknown_password_and_audits_each(): void
    {
        $content = "school_id,first_name,last_name,email,role,program,year_level\n"
            ."20260010,Ana,Reyes,ana@example.com,student,BSIT,1st Year\n"
            ."20260011,Ben,Cruz,ben@example.com,SBO Officer,,\n";

        $response = $this->upload($content, false)->assertCreated();

        $this->assertTrue($response->json('imported'));
        $ana = User::find(20260010);
        $this->assertSame('STUDENT', $ana->role);
        $this->assertSame($this->organization->id, $ana->organization_id);
        $this->assertSame('active', $ana->account_status);
        $this->assertFalse(Hash::check('', $ana->password_hash));
        $this->assertSame('SBO_OFFICER', User::find(20260011)->role);
        $this->assertSame(2, AuditLog::where('module', 'users')->where('action', 'imported')->count());
    }

    public function test_an_import_with_any_invalid_row_writes_nothing(): void
    {
        $content = "school_id,first_name,last_name,email,role,program\n"
            ."20260020,Ana,Reyes,ana@example.com,Student,BSIT\n"
            ."20260021,,Cruz,ben@example.com,Student,BSIT\n";

        $this->upload($content, false)->assertStatus(422)->assertJsonPath('summary.invalid', 1);

        $this->assertDatabaseMissing('users', ['school_id' => 20260020]);
    }

    public function test_a_windows_1252_file_imports_with_the_right_names_on_a_dry_run_and_a_real_run(): void
    {
        $content = mb_convert_encoding("school_id,first_name,last_name,email,role,program\n20260030,Mar\u{00ED}a,Pe\u{00F1}a,pena@example.com,Student,BSIT\n", 'Windows-1252', 'UTF-8');
        $this->assertFalse(mb_check_encoding($content, 'UTF-8'));

        $this->upload($content, true)->assertOk()->assertJsonPath('rows.0.name', "Mar\u{00ED}a Pe\u{00F1}a");
        $this->assertDatabaseMissing('users', ['school_id' => 20260030]);

        $this->upload($content, false)->assertCreated();
        $user = User::find(20260030);
        $this->assertSame("Mar\u{00ED}a", $user->first_name);
        $this->assertSame("Pe\u{00F1}a", $user->last_name);
    }

    public function test_school_ids_that_are_the_same_number_are_reported_as_duplicates_not_a_server_error(): void
    {
        $content = "school_id,first_name,last_name,email,role,program\n"
            ."20260040,Ana,Reyes,ana@example.com,Student,BSIT\n"
            ."+20260040,Ben,Cruz,ben@example.com,Student,BSIT\n";

        $response = $this->upload($content, false)->assertStatus(422);

        $rows = collect($response->json('rows'))->keyBy('row');
        $this->assertSame('ready', $rows[2]['status']);
        $this->assertContains('School ID 20260040 is also on row 2.', $rows[3]['errors']);
        $this->assertDatabaseMissing('users', ['school_id' => 20260040]);
    }

    public function test_an_email_longer_than_the_column_is_refused_on_import_create_and_update(): void
    {
        $email = str_repeat('a', 89).'@test.com';
        $this->assertSame(98, strlen($email));
        $tooLong = str_repeat('a', 92).'@test.com';
        $this->assertSame(101, strlen($tooLong));

        $content = "school_id,first_name,last_name,email,role,program\n20260050,Ana,Reyes,{$tooLong},Student,BSIT\n";
        $this->upload($content, true)->assertOk()->assertJsonPath('summary.invalid', 1);

        Sanctum::actingAs($this->admin);
        $payload = [
            'school_id' => 20260051, 'first_name' => 'Ana', 'last_name' => 'Reyes',
            'role' => 'STUDENT', 'program' => 'BSIT', 'password' => 'password123', 'password_confirmation' => 'password123',
        ];
        $this->postJson('/api/users', [...$payload, 'email' => $tooLong])->assertUnprocessable()->assertJsonValidationErrors('email');
        $this->postJson('/api/users', [...$payload, 'email' => $email])->assertCreated();

        $member = User::factory()->student()->create(['organization_id' => $this->organization->id]);
        $this->putJson("/api/users/{$member->school_id}", ['email' => $tooLong])->assertUnprocessable()->assertJsonValidationErrors('email');
    }

    public function test_a_student_row_needs_a_program_like_creating_one_account(): void
    {
        $content = "school_id,first_name,last_name,email,role,program\n"
            ."20260060,Ana,Reyes,ana@example.com,Student,\n"
            ."20260061,Ben,Cruz,ben@example.com,Student,BSIT\n"
            ."20260062,Cara,Lim,cara@example.com,SBO Officer,\n";

        $response = $this->upload($content, true)->assertOk();

        $rows = collect($response->json('rows'))->keyBy('row');
        $this->assertContains('Choose a course/program for this student.', $rows[2]['errors']);
        $this->assertSame('ready', $rows[3]['status']);
        $this->assertSame('ready', $rows[4]['status']);
    }

    public function test_a_student_row_is_refused_while_the_organization_has_no_programs(): void
    {
        AcademicProgram::where('organization_id', $this->organization->id)->delete();

        $content = "school_id,first_name,last_name,email,role,program\n20260070,Ana,Reyes,ana@example.com,Student,BSIT\n";

        $this->upload($content, true)->assertOk()->assertJsonPath('rows.0.errors.0', 'Configure a course/program before creating a student account.');
    }

    public function test_a_file_without_the_required_columns_is_rejected_plainly(): void
    {
        $this->upload("id,name\n1,Ana\n", true)
            ->assertStatus(422)
            ->assertJsonPath('message', 'The first row must name the columns, including school_id, first_name, last_name, email and role.');
    }

    public function test_only_admins_can_import(): void
    {
        Sanctum::actingAs(User::factory()->create(['organization_id' => $this->organization->id, 'role' => 'SBO_OFFICER', 'account_status' => 'active']));

        $this->post('/api/users/import', ['file' => $this->csv("school_id,first_name,last_name,email,role\n")], ['Accept' => 'application/json'])->assertForbidden();
    }
}
