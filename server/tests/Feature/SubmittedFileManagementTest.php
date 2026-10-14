<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\College;
use App\Models\ComplianceRequirementType;
use App\Models\Organization;
use App\Models\OrganizationComplianceSubmission;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class SubmittedFileManagementTest extends TestCase
{
    use RefreshDatabase;

    private function context(): array
    {
        Storage::fake('local');
        $college = College::create(['name' => 'College of Computing', 'is_active' => true]);
        $home = Organization::factory()->create(['college_id' => $college->id, 'college' => $college->name, 'organization_type' => 'COLLEGE']);
        $organization = Organization::factory()->create(['college_id' => $college->id, 'college' => $college->name, 'organization_type' => 'STUDENT_ORGANIZATION', 'lifecycle_status' => 'active']);
        $admin = User::factory()->create(['organization_id' => $organization->id, 'role' => 'ADMIN']);
        $head = User::factory()->departmentHead()->create(['organization_id' => $home->id]);
        $sao = User::factory()->superAdmin()->create();
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        $semester = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'active']);
        $type = ComplianceRequirementType::create(['academic_year' => $year->label, 'academic_semester_id' => $semester->id, 'name' => 'Constitution', 'deadline_at' => now()->addMonth(), 'allowed_extensions' => ['pdf'], 'is_active' => true, 'created_by' => $sao->school_id]);
        $path = 'compliance-submissions/'.$organization->id.'/original.pdf';
        Storage::disk('local')->put($path, '%PDF-1.4 old');
        $submission = OrganizationComplianceSubmission::create(['organization_id' => $organization->id, 'requirement_type_id' => $type->id, 'status' => 'approved', 'file_path' => $path, 'file_original_name' => 'original.pdf', 'mime_type' => 'application/pdf', 'file_size' => 12, 'is_registration_document' => true, 'submitted_by' => $admin->school_id, 'submitted_at' => now()->subMinute()]);

        return compact('organization', 'admin', 'head', 'sao', 'submission', 'path');
    }

    public function test_admin_can_replace_approved_file_and_reviewers_are_notified(): void
    {
        extract($this->context());
        Sanctum::actingAs($admin);
        $this->post('/api/compliance/submissions/'.$submission->id.'/document', ['submitted_at' => $submission->submitted_at->toIso8601String(), 'document' => UploadedFile::fake()->create('corrected.pdf', 15, 'application/pdf')], ['Accept' => 'application/json'])
            ->assertOk()->assertJsonPath('status', 'submitted')->assertJsonPath('file_original_name', 'corrected.pdf');
        Storage::disk('local')->assertMissing($path);
        Storage::disk('local')->assertExists($submission->fresh()->file_path);
        $this->assertDatabaseHas('notifications', ['user_id' => $head->school_id, 'title' => 'Submitted file replaced']);
        $this->assertDatabaseHas('notifications', ['user_id' => $sao->school_id, 'title' => 'Submitted file replaced']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'submission_document_replaced', 'record_id' => $submission->id]);
        $this->getJson('/api/compliance/documents?family=registration')->assertOk()->assertJsonPath('data.0.file_name', 'corrected.pdf');
    }

    public function test_file_mutations_are_scoped_and_stale_versions_are_rejected(): void
    {
        extract($this->context());
        $other = User::factory()->create(['role' => 'ADMIN', 'organization_id' => Organization::factory()->create()->id]);
        Sanctum::actingAs($other);
        $this->deleteJson('/api/compliance/submissions/'.$submission->id, ['submitted_at' => $submission->submitted_at->toIso8601String()])->assertNotFound();
        $this->post('/api/compliance/submissions/'.$submission->id.'/document', ['submitted_at' => $submission->submitted_at->toIso8601String(), 'document' => UploadedFile::fake()->create('x.pdf', 1, 'application/pdf')], ['Accept' => 'application/json'])->assertNotFound();
        Sanctum::actingAs($admin);
        $this->deleteJson('/api/compliance/submissions/'.$submission->id, ['submitted_at' => now()->subDay()->toIso8601String()])->assertConflict();
        Sanctum::actingAs($head);
        $this->deleteJson('/api/compliance/submissions/'.$submission->id, ['submitted_at' => $submission->submitted_at->toIso8601String()])->assertForbidden();
        Storage::disk('local')->assertExists($path);
    }

    public function test_admin_deletion_notifies_reviewers_and_sao_can_update_limits(): void
    {
        extract($this->context());
        Sanctum::actingAs($admin);
        $this->deleteJson('/api/compliance/submissions/'.$submission->id, ['submitted_at' => $submission->submitted_at->toIso8601String()])->assertOk();
        Storage::disk('local')->assertMissing($path);
        $this->assertDatabaseHas('notifications', ['user_id' => $head->school_id, 'title' => 'Submitted file deleted']);
        $this->getJson('/api/system/file-storage')->assertForbidden();
        Sanctum::actingAs($sao);
        $this->putJson('/api/system/file-storage', ['max_file_mb' => 5, 'max_organization_mb' => 25])->assertOk()->assertJsonPath('settings.max_file_mb', 5);
        $this->getJson('/api/system/file-storage')->assertOk()->assertJsonPath('settings.max_organization_mb', 25);
        $this->assertSame(25, (int) DB::table('file_storage_settings')->where('id', 1)->value('max_organization_mb'));
    }

    public function test_sao_limits_reject_oversized_files_and_organization_quota(): void
    {
        extract($this->context());
        Sanctum::actingAs($sao);
        $this->putJson('/api/system/file-storage', ['max_file_mb' => 1, 'max_organization_mb' => 10])->assertOk();
        Sanctum::actingAs($admin);
        $this->post('/api/compliance/submissions/'.$submission->id.'/document', ['submitted_at' => $submission->submitted_at->toIso8601String(), 'document' => UploadedFile::fake()->create('too-big.pdf', 2048, 'application/pdf')], ['Accept' => 'application/json'])
            ->assertUnprocessable()->assertJsonValidationErrors('document');
        DB::table('file_storage_settings')->where('id', 1)->update(['max_file_mb' => 10]);
        OrganizationComplianceSubmission::whereKey($submission->id)->update(['file_size' => 10 * 1024 * 1024]);
        $otherType = ComplianceRequirementType::create(['academic_year' => '2026-2027', 'academic_semester_id' => AcademicSemester::active()->id, 'name' => 'Officer List', 'deadline_at' => now()->addMonth(), 'allowed_extensions' => ['pdf'], 'is_active' => true, 'created_by' => $sao->school_id]);
        $this->post('/api/compliance/submissions', ['requirement_type_id' => $otherType->id, 'document' => UploadedFile::fake()->create('extra.pdf', 1024, 'application/pdf')], ['Accept' => 'application/json'])
            ->assertUnprocessable()->assertJsonValidationErrors('document');
        Storage::disk('local')->assertExists($path);
    }
}
