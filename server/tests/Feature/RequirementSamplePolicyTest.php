<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\College;
use App\Models\ComplianceRequirementType;
use App\Models\EventRequirement;
use App\Models\Organization;
use App\Models\OrganizationApplication;
use App\Models\User;
use App\Services\OrganizationDeletionService;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class RequirementSamplePolicyTest extends TestCase
{
    use DatabaseMigrations;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        Sanctum::actingAs(User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->value('id')]));
    }

    public static function catalogs(): array
    {
        return [
            'organization' => ['/api/compliance/requirement-types', 'compliance_requirement_types', ['academic_year' => '2026-2027', 'name' => 'Constitution', 'deadline_at' => '2026-12-31']],
            'semestral report' => ['/api/compliance/requirement-types', 'compliance_requirement_types', ['academic_year' => '2026-2027', 'category' => 'semestral_report', 'name' => 'Semester report', 'deadline_at' => '2026-12-31']],
            'event' => ['/api/event-requirements', 'event_requirements', ['name' => 'Proposal', 'allowed_extensions' => ['pdf']]],
        ];
    }

    #[DataProvider('catalogs')]
    public function test_a_publisher_cannot_create_a_requirement_without_a_sample(string $url, string $table, array $payload): void
    {
        $count = DB::table($table)->count();
        $this->postJson($url, $payload)->assertUnprocessable()->assertJsonValidationErrors(['template', 'template_url']);
        $this->assertDatabaseCount($table, $count);
        $this->assertDatabaseMissing('notifications', ['title' => 'New compliance requirement']);
        $this->postJson($url, [...$payload, 'template_url' => 'javascript:alert(1)'])->assertUnprocessable()->assertJsonValidationErrors('template_url');
    }

    #[DataProvider('catalogs')]
    public function test_a_sample_is_created_and_replaced_atomically_in_the_same_request(string $url, string $table, array $payload): void
    {
        $id = $this->post($url, [...$payload, 'template' => UploadedFile::fake()->create('sample.pdf', 10, 'application/pdf')], ['Accept' => 'application/json'])
            ->assertCreated()->assertJsonPath('template_original_name', 'sample.pdf')->assertJsonMissingPath('template_path')->json('id');
        $path = DB::table($table)->where('id', $id)->value('template_path');
        Storage::disk('local')->assertExists($path);
        $this->post($url.'/'.$id, [...$payload, '_method' => 'PUT', 'template' => UploadedFile::fake()->create('replacement.pdf', 10, 'application/pdf')], ['Accept' => 'application/json'])
            ->assertOk()->assertJsonPath('template_original_name', 'replacement.pdf');
        Storage::disk('local')->assertMissing($path);
        $nextPath = DB::table($table)->where('id', $id)->value('template_path');
        Storage::disk('local')->assertExists($nextPath);
        $this->putJson($url.'/'.$id, [...$payload, 'template_url' => 'https://example.edu/official-format'])
            ->assertOk()->assertJsonPath('template_url', 'https://example.edu/official-format')->assertJsonPath('template_original_name', null);
        Storage::disk('local')->assertMissing($nextPath);
        $this->deleteJson($url.'/'.$id.'/template')->assertConflict();
        $this->putJson($url.'/'.$id, [...$payload, 'is_active' => false])->assertOk();
        $this->deleteJson($url.'/'.$id.'/template')->assertOk();
        $this->putJson($url.'/'.$id, [...$payload, 'is_active' => true])->assertUnprocessable()->assertJsonValidationErrors('template');
    }

    #[DataProvider('catalogs')]
    public function test_a_failed_sample_upload_rolls_back_the_requirement(string $url, string $table, array $payload): void
    {
        $count = DB::table($table)->count();
        $disk = \Mockery::mock(FilesystemAdapter::class);
        $disk->shouldReceive('putFileAs')->once()->andReturn(false);
        Storage::shouldReceive('disk')->with('local')->andReturn($disk);
        $this->post($url, [...$payload, 'template' => UploadedFile::fake()->create('sample.pdf', 10, 'application/pdf')], ['Accept' => 'application/json'])->assertStatus(500);
        $this->assertDatabaseCount($table, $count);
        $this->assertDatabaseMissing('notifications', ['title' => 'New compliance requirement']);
    }

    public function test_legacy_requirements_need_a_real_sample_before_they_can_be_published_again(): void
    {
        $event = EventRequirement::create(['name' => 'Legacy proposal', 'allowed_extensions' => ['pdf'], 'is_active' => false, 'template_path' => 'missing.pdf', 'template_original_name' => 'missing.pdf']);
        $this->putJson('/api/event-requirements/'.$event->id, ['name' => $event->name, 'allowed_extensions' => ['pdf'], 'is_active' => true])->assertUnprocessable();
        $this->assertFalse($event->fresh()->is_active);
        $this->putJson('/api/event-requirements/'.$event->id, ['name' => $event->name, 'allowed_extensions' => ['pdf'], 'is_active' => true, 'template_url' => 'https://example.edu/format'])->assertOk();
        $this->assertTrue($event->fresh()->is_active);
    }

    public function test_sample_permissions_and_file_validation_cannot_be_bypassed(): void
    {
        $payload = self::catalogs()['event'][2];
        $this->post('/api/event-requirements', [...$payload, 'template' => UploadedFile::fake()->image('photo.png')], ['Accept' => 'application/json'])->assertUnprocessable()->assertJsonValidationErrors('template');
        $this->post('/api/event-requirements', [...$payload, 'template' => UploadedFile::fake()->create('sample.pdf', 10, 'application/pdf'), 'template_url' => 'https://example.edu/format'], ['Accept' => 'application/json'])->assertUnprocessable();
        Sanctum::actingAs(User::factory()->admin()->create());
        $this->postJson('/api/event-requirements', [...$payload, 'template_url' => 'https://example.edu/format'])->assertForbidden();
        $this->postJson('/api/compliance/requirement-types', [...self::catalogs()['organization'][2], 'template_url' => 'https://example.edu/format'])->assertForbidden();
    }

    #[DataProvider('catalogs')]
    public function test_standalone_sample_upload_cannot_silently_accept_a_second_link(string $url, string $table, array $payload): void
    {
        $id = $this->postJson($url, [...$payload, 'template_url' => 'https://example.edu/original'])->assertCreated()->json('id');
        $this->post($url.'/'.$id.'/template', [
            'template' => UploadedFile::fake()->create('sample.pdf', 10, 'application/pdf'),
            'template_url' => 'https://example.edu/ambiguous',
        ], ['Accept' => 'application/json'])->assertUnprocessable();
        $this->assertDatabaseHas($table, ['id' => $id, 'template_url' => 'https://example.edu/original']);
    }

    public function test_completed_semester_requirement_cannot_be_deleted_even_without_submissions(): void
    {
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31']);
        $semester = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'completed']);
        $type = ComplianceRequirementType::create(['academic_year' => $year->label, 'academic_semester_id' => $semester->id, 'name' => 'Archived report', 'deadline_at' => '2026-12-31', 'created_by' => auth()->user()->school_id]);
        $this->deleteJson('/api/compliance/requirement-types/'.$type->id)->assertConflict();
        $this->assertDatabaseHas('compliance_requirement_types', ['id' => $type->id]);
    }

    public function test_sample_removal_is_committed_and_cleanup_is_retried_after_a_storage_failure(): void
    {
        $path = 'event-requirement-templates/retry.pdf';
        Storage::disk('local')->put($path, '%PDF-1.4');
        $event = EventRequirement::create(['name' => 'Inactive proposal', 'allowed_extensions' => ['pdf'], 'is_active' => false, 'template_path' => $path, 'template_original_name' => 'retry.pdf']);
        $manager = Storage::getFacadeRoot();
        $disk = \Mockery::mock(FilesystemAdapter::class);
        $disk->shouldReceive('exists')->with($path)->andReturn(true);
        $disk->shouldReceive('delete')->with($path)->once()->andThrow(new \RuntimeException('Disk unavailable'));
        Storage::shouldReceive('disk')->with('local')->andReturn($disk);
        $this->deleteJson('/api/event-requirements/'.$event->id.'/template')->assertOk()->assertJsonPath('template_original_name', null);
        $this->assertNull($event->fresh()->template_path);
        $this->assertDatabaseHas('pending_file_deletions', ['disk' => 'local', 'path' => $path]);
        Storage::swap($manager);
        app(OrganizationDeletionService::class)->cleanup();
        Storage::disk('local')->assertMissing($path);
        $this->assertDatabaseCount('pending_file_deletions', 0);
    }

    public function test_deleting_an_unused_semester_removes_its_sample_files_after_commit(): void
    {
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31']);
        $semester = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'upcoming']);
        $path = 'event-requirement-templates/unused.pdf';
        Storage::disk('local')->put($path, '%PDF-1.4');
        EventRequirement::create(['name' => 'Unused proposal', 'academic_semester_id' => $semester->id, 'allowed_extensions' => ['pdf'], 'is_active' => false, 'template_path' => $path, 'template_original_name' => 'unused.pdf']);
        $this->deleteJson('/api/system/academic-semesters/'.$semester->id)->assertNoContent();
        Storage::disk('local')->assertMissing($path);
        $this->assertDatabaseCount('pending_file_deletions', 0);
    }

    public function test_semester_deletion_reports_application_documents_as_a_blocker(): void
    {
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31']);
        $semester = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'upcoming']);
        $type = ComplianceRequirementType::create(['academic_year' => $year->label, 'academic_semester_id' => $semester->id, 'name' => 'Application requirement', 'deadline_at' => '2026-12-31', 'created_by' => auth()->user()->school_id]);
        $college = College::create(['name' => 'College of Computing']);
        $application = OrganizationApplication::create(['college_id' => $college->id, 'name' => 'Applicants Club', 'acronym' => 'AC', 'school_id' => 987001, 'first_name' => 'Test', 'last_name' => 'Applicant', 'email' => 'applicant@example.test', 'position_title' => 'President']);
        $application->documents()->create(['requirement_type_id' => $type->id, 'file_path' => 'application.pdf', 'file_original_name' => 'application.pdf', 'mime_type' => 'application/pdf', 'file_size' => 4]);
        $this->deleteJson('/api/system/academic-semesters/'.$semester->id)->assertConflict()->assertJsonPath('reasons.0', 'application documents');
        $this->assertDatabaseHas('academic_semesters', ['id' => $semester->id]);
        $this->assertDatabaseHas('organization_application_documents', ['organization_application_id' => $application->id]);
    }
}
