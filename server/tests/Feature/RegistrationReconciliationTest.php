<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\AuditLog;
use App\Models\College;
use App\Models\ComplianceRequirementType;
use App\Models\Organization;
use App\Models\OrganizationApplication;
use App\Models\OrganizationComplianceSubmission;
use App\Models\User;
use App\Services\Compliance\AccreditationStatusService;
use App\Services\Compliance\RegistrationRequirementCatalog;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class RegistrationReconciliationTest extends TestCase
{
    use RefreshDatabase;

    private AcademicSemester $semester;

    private User $sao;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        $this->sao = User::factory()->superAdmin()->create();
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        $this->semester = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'active']);
        foreach (RegistrationRequirementCatalog::NAMES as $name) {
            ComplianceRequirementType::create(['name' => $name, 'academic_year' => $year->label, 'academic_semester_id' => $this->semester->id, 'deadline_at' => $this->semester->ends_on, 'is_active' => true, 'created_by' => $this->sao->school_id, 'template_url' => 'https://example.edu/sample']);
        }
    }

    private function approvedApplication(): array
    {
        $organization = Organization::factory()->create(['reviewed_by' => $this->sao->school_id, 'reviewed_at' => now()->subDay()]);
        $college = College::create(['name' => 'Test College', 'is_active' => true]);
        $application = OrganizationApplication::create(['college_id' => $college->id, 'organization_id' => $organization->id, 'name' => $organization->name, 'acronym' => $organization->acronym, 'school_id' => 78781234, 'first_name' => 'Applicant', 'last_name' => 'Account', 'email' => 'applicant@example.test', 'position_title' => 'President', 'status' => 'approved', 'reviewed_by' => $this->sao->school_id, 'reviewed_at' => now()->subDay(), 'email_verified_at' => now()->subDays(2)]);
        $type = ComplianceRequirementType::where('name', 'Letter of Intent')->sole();
        Storage::disk('local')->put('original.pdf', '%PDF-1.4 approved application');
        Storage::disk('local')->put('copy.pdf', '%PDF-1.4 approved application');
        $application->documents()->create(['requirement_type_id' => $type->id, 'file_path' => 'original.pdf', 'file_original_name' => 'intent.pdf', 'mime_type' => 'application/pdf', 'file_size' => 29]);
        $submission = OrganizationComplianceSubmission::create(['organization_id' => $organization->id, 'requirement_type_id' => $type->id, 'status' => 'submitted', 'file_path' => 'copy.pdf', 'file_original_name' => 'intent.pdf', 'mime_type' => 'application/pdf', 'file_size' => 29, 'is_registration_document' => true, 'submitted_by' => $this->sao->school_id, 'submitted_at' => now()->subDay()]);

        return [$application, $submission];
    }

    public function test_dry_run_is_read_only_and_apply_recovers_recorded_approval_idempotently(): void
    {
        [$application, $submission] = $this->approvedApplication();
        $this->artisan('hiusa:reconcile-registration-requirements')->assertSuccessful();
        $this->assertSame('submitted', $submission->fresh()->status);
        $this->assertSame(0, AuditLog::where('action', 'registration_requirements_reconciled')->count());
        $this->artisan('hiusa:reconcile-registration-requirements --apply')->assertSuccessful();
        $this->assertSame('approved', $submission->fresh()->status);
        $this->assertSame($application->reviewed_by, $submission->fresh()->reviewed_by);
        $this->assertTrue($submission->fresh()->reviewed_at->equalTo($application->reviewed_at));
        $this->artisan('hiusa:reconcile-registration-requirements --apply')->assertSuccessful();
        $this->assertSame(1, AuditLog::where('action', 'registration_requirements_reconciled')->count());
        $this->assertSame(['copy.pdf', 'original.pdf'], Storage::disk('local')->allFiles());
    }

    public function test_replacement_and_changed_or_missing_files_are_not_auto_approved(): void
    {
        [, $submission] = $this->approvedApplication();
        $submission->update(['submitted_at' => now()]);
        $this->artisan('hiusa:reconcile-registration-requirements --apply')->assertSuccessful();
        $this->assertSame('submitted', $submission->fresh()->status);
        $submission->update(['submitted_at' => now()->subDay()]);
        Storage::disk('local')->put('copy.pdf', '%PDF-1.4 changed file');
        $this->artisan('hiusa:reconcile-registration-requirements --apply')->assertSuccessful();
        $this->assertSame('submitted', $submission->fresh()->status);
        Storage::disk('local')->delete('original.pdf');
        $this->artisan('hiusa:reconcile-registration-requirements --apply')->assertSuccessful();
        $this->assertSame('submitted', $submission->fresh()->status);
    }

    public function test_legacy_alias_links_keep_submission_id_file_review_and_sample_without_duplicates(): void
    {
        $legacy = ComplianceRequirementType::create(['name' => 'Constitution and By-Laws', 'academic_year' => '2026-2027', 'deadline_at' => now()->addMonth(), 'is_active' => true, 'created_by' => $this->sao->school_id, 'template_url' => 'https://example.edu/legacy-sample']);
        $target = ComplianceRequirementType::where('name', 'Constitutional By-Laws')->sole();
        $organization = Organization::factory()->create();
        Storage::disk('local')->put('constitution.pdf', 'existing file');
        $submission = OrganizationComplianceSubmission::create(['organization_id' => $organization->id, 'requirement_type_id' => $legacy->id, 'status' => 'approved', 'file_path' => 'constitution.pdf', 'file_original_name' => 'constitution.pdf', 'mime_type' => 'application/pdf', 'file_size' => 13, 'submitted_by' => $this->sao->school_id, 'submitted_at' => now()->subDay(), 'reviewed_by' => $this->sao->school_id, 'reviewed_at' => now()]);
        $this->artisan('hiusa:reconcile-registration-requirements --apply')->assertSuccessful();
        $this->assertSame($target->id, $submission->fresh()->requirement_type_id);
        $this->assertSame('approved', $submission->fresh()->status);
        $this->assertSame('constitution.pdf', $submission->fresh()->file_path);
        $this->assertFalse($legacy->fresh()->is_active);
        $this->assertSame('https://example.edu/legacy-sample', $legacy->fresh()->template_url);
        $this->assertDatabaseCount('organization_compliance_submissions', 1);
        $this->assertSame(10, ComplianceRequirementType::where('category', 'organization')->where('is_active', true)->count());
        $this->artisan('hiusa:reconcile-registration-requirements --apply')->assertSuccessful();
        $this->assertDatabaseCount('organization_compliance_submissions', 1);
    }

    public function test_canonical_duplicate_names_are_rejected_and_sample_formats_are_still_required(): void
    {
        Sanctum::actingAs($this->sao);
        $payload = ['academic_year' => '2026-2027', 'name' => 'Constitution and By-Laws', 'deadline_at' => now()->addMonth()->toISOString(), 'template_url' => 'https://example.edu/sample'];
        $this->postJson('/api/compliance/requirement-types', $payload)->assertUnprocessable()->assertJsonValidationErrors('name');
        $legacy = ComplianceRequirementType::create(['name' => 'List of Officers', 'academic_year' => '2026-2027', 'deadline_at' => now()->addMonth(), 'is_active' => false, 'created_by' => $this->sao->school_id, 'template_url' => 'https://example.edu/old-sample']);
        $this->putJson('/api/compliance/requirement-types/'.$legacy->id, ['is_active' => true])->assertUnprocessable()->assertJsonValidationErrors('name');
        $this->postJson('/api/compliance/requirement-types', [...$payload, 'name' => 'Additional document', 'template_url' => null])->assertUnprocessable()->assertJsonValidationErrors('template');
        $this->assertSame(10, ComplianceRequirementType::where('is_active', true)->count());
    }

    public function test_accreditation_counts_the_ten_organization_requirements_and_keeps_reports_separate(): void
    {
        $organization = Organization::factory()->create();
        foreach (ComplianceRequirementType::all() as $type) {
            OrganizationComplianceSubmission::create(['organization_id' => $organization->id, 'requirement_type_id' => $type->id, 'status' => 'approved', 'file_path' => 'existing.pdf', 'file_original_name' => 'existing.pdf', 'mime_type' => 'application/pdf', 'file_size' => 10, 'submitted_by' => $this->sao->school_id, 'submitted_at' => now(), 'reviewed_by' => $this->sao->school_id, 'reviewed_at' => now()]);
        }
        ComplianceRequirementType::create(['name' => ComplianceRequirementType::SEMESTRAL_ACCOMPLISHMENT_REPORT, 'academic_year' => '2026-2027', 'academic_semester_id' => $this->semester->id, 'deadline_at' => now()->addMonth(), 'is_active' => true, 'created_by' => $this->sao->school_id]);
        Sanctum::actingAs($this->sao);
        $this->getJson('/api/compliance/status?organization_id='.$organization->id)->assertOk()->assertJsonCount(10, 'organizations.0.requirements')->assertJsonPath('organizations.0.accreditation_status', 'accredited');
        $this->assertSame('accredited', app(AccreditationStatusService::class)->forOrganization($organization->id));
        $this->getJson('/api/compliance/status?organization_id='.$organization->id.'&category=semestral_report')->assertOk()->assertJsonCount(1, 'organizations.0.requirements')->assertJsonPath('organizations.0.accreditation_status', 'incomplete');
    }

    public function test_active_registration_files_can_be_reviewed_by_sao_but_not_an_admin(): void
    {
        [, $submission] = $this->approvedApplication();
        $payload = ['status' => 'returned', 'remarks' => 'Use the current roster.', 'submitted_at' => $submission->submitted_at->toISOString()];
        Sanctum::actingAs(User::factory()->admin()->create(['organization_id' => $submission->organization_id]));
        $this->patchJson('/api/compliance/submissions/'.$submission->id.'/review', $payload)->assertForbidden();
        Sanctum::actingAs($this->sao);
        $this->patchJson('/api/compliance/submissions/'.$submission->id.'/review', [...$payload, 'remarks' => null])->assertUnprocessable();
        $this->patchJson('/api/compliance/submissions/'.$submission->id.'/review', $payload)->assertOk()->assertJsonPath('status', 'returned');
        $this->patchJson('/api/compliance/submissions/'.$submission->id.'/review', ['status' => 'approved', 'submitted_at' => $payload['submitted_at']])->assertConflict();
    }
}
