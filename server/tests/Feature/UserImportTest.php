<?php

namespace Tests\Feature;

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
        $content = "\xEF\xBB\xBFSchool ID,First Name,Last Name,Email,Role\n"
            ."20260001,Taken,Id,taken@example.com,Student\n"
            ."20260002,Ana,Reyes,ana@example.com,Student\n"
            ."20260003,Ben,Cruz,ana@example.com,SBO Officer\n"
            ."20260004,Cara,Lim,cara@example.com,Admin\n"
            ."\n"
            ."20260005,Dan,Uy,not-an-email,Student\n";

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
        $content = "school_id,first_name,last_name,email,role,year_level\n"
            ."20260010,Ana,Reyes,ana@example.com,student,1st Year\n"
            ."20260011,Ben,Cruz,ben@example.com,Department Head,\n";

        $response = $this->upload($content, false)->assertCreated();

        $this->assertTrue($response->json('imported'));
        $ana = User::find(20260010);
        $this->assertSame('STUDENT', $ana->role);
        $this->assertSame($this->organization->id, $ana->organization_id);
        $this->assertSame('active', $ana->account_status);
        $this->assertFalse(Hash::check('', $ana->password_hash));
        $this->assertSame('DEPARTMENT_HEAD', User::find(20260011)->role);
        $this->assertSame(2, AuditLog::where('module', 'users')->where('action', 'imported')->count());
    }

    public function test_an_import_with_any_invalid_row_writes_nothing(): void
    {
        $content = "school_id,first_name,last_name,email,role\n"
            ."20260020,Ana,Reyes,ana@example.com,Student\n"
            ."20260021,,Cruz,ben@example.com,Student\n";

        $this->upload($content, false)->assertStatus(422)->assertJsonPath('summary.invalid', 1);

        $this->assertDatabaseMissing('users', ['school_id' => 20260020]);
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
