<?php

namespace Tests\Feature;

use App\Models\AcademicProgram;
use App\Models\AuditLog;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

class MailOffRecoveryTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private function mailOff(): void
    {
        config(['mail.default' => 'log', 'app.frontend_url' => 'https://hiusa.example.test']);
        Mail::fake();
    }

    private function rosterAdmin(): void
    {
        $organization = Organization::factory()->create();
        AcademicProgram::create(['organization_id' => $organization->id, 'name' => 'BSIT', 'duration_years' => 4]);
        Sanctum::actingAs(User::factory()->admin()->create(['organization_id' => $organization->id]));
    }

    private function director(): User
    {
        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);

        return User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
    }

    private function resetQuery(string $link): array
    {
        $this->assertStringStartsWith('https://hiusa.example.test/reset-password?', $link);
        parse_str((string) parse_url($link, PHP_URL_QUERY), $query);

        return $query;
    }

    public function test_with_mail_off_the_import_returns_one_temporary_password_per_member_that_works_once(): void
    {
        $this->mailOff();
        $this->rosterAdmin();
        $csv = "school_id,first_name,last_name,email,role,program,year_level\n"
            ."20260110,Ana,Reyes,ana@example.com,Student,BSIT,1st Year\n"
            ."20260111,Ben,Cruz,ben@example.com,SBO Officer,,\n";

        $response = $this->post('/api/users/import', ['file' => UploadedFile::fake()->createWithContent('roster.csv', $csv), 'dry_run' => '0'], ['Accept' => 'application/json'])->assertCreated();

        $credentials = collect($response->json('credentials'))->keyBy('school_id');
        $this->assertCount(2, $credentials);
        foreach ([20260110 => 'ana@example.com', 20260111 => 'ben@example.com'] as $schoolId => $email) {
            $user = User::find($schoolId);
            $this->assertSame($email, $credentials[$schoolId]['email']);
            $this->assertTrue(Hash::check($credentials[$schoolId]['temporary_password'], $user->password_hash));
            $this->assertTrue((bool) $user->must_change_password);
        }
        $this->assertNotSame($credentials[20260110]['temporary_password'], $credentials[20260111]['temporary_password']);
        $this->assertStringNotContainsString($credentials[20260110]['temporary_password'], json_encode(AuditLog::all()->toArray()));
        $this->assertStringContainsString('no-store', (string) $response->headers->get('Cache-Control'));
    }

    public function test_with_mail_off_a_dry_run_returns_no_passwords(): void
    {
        $this->mailOff();
        $this->rosterAdmin();
        $csv = "school_id,first_name,last_name,email,role,program,year_level\n20260120,Ana,Reyes,ana@example.com,Student,BSIT,1st Year\n";

        $response = $this->post('/api/users/import', ['file' => UploadedFile::fake()->createWithContent('roster.csv', $csv), 'dry_run' => '1'], ['Accept' => 'application/json'])->assertOk()->assertJsonPath('summary.invalid', 0);

        $this->assertArrayNotHasKey('credentials', $response->json());
    }

    public function test_with_a_real_mail_driver_the_import_returns_no_passwords(): void
    {
        $this->rosterAdmin();
        $csv = "school_id,first_name,last_name,email,role,program,year_level\n20260130,Ana,Reyes,ana@example.com,Student,BSIT,1st Year\n";

        $response = $this->post('/api/users/import', ['file' => UploadedFile::fake()->createWithContent('roster.csv', $csv), 'dry_run' => '0'], ['Accept' => 'application/json'])->assertCreated();

        $this->assertArrayNotHasKey('credentials', $response->json());
        $this->assertFalse((bool) User::find(20260130)->must_change_password);
    }

    public function test_with_mail_off_the_sao_reset_of_a_department_head_returns_a_working_link(): void
    {
        $this->mailOff();
        $college = $this->makeCollege('CCS');
        $this->makeCollegeHome($college);
        $head = $this->makeCollegeHead($college);
        Sanctum::actingAs($this->director());

        $response = $this->postJson("/api/system/department-heads/{$head->school_id}/password-reset")->assertOk();

        $query = $this->resetQuery($response->json('reset_link'));
        $this->assertSame($head->email, $query['email']);
        Mail::assertNothingOutgoing();
        app('auth')->forgetGuards();
        $this->postJson('/api/password/reset/validate', ['organization_id' => $head->organization_id, 'email' => $head->email, 'token' => $query['token']])->assertOk();
    }

    public function test_with_mail_off_forgot_password_creates_no_link_and_says_to_ask_for_a_reset(): void
    {
        $this->mailOff();
        $user = User::factory()->create(['email' => 'recover@example.com', 'account_status' => 'active']);

        $known = $this->postJson('/api/password/forgot', ['organization_id' => $user->organization_id, 'email' => 'recover@example.com'])->assertOk();
        $unknown = $this->postJson('/api/password/forgot', ['identifier' => 'missing@example.edu'])->assertOk();

        $this->assertSame($known->json(), $unknown->json());
        $this->assertFalse($known->json('email_sent'));
        $this->assertStringContainsString('Ask your organization Admin or the SAO', $known->json('message'));
        $this->assertDatabaseMissing('password_reset_tokens', ['email' => 'recover@example.com']);
        Mail::assertNothingOutgoing();
    }
}
