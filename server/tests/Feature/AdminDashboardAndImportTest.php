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
        $this->assertArrayNotHasKey('temporary_passwords', $preview->json());
        $applied = $this->post('/api/academic-structure/class-list/apply', ['file' => $file(), 'hash' => $preview->json('hash'), 'preview_token' => $preview->json('preview_token'), 'confirm' => 1])
            ->assertOk()->assertJsonPath('updated', 1)->assertJsonPath('created', 1)
            ->assertJsonPath('invalid', 1)->assertJsonPath('duplicate', 2);
        $this->assertDatabaseHas('users', ['school_id' => $student->school_id, 'program' => 'BSIT', 'year_level' => '1st Year', 'section' => '1-A']);
        $this->assertDatabaseHas('users', ['school_id' => 87654321, 'email' => 'new.student@example.test', 'role' => 'STUDENT']);
        $created = User::find(87654321);
        $this->assertTrue($created->must_change_password);
        $this->assertFalse(Hash::check('4321-uclm', $created->password_hash));
        $applied->assertJsonCount(1, 'temporary_passwords')
            ->assertJsonPath('temporary_passwords.0.school_id', 87654321)
            ->assertJsonPath('temporary_passwords.0.name', 'New Student');
        $this->assertTrue(Hash::check($applied->json('temporary_passwords.0.password'), $created->password_hash));
        $this->assertSame(0, collect($applied->json('temporary_passwords'))->where('school_id', $student->school_id)->count());
        $this->post('/api/academic-structure/class-list/apply', ['file' => $file(), 'hash' => $preview->json('hash'), 'preview_token' => $preview->json('preview_token'), 'confirm' => 1])->assertUnprocessable();
        $this->post('/api/academic-structure/class-list/apply', ['file' => $file(), 'hash' => str_repeat('0', 64), 'preview_token' => $preview->json('preview_token'), 'confirm' => 1])->assertUnprocessable();
    }

    public function test_class_list_import_issues_unique_random_one_time_temporary_passwords_and_never_stores_them(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $existing = User::factory()->student()->create(['organization_id' => $organization->id, 'program' => 'BSIT', 'year_level' => '1st Year', 'section' => '1-A']);
        $existingHash = $existing->password_hash;
        Sanctum::actingAs($admin);
        $this->postJson('/api/academic-structure/programs', ['name' => 'BSIT', 'duration_years' => 4, 'sections' => ['1' => 1, '2' => 0, '3' => 0, '4' => 0]])->assertCreated();
        $csv = "school_id,first_name,last_name,email,program,year_level,section\n"
            .$existing->school_id.",{$existing->first_name},{$existing->last_name},{$existing->email},BSIT,1,1-A\n"
            ."20000001,Ana,One,ana.one@example.test,BSIT,1,1-A\n"
            ."20000002,Ben,Two,ben.two@example.test,BSIT,1,1-A\n";
        $file = fn () => UploadedFile::fake()->createWithContent('students.csv', $csv);
        $preview = $this->post('/api/academic-structure/class-list/preview', ['file' => $file()])->assertOk();
        $applied = $this->post('/api/academic-structure/class-list/apply', ['file' => $file(), 'hash' => $preview->json('hash'), 'preview_token' => $preview->json('preview_token'), 'confirm' => 1])
            ->assertOk()->assertJsonPath('created', 2)->assertJsonPath('unchanged', 1)
            ->assertJsonCount(2, 'temporary_passwords');

        $issued = collect($applied->json('temporary_passwords'));
        $this->assertSame([20000001, 20000002], $issued->pluck('school_id')->all());
        $this->assertSame(['Ana One', 'Ben Two'], $issued->pluck('name')->all());
        $this->assertCount(2, $issued->pluck('password')->unique());
        foreach ($issued as $entry) {
            $this->assertMatchesRegularExpression('/^[A-HJ-NP-Za-km-np-z2-9]{10}$/', $entry['password']);
            $this->assertStringNotContainsString(substr((string) $entry['school_id'], -4), $entry['password']);
            $user = User::find($entry['school_id']);
            $this->assertTrue($user->must_change_password);
            $this->assertTrue(Hash::check($entry['password'], $user->password_hash));
            $this->assertNotSame($entry['password'], $user->password_hash);
            $this->assertFalse(Hash::check(substr((string) $entry['school_id'], -4).'-uclm', $user->password_hash));
        }

        $this->assertSame($existingHash, $existing->fresh()->password_hash);
        $this->assertSame(0, $issued->where('school_id', $existing->school_id)->count());
        foreach (\App\Models\AuditLog::all() as $log) {
            foreach ($issued->pluck('password') as $password) {
                $this->assertStringNotContainsString($password, json_encode($log->toArray()));
            }
        }
        $this->assertStringContainsString('no-store', (string) $applied->headers->get('Cache-Control'));
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
