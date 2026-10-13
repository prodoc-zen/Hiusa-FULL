<?php

namespace Tests\Feature;

use App\Mail\PasswordResetMail;
use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\College;
use App\Models\ComplianceRequirementType;
use App\Models\Organization;
use App\Models\OrganizationApplication;
use App\Models\OrganizationComplianceSubmission;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\URL;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OrganizationApplicationTest extends TestCase
{
    use RefreshDatabase;

    private int $requirementId;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        $semester = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'active']);
        $sao = User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->firstOrFail()->id]);
        $this->requirementId = ComplianceRequirementType::create(['academic_year' => $year->label, 'academic_semester_id' => $semester->id, 'name' => 'Constitution', 'deadline_at' => now()->addMonth(), 'is_active' => true, 'created_by' => $sao->school_id])->id;
    }

    private function payload(College $college): array
    {
        return ['college_id' => $college->id, 'name' => 'Computing Council', 'acronym' => 'CC', 'school_id' => 87651234, 'first_name' => 'Alex', 'last_name' => 'Rivera', 'email' => 'alex@example.test', 'position_title' => 'President'];
    }

    private function upload(College $college): array
    {
        return [...$this->payload($college), 'files' => [$this->requirementId => UploadedFile::fake()->create('constitution.pdf', 10, 'application/pdf')]];
    }

    private function attachDocument(OrganizationApplication $application): void
    {
        Storage::disk('local')->put('organization-applications/test/constitution.pdf', '%PDF-1.4');
        $application->documents()->create(['requirement_type_id' => $this->requirementId, 'file_path' => 'organization-applications/test/constitution.pdf', 'file_original_name' => 'constitution.pdf', 'mime_type' => 'application/pdf', 'file_size' => 8]);
    }

    public function test_public_registration_uses_sao_file_types(): void
    {
        Mail::fake();
        $college = College::create(['name' => 'College of Design', 'is_active' => true]);
        ComplianceRequirementType::findOrFail($this->requirementId)->update(['allowed_extensions' => ['png']]);

        $this->getJson('/api/organization-applications/requirements')->assertOk()
            ->assertJsonPath('requirements.0.allowed_extensions.0', 'png');

        $this->post('/api/organization-applications', $this->upload($college), ['Accept' => 'application/json'])
            ->assertUnprocessable()->assertJsonValidationErrors("files.{$this->requirementId}");

        $payload = [...$this->payload($college), 'files' => [$this->requirementId => UploadedFile::fake()->image('constitution.png')]];
        $this->post('/api/organization-applications', $payload, ['Accept' => 'application/json'])->assertCreated();
    }

    public function test_public_registration_exposes_only_current_active_requirement_samples(): void
    {
        $type = ComplianceRequirementType::findOrFail($this->requirementId);
        $type->update(['template_url' => 'https://example.edu/constitution-guide']);
        $this->getJson('/api/organization-applications/requirements')->assertOk()
            ->assertJsonPath('requirements.0.template_url', 'https://example.edu/constitution-guide')
            ->assertJsonPath('requirements.0.template_original_name', null);

        Storage::disk('local')->put('compliance-requirement-templates/sample.pdf', '%PDF-1.4');
        $type->update(['template_url' => null, 'template_path' => 'compliance-requirement-templates/sample.pdf', 'template_original_name' => 'sample.pdf']);
        $this->get("/api/organization-applications/requirements/{$type->id}/template")->assertOk()
            ->assertHeader('Content-Type', 'application/pdf');

        $type->update(['is_active' => false]);
        $this->get("/api/organization-applications/requirements/{$type->id}/template")->assertNotFound();
        $type->update(['is_active' => true, 'name' => ComplianceRequirementType::SEMESTRAL_ACCOMPLISHMENT_REPORT]);
        $this->get("/api/organization-applications/requirements/{$type->id}/template")->assertNotFound();
    }

    public function test_verified_application_requires_own_college_endorsement_before_sao_approval(): void
    {
        Mail::fake();
        $college = College::create(['name' => 'College of Computing', 'is_active' => true]);
        $this->post('/api/organization-applications', $this->upload($college), ['Accept' => 'application/json'])->assertCreated()->assertJsonMissing(['email', 'school_id']);
        $application = OrganizationApplication::firstOrFail();
        $this->assertSame('pending_verification', $application->status);
        $this->assertTrue($application->requires_documents);
        $this->assertSame(1, $application->required_documents_count);
        $this->assertCount(1, $application->documents);
        $this->getJson('/api/organization-applications/'.$application->id.'/verify')->assertForbidden();
        $this->get(URL::temporarySignedRoute('organization-applications.verify', now()->addDay(), ['application' => $application->id]))->assertRedirect();
        $head = User::factory()->departmentHead()->create(['organization_id' => Organization::factory()->create(['college' => $college->name])->id]);
        $sao = User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->firstOrFail()->id]);
        Sanctum::actingAs($sao);
        $this->patchJson('/api/organization-applications/'.$application->id.'/review', ['action' => 'approve'])->assertConflict();
        Sanctum::actingAs(User::factory()->departmentHead()->create(['organization_id' => Organization::factory()->create(['college' => 'Another College'])->id]));
        $this->getJson('/api/organization-applications')->assertOk()->assertJsonCount(0, 'data');
        $this->patchJson('/api/organization-applications/'.$application->id.'/review', ['action' => 'endorse'])->assertNotFound();
        Sanctum::actingAs($head);
        $this->getJson('/api/organization-applications')->assertOk()
            ->assertJsonPath('data.0.documents.0.requirement_type.name', 'Constitution')
            ->assertDontSee('file_path');
        $this->get('/api/organization-applications/'.$application->id.'/documents/'.$application->documents->first()->id)->assertOk();
        $this->patchJson('/api/organization-applications/'.$application->id.'/review', ['action' => 'approve'])->assertUnprocessable()->assertJsonValidationErrors('action');
        $this->patchJson('/api/organization-applications/'.$application->id.'/review', ['action' => 'reject'])->assertUnprocessable()->assertJsonValidationErrors('remarks');
        $this->patchJson('/api/organization-applications/'.$application->id.'/review', ['action' => 'endorse'])->assertOk()->assertJsonPath('status', 'endorsed');
        $this->assertDatabaseHas('notifications', ['user_id' => $sao->school_id, 'reference_type' => 'organization_application', 'reference_id' => $application->id]);
        Sanctum::actingAs($sao);
        $response = $this->patchJson('/api/organization-applications/'.$application->id.'/review', ['action' => 'approve'])->assertOk()->assertJsonPath('status', 'approved')->assertJsonPath('email_sent', true);
        $orgId = $response->json('organization_id');
        $this->assertDatabaseHas('users', ['school_id' => 87651234, 'role' => 'ADMIN', 'organization_id' => $orgId, 'first_name' => 'Alex', 'email' => 'alex@example.test']);
        $this->assertDatabaseHas('account_profiles', ['user_school_id' => 87651234, 'organization_id' => $orgId, 'role' => 'ADMIN']);
        $this->assertDatabaseHas('sbo_positions', ['organization_id' => $orgId, 'role' => 'ADMIN', 'title' => 'President']);
        $this->assertDatabaseHas('organization_compliance_submissions', ['organization_id' => $orgId, 'requirement_type_id' => $this->requirementId, 'status' => 'submitted']);
        $submission = OrganizationComplianceSubmission::where('organization_id', $orgId)->firstOrFail();
        $this->assertStringStartsWith("compliance-submissions/{$orgId}/", $submission->file_path);
        $this->get("/api/compliance/submissions/{$submission->id}/document")->assertOk();
        Mail::assertQueued(PasswordResetMail::class, fn ($mail) => $mail->hasTo('alex@example.test'));
        $this->patchJson('/api/organization-applications/'.$application->id.'/review', ['action' => 'approve'])->assertConflict();
        $this->assertSame(1, Organization::where('name', 'Computing Council')->count());
    }

    public function test_validation_duplicate_applications_expired_links_and_forbidden_roles(): void
    {
        Mail::fake();
        $college = College::create(['name' => 'College of Arts', 'is_active' => true]);
        $this->getJson('/api/organization-applications')->assertUnauthorized();
        $this->postJson('/api/organization-applications', [])->assertUnprocessable()->assertJsonValidationErrors(['name', 'email', 'position_title']);
        $this->post('/api/organization-applications', $this->upload($college), ['Accept' => 'application/json'])->assertCreated();
        $this->post('/api/organization-applications', $this->upload($college), ['Accept' => 'application/json'])->assertUnprocessable()->assertJsonValidationErrors('name');
        $application = OrganizationApplication::firstOrFail();
        $url = URL::temporarySignedRoute('organization-applications.verify', now()->subMinute(), ['application' => $application->id]);
        $this->getJson($url)->assertForbidden();
        foreach (['ADMIN', 'SBO_OFFICER', 'STUDENT'] as $role) {
            Sanctum::actingAs(User::factory()->create(['role' => $role]));
            $this->getJson('/api/organization-applications')->assertForbidden();
            $this->patchJson('/api/organization-applications/'.$application->id.'/review', ['action' => 'approve'])->assertForbidden();
        }
    }

    public function test_public_registration_requires_every_active_sao_pdf_and_rejects_closed_requirements(): void
    {
        Mail::fake();
        $college = College::create(['name' => 'College of Computing', 'is_active' => true]);
        $this->getJson('/api/organization-applications/requirements')->assertOk()
            ->assertJsonPath('academic_semester.number', 1)->assertJsonPath('requirements.0.name', 'Constitution');
        $this->postJson('/api/organization-applications', $this->payload($college))->assertUnprocessable()->assertJsonValidationErrors(['files', "files.{$this->requirementId}"]);
        $this->post('/api/organization-applications', [...$this->payload($college), 'files' => [$this->requirementId => UploadedFile::fake()->create('wrong.png', 10, 'image/png')]], ['Accept' => 'application/json'])
            ->assertUnprocessable()->assertJsonValidationErrors("files.{$this->requirementId}");
        $this->assertDatabaseCount('organization_applications', 0);
        AcademicSemester::query()->update(['status' => 'completed']);
        $this->getJson('/api/organization-applications/requirements')->assertOk()->assertJsonCount(0, 'requirements');
        $this->post('/api/organization-applications', $this->upload($college), ['Accept' => 'application/json'])
            ->assertUnprocessable()->assertJsonPath('message', 'No registration requirements are open. The SAO must activate a semester first.');
    }

    public function test_documents_are_private_and_department_heads_only_see_their_college(): void
    {
        Mail::fake();
        $college = College::create(['name' => 'College of Computing', 'is_active' => true]);
        $this->post('/api/organization-applications', $this->upload($college), ['Accept' => 'application/json'])->assertCreated();
        $application = OrganizationApplication::firstOrFail();
        $document = $application->documents->firstOrFail();
        $url = "/api/organization-applications/{$application->id}/documents/{$document->id}";
        $this->get($url)->assertUnauthorized();
        Sanctum::actingAs(User::factory()->departmentHead()->create(['organization_id' => Organization::factory()->create(['college' => 'Another College'])->id]));
        $this->get($url)->assertNotFound();
        Sanctum::actingAs(User::factory()->student()->create());
        $this->get($url)->assertForbidden();
        Sanctum::actingAs(User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->firstOrFail()->id]));
        $this->get($url)->assertNotFound();
        $other = OrganizationApplication::create([...$this->payload($college), 'name' => 'Other Society', 'acronym' => 'OS', 'status' => 'endorsed', 'email_verified_at' => now()]);
        $this->get("/api/organization-applications/{$other->id}/documents/{$document->id}")->assertNotFound();
        $this->deleteJson('/api/compliance/requirement-types/'.$this->requirementId)->assertConflict();
        $this->assertSame(0, Organization::where('name', 'Computing Council')->count());
    }

    public function test_existing_verified_applicant_receives_a_profile_without_changing_their_login(): void
    {
        Mail::fake();
        $college = College::create(['name' => 'College of Computing', 'is_active' => true]);
        $existing = User::factory()->officer()->create(['school_id' => 87651234, 'email' => 'alex@example.test']);
        $hash = $existing->password_hash;
        $application = OrganizationApplication::create([...$this->payload($college), 'status' => 'endorsed', 'email_verified_at' => now(), 'endorsed_at' => now()]);
        Sanctum::actingAs(User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->firstOrFail()->id]));
        $id = $this->patchJson('/api/organization-applications/'.$application->id.'/review', ['action' => 'approve'])->assertOk()->json('organization_id');
        $this->assertSame($hash, $existing->fresh()->password_hash);
        $this->assertSame('SBO_OFFICER', $existing->fresh()->role);
        $this->assertDatabaseHas('account_profiles', ['user_school_id' => $existing->school_id, 'organization_id' => $id, 'role' => 'ADMIN']);
        Mail::assertNothingQueued();
    }

    public function test_new_applications_cannot_advance_after_a_document_goes_missing(): void
    {
        Mail::fake();
        $college = College::create(['name' => 'College of Computing', 'is_active' => true]);
        $this->post('/api/organization-applications', $this->upload($college), ['Accept' => 'application/json'])->assertCreated();
        $application = OrganizationApplication::firstOrFail();
        $this->get(URL::temporarySignedRoute('organization-applications.verify', now()->addDay(), ['application' => $application->id]))->assertRedirect();
        Storage::disk('local')->delete($application->documents->firstOrFail()->file_path);
        Sanctum::actingAs(User::factory()->departmentHead()->create(['organization_id' => Organization::factory()->create(['college' => $college->name])->id]));
        $this->patchJson('/api/organization-applications/'.$application->id.'/review', ['action' => 'endorse'])->assertConflict();
        $this->assertSame('pending_endorsement', $application->fresh()->status);
        $application->documents()->delete();
        $this->patchJson('/api/organization-applications/'.$application->id.'/review', ['action' => 'endorse'])->assertConflict();
    }

    public function test_unverified_and_inactive_applicants_cannot_receive_admin_access(): void
    {
        Mail::fake();
        $college = College::create(['name' => 'College of Computing', 'is_active' => true]);
        $application = OrganizationApplication::create([...$this->payload($college), 'status' => 'endorsed']);
        Sanctum::actingAs(User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->firstOrFail()->id]));
        $this->patchJson('/api/organization-applications/'.$application->id.'/review', ['action' => 'approve'])->assertConflict();
        $application->update(['email_verified_at' => now()]);
        $this->attachDocument($application);
        User::factory()->officer()->create(['school_id' => 87651234, 'email' => 'alex@example.test', 'account_status' => 'disabled']);
        $this->patchJson('/api/organization-applications/'.$application->id.'/review', ['action' => 'approve'])->assertConflict();
        $this->assertDatabaseMissing('organizations', ['name' => 'Computing Council']);
    }
}
