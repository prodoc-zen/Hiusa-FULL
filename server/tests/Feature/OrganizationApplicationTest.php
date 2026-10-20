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
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
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

    public function test_failed_registration_upload_rolls_back_documents_and_does_not_send_verification_mail(): void
    {
        Mail::fake();
        $college = College::create(['name' => 'College of Computing', 'is_active' => true]);
        $disk = \Mockery::mock(FilesystemAdapter::class);
        $disk->shouldReceive('putFileAs')->once()->andReturn(false);
        $disk->shouldReceive('delete')->andReturn(true);
        Storage::shouldReceive('disk')->with('local')->andReturn($disk);
        $this->post('/api/organization-applications', $this->upload($college), ['Accept' => 'application/json'])->assertStatus(500);
        $this->assertDatabaseCount('organization_applications', 0);
        $this->assertDatabaseCount('organization_application_documents', 0);
        Mail::assertNothingSent();
    }

    private function attachDocument(OrganizationApplication $application): void
    {
        Storage::disk('local')->put('organization-applications/test/constitution.pdf', '%PDF-1.4');
        $application->documents()->create(['requirement_type_id' => $this->requirementId, 'file_path' => 'organization-applications/test/constitution.pdf', 'file_original_name' => 'constitution.pdf', 'mime_type' => 'application/pdf', 'file_size' => 8]);
    }

    private function rejectWithEditLink(College $college): array
    {
        $application = OrganizationApplication::create([
            ...$this->payload($college), 'status' => 'pending_endorsement', 'email_verified_at' => now(),
            'requires_documents' => true, 'required_documents_count' => 1,
        ]);
        $this->attachDocument($application);
        $head = User::factory()->departmentHead()->create(['organization_id' => Organization::factory()->create([
            'college' => $college->name, 'college_id' => $college->id, 'organization_type' => 'COLLEGE',
        ])->id]);
        Sanctum::actingAs($head);
        $this->patchJson('/api/organization-applications/'.$application->id.'/review', [
            'action' => 'reject', 'remarks' => 'Replace the incorrect format.',
        ])->assertOk()->assertJsonPath('status', 'rejected')->assertJsonMissingPath('edit_token_hash');
        $message = Mail::mailer('array')->getSymfonyTransport()->messages()->last()->getOriginalMessage()->getTextBody();
        $this->assertStringContainsString('Replace the incorrect format.', $message);
        $this->assertMatchesRegularExpression('~register-organization/edit/'.$application->id.'\?~', $message);
        preg_match('~https?://[^\s]+/register-organization/edit/'.$application->id.'\?([^\s]+)~', $message, $matches);
        $this->assertNotEmpty($matches[1] ?? null);

        return [$application, '/api/organization-applications/'.$application->id.'/edit?'.$matches[1]];
    }

    public function test_resubmission_loads_existing_documents_once_for_the_entire_checklist(): void
    {
        $college = College::create(['name' => 'College of Computing', 'is_active' => true]);
        [$application, $url] = $this->rejectWithEditLink($college);
        $first = ComplianceRequirementType::findOrFail($this->requirementId);
        for ($index = 1; $index < 10; $index++) {
            $type = $first->replicate();
            $type->name = 'Additional requirement '.$index;
            $type->save();
            $path = 'organization-applications/checklist-'.$index.'.pdf';
            Storage::disk('local')->put($path, '%PDF-1.4');
            $application->documents()->create(['requirement_type_id' => $type->id, 'file_path' => $path, 'file_original_name' => 'document.pdf', 'mime_type' => 'application/pdf', 'file_size' => 8]);
        }
        DB::enableQueryLog();
        try {
            $this->postJson($url, $this->payload($college))->assertOk();
            $reads = collect(DB::getQueryLog())->filter(fn ($query) => str_starts_with($query['query'], 'select') && str_contains($query['query'], 'from "organization_application_documents"'));
            $this->assertCount(1, $reads, 'Checklist document reads must not grow with the number of requirements.');
        } finally {
            DB::disableQueryLog();
        }
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
        $type->update(['is_active' => true, 'category' => 'semestral_report']);
        $this->get("/api/organization-applications/requirements/{$type->id}/template")->assertNotFound();
    }

    public function test_verified_application_requires_own_college_endorsement_before_sao_approval(): void
    {
        Mail::fake();
        $college = College::create(['name' => 'College of Computing', 'is_active' => true]);
        $this->post('/api/organization-applications', $this->upload($college), ['Accept' => 'application/json'])->assertCreated()->assertJsonMissing(['email', 'school_id']);
        $application = OrganizationApplication::firstOrFail();
        $this->assertSame('pending_verification', $application->status);
        $this->assertDatabaseMissing('users', ['school_id' => 87651234]);
        $this->assertDatabaseMissing('account_profiles', ['user_school_id' => 87651234]);
        $this->assertTrue($application->requires_documents);
        $this->assertSame(1, $application->required_documents_count);
        $this->assertCount(1, $application->documents);
        $this->getJson('/api/organization-applications/'.$application->id.'/verify')->assertForbidden();
        $this->get(URL::temporarySignedRoute('organization-applications.verify', now()->addDay(), ['application' => $application->id]))->assertRedirect();
        $head = User::factory()->departmentHead()->create(['organization_id' => Organization::factory()->create(['college' => $college->name, 'college_id' => $college->id, 'organization_type' => 'COLLEGE'])->id]);
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
        $this->assertDatabaseMissing('users', ['school_id' => 87651234]);
        $this->assertDatabaseMissing('account_profiles', ['user_school_id' => 87651234]);
        $this->assertDatabaseHas('notifications', ['user_id' => $sao->school_id, 'reference_type' => 'organization_application', 'reference_id' => $application->id]);
        Sanctum::actingAs($sao);
        $response = $this->patchJson('/api/organization-applications/'.$application->id.'/review', ['action' => 'approve'])->assertOk()->assertJsonPath('status', 'approved')->assertJsonPath('email_sent', true);
        $orgId = $response->json('organization_id');
        $this->assertDatabaseHas('users', ['school_id' => 87651234, 'role' => 'ADMIN', 'organization_id' => $orgId, 'first_name' => 'Alex', 'email' => 'alex@example.test']);
        $this->assertDatabaseHas('account_profiles', ['user_school_id' => 87651234, 'organization_id' => $orgId, 'role' => 'ADMIN']);
        $this->assertDatabaseHas('account_profiles', ['user_school_id' => $head->school_id, 'organization_id' => $head->getRawOriginal('organization_id'), 'role' => 'DEPARTMENT_HEAD']);
        $this->assertDatabaseMissing('account_profiles', ['user_school_id' => $head->school_id, 'organization_id' => $orgId, 'role' => 'DEPARTMENT_HEAD']);
        $this->assertDatabaseHas('sbo_positions', ['organization_id' => $orgId, 'role' => 'ADMIN', 'title' => 'President']);
        $this->assertDatabaseHas('organization_compliance_submissions', ['organization_id' => $orgId, 'requirement_type_id' => $this->requirementId, 'status' => 'submitted']);
        $submission = OrganizationComplianceSubmission::where('organization_id', $orgId)->firstOrFail();
        $this->assertStringStartsWith("compliance-submissions/{$orgId}/", $submission->file_path);
        $this->get("/api/compliance/submissions/{$submission->id}/document")->assertOk();
        Mail::assertQueued(PasswordResetMail::class, fn ($mail) => $mail->hasTo('alex@example.test'));
        $this->patchJson('/api/organization-applications/'.$application->id.'/review', ['action' => 'approve'])->assertConflict();
        $this->assertSame(1, Organization::where('name', 'Computing Council')->count());
        $approvedTracking = URL::temporarySignedRoute('organization-applications.track', now()->addDay(), ['application' => $application->id], absolute: false);
        $this->getJson($approvedTracking)->assertJsonPath('application.status', 'approved')
            ->assertJsonPath('application.remarks', null);
        $this->app['auth']->forgetGuards();
        $headToken = $this->postJson('/api/login', ['school_id' => $head->school_id, 'password' => 'password'])
            ->assertOk()->json('access_token');
        $this->app['auth']->forgetGuards();
        $profiles = $this->withToken($headToken)->getJson('/api/user/profiles')->assertOk()->json('profiles');
        $this->assertCount(1, $profiles);
        $this->assertSame($head->getRawOriginal('organization_id'), $profiles[0]['organization_id']);
        $this->assertSame('DEPARTMENT_HEAD', $profiles[0]['role']);
        $this->app['auth']->forgetGuards();
        $this->withToken($headToken)->getJson('/api/compliance/documents?organization_id='.$orgId)->assertOk();
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
            ->assertUnprocessable()->assertJsonPath('message', 'Registration is closed. SAO must activate a semester and publish its requirements with sample formats.');
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
        Sanctum::actingAs(User::factory()->departmentHead()->create(['organization_id' => Organization::factory()->create(['college' => $college->name, 'college_id' => $college->id, 'organization_type' => 'COLLEGE'])->id]));
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

    public function test_rejection_email_opens_a_private_edit_form_and_resubmission_keeps_existing_files(): void
    {
        $college = College::create(['name' => 'College of Computing', 'is_active' => true]);
        [$application, $url] = $this->rejectWithEditLink($college);
        $originalPath = $application->documents()->firstOrFail()->file_path;

        $response = $this->getJson($url)->assertOk()
            ->assertJsonPath('application.remarks', 'Replace the incorrect format.')
            ->assertJsonPath('requirements.0.current_file.name', 'constitution.pdf')
            ->assertJsonMissingPath('application.edit_token_hash');
        $viewUrl = $response->json('requirements.0.current_file.view_url');
        $this->get('/api'.$viewUrl)->assertOk();

        $fields = $this->payload($college);
        unset($fields['school_id'], $fields['email']);
        $fields['description'] = 'Revised application description.';
        $this->postJson($url, $fields)->assertOk()->assertJsonPath('message', 'Application resubmitted for Department Head endorsement.');
        $this->assertDatabaseHas('organization_applications', [
            'id' => $application->id, 'status' => 'pending_endorsement', 'description' => 'Revised application description.',
            'remarks' => null, 'edit_token_hash' => null,
        ]);
        Storage::disk('local')->assertExists($originalPath);
        $this->getJson($url)->assertNotFound();
        $this->get('/api'.$viewUrl)->assertNotFound();
        $this->postJson($url, $fields)->assertNotFound();
    }

    public function test_rejected_application_can_replace_only_the_files_it_needs_and_cannot_use_an_invalid_link(): void
    {
        $college = College::create(['name' => 'College of Computing', 'is_active' => true]);
        [$application, $url] = $this->rejectWithEditLink($college);
        $oldPath = $application->documents()->firstOrFail()->file_path;
        $fields = $this->payload($college);
        unset($fields['school_id'], $fields['email']);

        $wrong = URL::temporarySignedRoute('organization-applications.edit', now()->addDay(), [
            'application' => $application->id, 'token' => 'someone-elses-token',
        ], absolute: false);
        $this->getJson($wrong)->assertNotFound();
        $expired = URL::temporarySignedRoute('organization-applications.edit', now()->subMinute(), [
            'application' => $application->id, 'token' => 'someone-elses-token',
        ], absolute: false);
        $this->getJson($expired)->assertForbidden();
        $this->postJson($wrong, $fields)->assertNotFound();

        $this->post($url, [...$fields, 'files' => [
            $this->requirementId => UploadedFile::fake()->create('wrong.png', 10, 'image/png'),
        ]], ['Accept' => 'application/json'])->assertUnprocessable()->assertJsonValidationErrors("files.{$this->requirementId}");
        $this->assertSame('rejected', $application->fresh()->status);
        $this->post($url, [...$fields, 'files' => [
            $this->requirementId => UploadedFile::fake()->create('fixed.pdf', 10, 'application/pdf'),
        ]], ['Accept' => 'application/json'])->assertOk();
        $this->assertSame('fixed.pdf', $application->documents()->firstOrFail()->file_original_name);
        Storage::disk('local')->assertMissing($oldPath);
    }

    public function test_rejected_applicant_can_request_a_new_edit_link_for_an_older_rejection(): void
    {
        $college = College::create(['name' => 'College of Computing', 'is_active' => true]);
        $application = OrganizationApplication::create([
            ...$this->payload($college), 'status' => 'rejected', 'email_verified_at' => now(),
            'remarks' => 'Fix the format.', 'requires_documents' => true, 'required_documents_count' => 1,
        ]);
        $this->attachDocument($application);
        $details = ['school_id' => $application->school_id, 'email' => $application->email, 'organization_name' => $application->name];
        $message = 'If those details match a rejected application, we will email a private edit link.';

        $this->postJson('/api/organization-applications/edit-link', [...$details, 'email' => 'wrong@example.test'])
            ->assertOk()->assertJsonPath('message', $message);
        $this->assertNull($application->fresh()->edit_token_hash);
        $this->postJson('/api/organization-applications/edit-link', $details)->assertOk()->assertJsonPath('message', $message);
        $this->assertNotNull($application->fresh()->edit_token_hash);
        $body = Mail::mailer('array')->getSymfonyTransport()->messages()->last()->getOriginalMessage()->getTextBody();
        preg_match('~https?://[^\s]+/register-organization/edit/'.$application->id.'\?([^\s]+)~', $body, $matches);
        $this->assertNotEmpty($matches[1] ?? null);
        $this->getJson('/api/organization-applications/'.$application->id.'/edit?'.$matches[1])
            ->assertOk()->assertJsonPath('application.remarks', 'Fix the format.');
    }

    public function test_applicant_can_track_email_verification_and_request_a_new_private_link(): void
    {
        $college = College::create(['name' => 'College of Computing', 'is_active' => true]);
        $this->post('/api/organization-applications', $this->upload($college), ['Accept' => 'application/json'])->assertCreated();
        $application = OrganizationApplication::firstOrFail();
        $body = Mail::mailer('array')->getSymfonyTransport()->messages()->last()->getOriginalMessage()->getTextBody();
        preg_match('~https?://[^\s]+/track-organization/'.$application->id.'\?([^\s]+)~', $body, $matches);
        $this->assertNotEmpty($matches[1] ?? null);
        $tracking = '/api/organization-applications/'.$application->id.'/track?'.$matches[1];

        $this->getJson($tracking)->assertOk()->assertJsonPath('application.status', 'pending_verification')
            ->assertJsonPath('application.college', $college->name)->assertJsonMissingPath('application.email')
            ->assertJsonMissingPath('application.school_id')->assertJsonMissingPath('application.documents');
        $this->getJson('/api/organization-applications/'.$application->id.'/track')->assertForbidden();
        $other = OrganizationApplication::create([
            ...$this->payload($college), 'name' => 'Other Council', 'acronym' => 'OC', 'school_id' => 12344321,
        ]);
        $this->getJson(str_replace('/'.$application->id.'/track', '/'.$other->id.'/track', $tracking))->assertForbidden();
        $expired = URL::temporarySignedRoute('organization-applications.track', now()->subMinute(), ['application' => $application->id], absolute: false);
        $this->getJson($expired)->assertForbidden();
        $this->get(URL::temporarySignedRoute('organization-applications.verify', now()->addDay(), ['application' => $application->id]))->assertRedirect();
        $this->getJson($tracking)->assertJsonPath('application.status', 'pending_endorsement')
            ->assertJsonPath('application.email_verified_at', $application->fresh()->email_verified_at->toJSON());
        $verifiedMail = Mail::mailer('array')->getSymfonyTransport()->messages()->last()->getOriginalMessage()->getTextBody();
        $this->assertStringContainsString('now with your Department Head', $verifiedMail);
        $this->assertStringContainsString('/track-organization/'.$application->id, $verifiedMail);

        $details = ['school_id' => $application->school_id, 'email' => $application->email, 'organization_name' => $application->name];
        $this->postJson('/api/organization-applications/tracking-link', [])->assertUnprocessable()
            ->assertJsonValidationErrors(['school_id', 'email', 'organization_name']);
        $count = Mail::mailer('array')->getSymfonyTransport()->messages()->count();
        $message = 'If those details match an application, we will email a private tracking link.';
        $this->postJson('/api/organization-applications/tracking-link', [...$details, 'email' => 'wrong@example.test'])
            ->assertOk()->assertJsonPath('message', $message);
        $this->assertSame($count, Mail::mailer('array')->getSymfonyTransport()->messages()->count());
        $this->postJson('/api/organization-applications/tracking-link', $details)->assertOk()->assertJsonPath('message', $message);
        $this->assertSame($count + 1, Mail::mailer('array')->getSymfonyTransport()->messages()->count());
    }

    public function test_tracking_shows_head_and_sao_decisions_without_private_applicant_data(): void
    {
        $college = College::create(['name' => 'College of Computing', 'is_active' => true]);
        $application = OrganizationApplication::create([...$this->payload($college), 'status' => 'pending_endorsement', 'email_verified_at' => now()]);
        $this->attachDocument($application);
        $tracking = URL::temporarySignedRoute('organization-applications.track', now()->addDay(), ['application' => $application->id], absolute: false);
        $head = User::factory()->departmentHead()->create(['organization_id' => Organization::factory()->create([
            'college' => $college->name, 'college_id' => $college->id, 'organization_type' => 'COLLEGE',
        ])->id]);
        Sanctum::actingAs($head);
        $this->patchJson('/api/organization-applications/'.$application->id.'/review', ['action' => 'endorse'])->assertOk();
        $this->getJson($tracking)->assertJsonPath('application.status', 'endorsed')->assertJsonMissingPath('application.email');
        $endorsedMail = Mail::mailer('array')->getSymfonyTransport()->messages()->last()->getOriginalMessage()->getTextBody();
        $this->assertStringContainsString('/track-organization/'.$application->id, $endorsedMail);

        Sanctum::actingAs(User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->firstOrFail()->id]));
        $this->patchJson('/api/organization-applications/'.$application->id.'/review', ['action' => 'reject', 'remarks' => 'Please correct the form.'])->assertOk();
        $this->getJson($tracking)->assertJsonPath('application.status', 'rejected')
            ->assertJsonPath('application.remarks', 'Please correct the form.');
    }

    public function test_redundant_head_profile_is_removed_without_touching_college_access(): void
    {
        $college = College::create(['name' => 'College of Computing', 'is_active' => true]);
        $home = Organization::factory()->create(['college' => $college->name, 'college_id' => $college->id, 'organization_type' => 'COLLEGE']);
        $head = User::factory()->departmentHead()->create(['organization_id' => $home->id]);
        $organization = Organization::factory()->create(['college' => $college->name, 'college_id' => $college->id, 'organization_type' => 'STUDENT_ORGANIZATION']);
        OrganizationApplication::create([...$this->payload($college), 'status' => 'approved', 'email_verified_at' => now(), 'organization_id' => $organization->id]);
        $other = Organization::factory()->create(['college' => $college->name, 'college_id' => $college->id, 'organization_type' => 'STUDENT_ORGANIZATION']);

        $head->accountProfiles()->create(['organization_id' => $organization->id, 'role' => 'DEPARTMENT_HEAD', 'account_status' => 'active']);
        $this->artisan('hiusa:consolidate-department-head-profiles')->assertExitCode(0);
        $this->assertDatabaseHas('account_profiles', ['user_school_id' => $head->school_id, 'organization_id' => $home->id, 'role' => 'DEPARTMENT_HEAD']);
        $this->assertDatabaseMissing('account_profiles', ['user_school_id' => $head->school_id, 'organization_id' => $organization->id]);
        $this->assertDatabaseMissing('account_profiles', ['user_school_id' => $head->school_id, 'organization_id' => $other->id]);
        $this->artisan('hiusa:consolidate-department-head-profiles')->assertExitCode(0);
        $this->assertSame(1, $head->accountProfiles()->count());
    }

    public function test_department_head_role_in_a_student_organization_cannot_review_applications(): void
    {
        $college = College::create(['name' => 'College of Computing', 'is_active' => true]);
        $application = OrganizationApplication::create([...$this->payload($college), 'status' => 'pending_endorsement', 'email_verified_at' => now()]);
        $impostor = User::factory()->departmentHead()->create(['organization_id' => Organization::factory()->create([
            'college' => $college->name, 'college_id' => $college->id, 'organization_type' => 'STUDENT_ORGANIZATION',
        ])->id]);
        Sanctum::actingAs($impostor);
        $this->getJson('/api/organization-applications')->assertOk()->assertJsonCount(0, 'data');
        $this->patchJson('/api/organization-applications/'.$application->id.'/review', ['action' => 'endorse'])->assertNotFound();
    }
}
