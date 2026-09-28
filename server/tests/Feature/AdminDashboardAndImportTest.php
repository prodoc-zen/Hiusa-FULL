<?php

namespace Tests\Feature;

use App\Models\Announcement;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AdminDashboardAndImportTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withHeaders(['Accept' => 'application/json']);
    }

    public function test_dashboard_scopes_ledger_to_organization_and_validates_period(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $other = Organization::factory()->create();
        Transaction::create(['organization_id' => $organization->id, 'recorded_by' => $admin->school_id, 'type' => 'income', 'category' => 'membership', 'amount' => 120, 'description' => 'Dues', 'transaction_date' => now()]);
        Transaction::create(['organization_id' => $other->id, 'recorded_by' => $admin->school_id, 'type' => 'expense', 'category' => 'venue', 'amount' => 5000, 'description' => 'Venue', 'transaction_date' => now()]);
        Announcement::factory()->create(['organization_id' => $organization->id, 'created_by' => $admin->school_id, 'title' => 'Campus notice', 'target_role' => 'all', 'is_published' => true, 'approval_status' => 'approved', 'published_at' => now()]);
        Announcement::factory()->create(['organization_id' => $other->id, 'created_by' => $admin->school_id, 'title' => 'Foreign notice', 'target_role' => 'all', 'is_published' => true, 'approval_status' => 'approved', 'published_at' => now()]);
        Sanctum::actingAs($admin);

        $this->getJson('/api/admin/dashboard?months=3')->assertOk()
            ->assertJsonCount(3, 'movement')
            ->assertJsonPath('movement.2.income', 120)
            ->assertJsonPath('movement.2.expense', 0)
            ->assertJsonPath('counts.new_announcements', 1)
            ->assertJsonPath('announcements.0.title', 'Campus notice')
            ->assertJsonCount(1, 'announcements');
        $this->getJson('/api/admin/dashboard?months=5')->assertUnprocessable();

        Sanctum::actingAs(User::factory()->student()->create(['organization_id' => $organization->id]));
        $this->getJson('/api/admin/dashboard')->assertForbidden();
    }

    public function test_csv_preview_creates_new_student_and_updates_shifted_student_after_confirmation(): void
    {
        $organization = Organization::factory()->create(['college' => 'College of Computer Studies']);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $student = User::factory()->student()->create(['organization_id' => $organization->id, 'program' => 'Old Program']);
        Sanctum::actingAs($admin);
        $this->postJson('/api/academic-structure/programs', ['name' => 'BSIT', 'duration_years' => 4, 'sections' => ['1' => 1, '2' => 0, '3' => 0, '4' => 0]])->assertCreated();
        $csv = "school_id,first_name,last_name,email,program,year_level,section\n"
            .$student->school_id.",{$student->first_name},{$student->last_name},{$student->email},BSIT,1,1-A\n"
            ."87654321,New,Student,new.student@example.test,BSIT,1,1-A\n"
            ."76543210,Duplicate,Student,duplicate@example.test,BSIT,1,1-A\n"
            ."76543210,Duplicate,Student,duplicate@example.test,BSIT,1,1-A\n"
            ."12345678,Bad,Student,bad@example.test,Unknown,1,1-A\n";
        $file = fn () => UploadedFile::fake()->createWithContent('students.csv', $csv);
        $preview = $this->post('/api/academic-structure/class-list/preview', ['file' => $file()])->assertOk()
            ->assertJsonPath('rows.0.status', 'update')->assertJsonPath('rows.1.status', 'new')
            ->assertJsonPath('rows.2.status', 'duplicate')->assertJsonPath('rows.3.status', 'duplicate')->assertJsonPath('rows.4.status', 'invalid');
        $this->assertDatabaseMissing('users', ['school_id' => 87654321]);
        $this->post('/api/academic-structure/class-list/apply', ['file' => $file(), 'hash' => $preview->json('hash'), 'preview_token' => $preview->json('preview_token'), 'confirm' => 1])
            ->assertOk()->assertJsonPath('updated', 1)->assertJsonPath('created', 1)
            ->assertJsonPath('invalid', 1)->assertJsonPath('duplicate', 2);
        $this->assertDatabaseHas('users', ['school_id' => $student->school_id, 'program' => 'BSIT', 'year_level' => '1st Year', 'section' => '1-A']);
        $this->assertDatabaseHas('users', ['school_id' => 87654321, 'email' => 'new.student@example.test', 'role' => 'STUDENT']);
        $this->assertTrue(Hash::check('4321-uclm', User::find(87654321)->password_hash));
        $this->post('/api/academic-structure/class-list/apply', ['file' => $file(), 'hash' => $preview->json('hash'), 'preview_token' => $preview->json('preview_token'), 'confirm' => 1])->assertUnprocessable();
        $this->post('/api/academic-structure/class-list/apply', ['file' => $file(), 'hash' => str_repeat('0', 64), 'preview_token' => $preview->json('preview_token'), 'confirm' => 1])->assertUnprocessable();
    }

    public function test_csv_import_rejects_invalid_columns_and_non_admin_access(): void
    {
        $organization = Organization::factory()->create();
        Sanctum::actingAs(User::factory()->admin()->create(['organization_id' => $organization->id]));
        $this->post('/api/academic-structure/class-list/preview', ['file' => UploadedFile::fake()->createWithContent('bad.csv', "school_id,name\n1,Test\n")])
            ->assertUnprocessable()->assertJsonValidationErrors('file');
        Sanctum::actingAs(User::factory()->officer()->create(['organization_id' => $organization->id]));
        $this->post('/api/academic-structure/class-list/preview', ['file' => UploadedFile::fake()->createWithContent('students.csv', "school_id,program,year_level,section\n1,BSIT,1,1-A\n")])->assertForbidden();
    }

    public function test_csv_marks_foreign_ids_and_missing_new_student_email_without_creating_accounts(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $foreign = User::factory()->student()->create(['organization_id' => Organization::factory()->create()->id]);
        Sanctum::actingAs($admin);
        $this->postJson('/api/academic-structure/programs', ['name' => 'BSIT', 'duration_years' => 4, 'sections' => ['1' => 1, '2' => 0, '3' => 0, '4' => 0]])->assertCreated();
        $csv = "school_id,first_name,last_name,email,program,year_level,section\n"
            .$foreign->school_id.",Foreign,Student,foreign@example.test,BSIT,1,1-A\n"
            ."23456789,No,Email,,BSIT,1,1-A\n";
        $preview = $this->post('/api/academic-structure/class-list/preview', ['file' => UploadedFile::fake()->createWithContent('students.csv', $csv)], ['Accept' => 'application/json'])
            ->assertOk()->assertJsonPath('rows.0.status', 'invalid')->assertJsonPath('rows.1.status', 'invalid');
        $this->post('/api/academic-structure/class-list/apply', ['file' => UploadedFile::fake()->createWithContent('students.csv', $csv), 'hash' => $preview->json('hash'), 'preview_token' => $preview->json('preview_token'), 'confirm' => 1], ['Accept' => 'application/json'])
            ->assertOk()->assertJsonPath('created', 0)->assertJsonPath('updated', 0);
        $this->assertDatabaseMissing('users', ['school_id' => 23456789]);
        $this->assertDatabaseHas('users', ['school_id' => $foreign->school_id, 'organization_id' => $foreign->organization_id]);
    }

    public function test_user_section_summary_uses_all_matching_student_rows_not_just_current_page(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        User::factory()->student()->count(3)->create(['organization_id' => $organization->id, 'program' => 'BSIT', 'year_level' => '1st Year', 'section' => '1-A']);
        User::factory()->student()->create(['organization_id' => $organization->id, 'program' => 'BSCS', 'year_level' => '1st Year', 'section' => '1-B']);
        Sanctum::actingAs($admin);

        $this->getJson('/api/users?role=STUDENT&program=BSIT&per_page=1')->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('summary.by_section.0.program', 'BSIT')
            ->assertJsonPath('summary.by_section.0.total', 3)
            ->assertJsonCount(1, 'summary.by_section');
    }
}
