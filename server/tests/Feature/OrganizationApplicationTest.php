<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\AccountProfile;
use App\Models\College;
use App\Models\ComplianceRequirementType;
use App\Models\Organization;
use App\Models\OrganizationApplicantGrant;
use App\Models\OrganizationApplication;
use App\Models\OrganizationApplicationReviewFile;
use App\Models\OrganizationComplianceSubmission;
use App\Models\User;
use App\Services\OrganizationDeletionService;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OrganizationApplicationTest extends TestCase
{
    use RefreshDatabase;

    private int $requirementId;

    private User $sao;

    private AcademicSemester $semester;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        $this->semester = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'active']);
        $this->sao = User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->firstOrFail()->id]);
        $this->requirementId = ComplianceRequirementType::create(['academic_year' => $year->label, 'academic_semester_id' => $this->semester->id, 'name' => 'Constitution', 'deadline_at' => now()->addMonth(), 'is_active' => true, 'created_by' => $this->sao->school_id])->id;
    }

    private function college(string $name = 'College of Computing'): College
    {
        return College::create(['name' => $name, 'is_active' => true]);
    }

    private function home(College $college): Organization
    {
        return Organization::where('college_id', $college->id)->where('organization_type', 'COLLEGE')->first()
            ?? Organization::factory()->create(['college' => $college->name, 'college_id' => $college->id, 'organization_type' => 'COLLEGE']);
    }

    private function dean(College $college): User
    {
        return User::factory()->departmentHead()->create(['organization_id' => $this->home($college)->id]);
    }

    private function student(College $college, ?int $homeId = null): User
    {
        return User::factory()->student()->create(['organization_id' => $homeId ?? $this->home($college)->id]);
    }

    private function grant(College $college, User $student, array $extra = []): OrganizationApplicantGrant
    {
        return OrganizationApplicantGrant::create(['college_id' => $college->id, 'user_school_id' => $student->school_id, 'granted_by' => $this->sao->school_id, ...$extra]);
    }

    private function form(array $extra = []): array
    {
        return ['name' => 'Computing Council', 'acronym' => 'CC', 'position_title' => 'President', 'files' => [$this->requirementId => UploadedFile::fake()->create('constitution.pdf', 10, 'application/pdf')], ...$extra];
    }

    private function apply(User $student, array $extra = [])
    {
        Sanctum::actingAs($student);

        return $this->post('/api/my/organization-applications', $this->form($extra), ['Accept' => 'application/json']);
    }

    /** An application the student already submitted, ready for the dean. */
    private function submitted(College $college, User $student, string $status = 'pending_dean'): OrganizationApplication
    {
        $grant = $this->grant($college, $student);
        $application = OrganizationApplication::create([
            'college_id' => $college->id, 'name' => 'Computing Council', 'acronym' => 'CC', 'school_id' => $student->school_id, 'first_name' => $student->first_name,
            'last_name' => $student->last_name, 'email' => $student->email, 'position_title' => 'President', 'status' => $status, 'round' => 1, 'submitted_at' => now(),
            'requires_documents' => true, 'required_documents_count' => 1,
        ]);
        Storage::disk('local')->put("organization-applications/{$application->id}/constitution.pdf", '%PDF-1.4');
        $application->documents()->create(['requirement_type_id' => $this->requirementId, 'file_path' => "organization-applications/{$application->id}/constitution.pdf", 'file_original_name' => 'constitution.pdf', 'mime_type' => 'application/pdf', 'file_size' => 8]);
        $grant->update(['used_application_id' => $application->id]);

        return $application;
    }

    private function review(OrganizationApplication $application, array $payload)
    {
        return $this->patchJson("/api/organization-applications/{$application->id}/review", $payload);
    }

    public function test_the_public_form_tracking_and_edit_links_are_gone(): void
    {
        $this->getJson('/api/organization-applications/colleges')->assertUnauthorized();
        $this->getJson('/api/organization-applications/requirements')->assertUnauthorized();
        $this->getJson('/api/organization-applications/1/track')->assertNotFound();
        $this->assertContains($this->postJson('/api/organization-applications', $this->form())->status(), [401, 404, 405]);
        $this->assertContains($this->postJson('/api/organization-applications/edit-link', [])->status(), [401, 404, 405]);
        $this->assertContains($this->postJson('/api/organization-applications/tracking-link', [])->status(), [401, 404, 405]);
        $this->getJson('/api/my/organization-applications')->assertUnauthorized();
    }

    public function test_a_student_without_a_grant_cannot_apply_and_is_told_so(): void
    {
        $college = $this->college();
        $student = $this->student($college);
        $this->apply($student)->assertForbidden();
        $this->assertDatabaseCount('organization_applications', 0);
        $this->getJson('/api/my/organization-applications')->assertOk()->assertJsonPath('can_apply', false)->assertJsonPath('requirements', []);

        $this->grant($college, $student, ['revoked_at' => now()]);
        $this->apply($student)->assertForbidden();
        $this->grant($college, $this->student($college));
        $this->apply($student)->assertForbidden();
        $this->assertDatabaseCount('organization_applications', 0);
    }

    public function test_a_student_already_in_a_student_organization_cannot_apply_even_with_an_open_grant(): void
    {
        $college = $this->college();
        $student = $this->student($college);
        $this->grant($college, $student);
        $organization = Organization::factory()->create(['name' => 'Computing Council Alumni', 'college' => $college->name, 'college_id' => $college->id, 'organization_type' => 'STUDENT_ORGANIZATION']);
        AccountProfile::create(['user_school_id' => $student->school_id, 'organization_id' => $organization->id, 'role' => 'STUDENT', 'account_status' => 'active']);

        $this->apply($student)->assertUnprocessable()->assertJsonPath('message', 'This student already belongs to Computing Council Alumni.');
        $this->assertDatabaseCount('organization_applications', 0);
        $this->assertDatabaseHas('organization_applicant_grants', ['user_school_id' => $student->school_id, 'used_application_id' => null]);
        $this->getJson('/api/my/organization-applications')->assertOk()->assertJsonPath('can_apply', false);
    }

    public function test_the_application_takes_identity_and_college_from_the_account_and_the_grant(): void
    {
        Mail::fake();
        $college = $this->college();
        $other = $this->college('College of Arts');
        $dean = $this->dean($college);
        $student = $this->student($college);
        $grant = $this->grant($college, $student);

        $this->getJson('/api/my/organization-applications')->assertUnauthorized();
        Sanctum::actingAs($student);
        $this->getJson('/api/my/organization-applications')->assertOk()->assertJsonPath('can_apply', true)->assertJsonPath('college.id', $college->id)
            ->assertJsonPath('requirements.0.name', 'Constitution');

        $response = $this->apply($student, ['college_id' => $other->id, 'school_id' => 11111111, 'first_name' => 'Someone', 'email' => 'someone@example.test'])->assertCreated()
            ->assertJsonPath('status', 'pending_dean')->assertJsonPath('college.id', $college->id)->assertJsonPath('applicant.school_id', $student->school_id)
            ->assertJsonMissingPath('documents.0.file_path')->assertDontSee('file_path');
        $application = OrganizationApplication::findOrFail($response->json('id'));
        $this->assertSame($college->id, $application->college_id);
        $this->assertSame($student->school_id, $application->school_id);
        $this->assertSame($student->first_name, $application->first_name);
        $this->assertSame($student->email, $application->email);
        $this->assertSame($application->id, $grant->fresh()->used_application_id);
        $this->assertCount(1, $application->documents);
        $this->assertDatabaseHas('notifications', ['user_id' => $dean->school_id, 'reference_type' => 'organization_application', 'reference_id' => $application->id]);
        Mail::assertNothingSent();
        Mail::assertNothingQueued();

        $this->apply($student, ['name' => 'Second Council', 'acronym' => 'SC'])->assertForbidden();
        $this->assertDatabaseCount('organization_applications', 1);
        $this->getJson('/api/my/organization-applications')->assertOk()->assertJsonPath('can_apply', false)->assertJsonPath('applications.0.id', $application->id);
    }

    public function test_a_failed_upload_rolls_back_and_keeps_the_grant_open(): void
    {
        $college = $this->college();
        $student = $this->student($college);
        $grant = $this->grant($college, $student);
        Sanctum::actingAs($student);
        $disk = \Mockery::mock(FilesystemAdapter::class);
        $disk->shouldReceive('putFileAs')->once()->andReturn(false);
        $disk->shouldReceive('delete')->andReturn(true);
        Storage::shouldReceive('disk')->with('local')->andReturn($disk);
        $this->post('/api/my/organization-applications', $this->form(), ['Accept' => 'application/json'])->assertStatus(500);
        $this->assertDatabaseCount('organization_applications', 0);
        $this->assertDatabaseCount('organization_application_documents', 0);
        $this->assertNull($grant->fresh()->used_application_id);
    }

    public function test_requirements_follow_the_sao_setup_and_every_one_must_be_attached(): void
    {
        $college = $this->college();
        $student = $this->student($college);
        $this->grant($college, $student);
        ComplianceRequirementType::findOrFail($this->requirementId)->update(['allowed_extensions' => ['png'], 'template_url' => 'https://example.edu/constitution-guide']);

        Sanctum::actingAs($student);
        $this->getJson('/api/my/organization-applications')->assertOk()
            ->assertJsonPath('requirements.0.allowed_extensions.0', 'png')->assertJsonPath('requirements.0.template_url', 'https://example.edu/constitution-guide');
        $this->apply($student)->assertUnprocessable()->assertJsonValidationErrors("files.{$this->requirementId}");
        $this->post('/api/my/organization-applications', ['name' => 'Computing Council', 'acronym' => 'CC', 'position_title' => 'President'], ['Accept' => 'application/json'])
            ->assertUnprocessable()->assertJsonValidationErrors('files');
        $this->post('/api/my/organization-applications', $this->form(['files' => [$this->requirementId => UploadedFile::fake()->image('constitution.png')]]), ['Accept' => 'application/json'])->assertCreated();
    }

    public function test_applications_are_closed_without_an_active_semester(): void
    {
        $college = $this->college();
        $student = $this->student($college);
        $this->grant($college, $student);
        $this->semester->update(['status' => 'completed']);
        $this->apply($student)->assertUnprocessable()->assertJsonPath('message', fn ($message) => str_contains($message, 'closed'));
        $this->assertDatabaseCount('organization_applications', 0);
    }

    public function test_requirement_samples_open_for_signed_in_students_only(): void
    {
        $type = ComplianceRequirementType::findOrFail($this->requirementId);
        Storage::disk('local')->put('compliance-requirement-templates/sample.pdf', '%PDF-1.4');
        $type->update(['template_url' => null, 'template_path' => 'compliance-requirement-templates/sample.pdf', 'template_original_name' => 'sample.pdf']);
        $this->get("/api/my/organization-applications/requirements/{$type->id}/template")->assertUnauthorized();
        Sanctum::actingAs($this->student($this->college()));
        $this->get("/api/my/organization-applications/requirements/{$type->id}/template")->assertOk()->assertHeader('Content-Type', 'application/pdf');
        $type->update(['is_active' => false]);
        $this->get("/api/my/organization-applications/requirements/{$type->id}/template")->assertNotFound();
    }

    public function test_a_duplicate_name_or_acronym_is_refused_while_another_application_is_open(): void
    {
        $college = $this->college();
        $first = $this->student($college);
        $this->submitted($college, $first);
        $second = $this->student($college);
        $this->grant($college, $second);
        $this->apply($second)->assertUnprocessable()->assertJsonValidationErrors('name');
        $this->assertDatabaseCount('organization_applications', 1);
    }

    public function test_dean_endorses_then_sao_approves_and_the_applicant_gets_a_profile_not_a_new_login(): void
    {
        Mail::fake();
        $college = $this->college();
        $dean = $this->dean($college);
        $student = $this->student($college);
        $homeId = $student->getRawOriginal('organization_id');
        $application = $this->submitted($college, $student);

        Sanctum::actingAs($this->sao);
        $this->review($application, ['action' => 'approve'])->assertConflict();
        Sanctum::actingAs($dean);
        $this->review($application, ['action' => 'approve'])->assertUnprocessable()->assertJsonValidationErrors('action');
        $this->review($application, ['action' => 'reject', 'remarks' => 'No'])->assertUnprocessable()->assertJsonValidationErrors('action');
        $this->review($application, ['action' => 'endorse', 'remarks' => 'Good constitution.'])->assertOk()->assertJsonPath('status', 'pending_sao')->assertJsonPath('endorsement_note', 'Good constitution.');
        $this->review($application, ['action' => 'endorse'])->assertConflict();
        $this->assertDatabaseHas('notifications', ['user_id' => $this->sao->school_id, 'reference_type' => 'organization_application', 'reference_id' => $application->id]);
        $this->assertDatabaseHas('notifications', ['user_id' => $student->school_id, 'reference_type' => 'organization_application', 'title' => 'Your application is with the SAO']);

        Sanctum::actingAs($this->sao);
        $response = $this->review($application, ['action' => 'approve'])->assertOk()->assertJsonPath('status', 'approved');
        $orgId = $response->json('organization_id');
        $organization = Organization::findOrFail($orgId);
        $this->assertSame($college->id, $organization->college_id);
        $this->assertSame('STUDENT_ORGANIZATION', $organization->organization_type);
        $this->assertSame('active', $organization->lifecycle_status);
        $this->assertSame($student->school_id, (int) $organization->submitted_by);
        $this->assertDatabaseHas('account_profiles', ['user_school_id' => $student->school_id, 'organization_id' => $orgId, 'role' => 'ADMIN', 'account_status' => 'active', 'position_title' => 'President']);
        $this->assertDatabaseHas('sbo_positions', ['organization_id' => $orgId, 'role' => 'ADMIN', 'title' => 'President']);
        $login = DB::table('users')->where('school_id', $student->school_id)->first();
        $this->assertSame($homeId, $login->organization_id);
        $this->assertSame('STUDENT', $login->role);
        $this->assertSame($student->password_hash, $login->password_hash);
        $this->assertSame(1, User::where('school_id', $student->school_id)->count());
        $this->assertDatabaseHas('organization_compliance_submissions', ['organization_id' => $orgId, 'requirement_type_id' => $this->requirementId, 'status' => 'approved', 'reviewed_by' => $this->sao->school_id]);
        $submission = OrganizationComplianceSubmission::where('organization_id', $orgId)->firstOrFail();
        $this->assertStringStartsWith("compliance-submissions/{$orgId}/", $submission->file_path);
        $this->get("/api/compliance/submissions/{$submission->id}/document")->assertOk();
        $this->assertSame($application->id, OrganizationApplicantGrant::where('user_school_id', $student->school_id)->value('used_application_id'));
        $this->assertDatabaseHas('notifications', ['user_id' => $student->school_id, 'title' => 'Computing Council was approved']);
        Mail::assertNothingSent();
        $this->review($application, ['action' => 'approve'])->assertConflict();
        $this->assertSame(1, Organization::where('name', 'Computing Council')->count());
    }

    public function test_an_applicant_with_no_account_or_an_inactive_one_cannot_be_approved(): void
    {
        $college = $this->college();
        $student = $this->student($college);
        $application = $this->submitted($college, $student, 'pending_sao');
        $student->update(['account_status' => 'disabled']);
        Sanctum::actingAs($this->sao);
        $this->review($application, ['action' => 'approve'])->assertConflict();
        $this->assertSame(0, Organization::where('name', 'Computing Council')->count());

        $legacy = OrganizationApplication::create(['college_id' => $college->id, 'name' => 'Legacy Guild', 'acronym' => 'LG', 'school_id' => 87000001, 'first_name' => 'No', 'last_name' => 'Account', 'email' => 'legacy@example.test', 'position_title' => 'President', 'status' => 'pending_sao', 'round' => 1, 'requires_documents' => false]);
        $this->review($legacy, ['action' => 'approve'])->assertConflict()->assertJsonPath('message', fn ($message) => str_contains($message, 'no HIUSA account'));
        $this->assertDatabaseMissing('users', ['school_id' => 87000001]);
    }

    public function test_approval_stops_when_a_document_goes_missing(): void
    {
        $college = $this->college();
        $application = $this->submitted($college, $this->student($college), 'pending_sao');
        Storage::disk('local')->delete("organization-applications/{$application->id}/constitution.pdf");
        Sanctum::actingAs($this->sao);
        $this->review($application, ['action' => 'approve'])->assertConflict();
        $this->assertSame('pending_sao', $application->fresh()->status);
    }

    public function test_requirement_notes_travel_with_a_return_and_the_applicant_sends_it_again_to_the_dean(): void
    {
        $college = $this->college();
        $dean = $this->dean($college);
        $student = $this->student($college);
        $application = $this->submitted($college, $student);
        $notes = ['requirements' => [['requirement_type_id' => $this->requirementId, 'status' => 'needs_changes', 'note' => 'Sign the last page.']]];

        Sanctum::actingAs($dean);
        $this->review($application, ['action' => 'endorse', ...$notes])->assertUnprocessable()->assertJsonValidationErrors('requirements');
        $this->review($application, ['action' => 'return'])->assertUnprocessable()->assertJsonValidationErrors('remarks');
        $this->review($application, ['action' => 'return', 'requirements' => [['requirement_type_id' => 999999, 'status' => 'missing']]])->assertUnprocessable()->assertJsonValidationErrors('requirements');
        $this->review($application, ['action' => 'return', 'remarks' => 'Please fix the constitution.', ...$notes])->assertOk()
            ->assertJsonPath('status', 'returned')->assertJsonPath('requirements.0.reviews.0.status', 'needs_changes')->assertJsonPath('requirements.0.reviews.0.stage', 'dean');
        $application->refresh();
        $this->assertSame($dean->school_id, (int) $application->returned_by);
        $this->assertSame('DEPARTMENT_HEAD', $application->returned_by_role);
        $this->assertNotNull($application->returned_at);

        Sanctum::actingAs($student);
        $this->getJson("/api/my/organization-applications/{$application->id}")->assertOk()
            ->assertJsonPath('status', 'returned')->assertJsonPath('returned_by_role', 'DEPARTMENT_HEAD')->assertJsonPath('remarks', 'Please fix the constitution.')
            ->assertJsonPath('requirements.0.reviews.0.note', 'Sign the last page.')->assertJsonPath('requirements.0.reviews.0.stage_label', 'Department Head');
        $this->assertDatabaseHas('notifications', ['user_id' => $student->school_id, 'title' => 'Your application was returned']);

        $this->post("/api/my/organization-applications/{$application->id}/resubmit", ['name' => 'Computing Council', 'acronym' => 'CC', 'position_title' => 'Chairperson'], ['Accept' => 'application/json'])
            ->assertOk()->assertJsonPath('status', 'pending_dean')->assertJsonPath('round', 2)->assertJsonPath('position_title', 'Chairperson')
            ->assertJsonPath('requirements.0.reviews', [])->assertJsonPath('requirements.0.document.name', 'constitution.pdf');
        $application->refresh();
        $this->assertNull($application->returned_by);
        $this->assertNull($application->remarks);
        $this->assertSame(1, $application->requirementReviews()->where('round', 1)->count());
        $this->post("/api/my/organization-applications/{$application->id}/resubmit", ['name' => 'Computing Council', 'acronym' => 'CC', 'position_title' => 'President'], ['Accept' => 'application/json'])->assertConflict();
    }

    public function test_the_sao_can_return_a_whole_application_and_the_resubmission_goes_back_to_the_dean(): void
    {
        $college = $this->college();
        $student = $this->student($college);
        $application = $this->submitted($college, $student, 'pending_sao');
        Sanctum::actingAs($this->sao);
        $this->review($application, ['action' => 'return', 'remarks' => 'Add your adviser.', 'requirements' => [['requirement_type_id' => $this->requirementId, 'status' => 'missing', 'note' => 'No adviser named.']]])->assertOk()->assertJsonPath('status', 'returned');
        $this->assertSame('SUPER_ADMIN', $application->fresh()->returned_by_role);
        $this->assertSame($this->sao->school_id, (int) $application->fresh()->returned_by);

        Sanctum::actingAs($student);
        $replacement = UploadedFile::fake()->create('constitution-v2.pdf', 10, 'application/pdf');
        $this->post("/api/my/organization-applications/{$application->id}/resubmit", ['name' => 'Computing Council', 'acronym' => 'CC', 'position_title' => 'President', 'files' => [$this->requirementId => $replacement]], ['Accept' => 'application/json'])
            ->assertOk()->assertJsonPath('status', 'pending_dean')->assertJsonPath('requirements.0.document.name', 'constitution-v2.pdf');
        $this->assertCount(1, $application->fresh()->documents);
    }

    public function test_the_sao_rejects_with_a_reason_and_that_is_final(): void
    {
        $college = $this->college();
        $student = $this->student($college);
        $application = $this->submitted($college, $student, 'pending_sao');
        Sanctum::actingAs($this->sao);
        $this->review($application, ['action' => 'reject'])->assertUnprocessable()->assertJsonValidationErrors('remarks');
        $this->review($application, ['action' => 'reject', 'remarks' => 'An organization with this purpose already exists.'])->assertOk()->assertJsonPath('status', 'rejected');
        $this->review($application, ['action' => 'return', 'remarks' => 'Try again'])->assertConflict();
        Sanctum::actingAs($student);
        $this->post("/api/my/organization-applications/{$application->id}/resubmit", ['name' => 'Computing Council', 'acronym' => 'CC', 'position_title' => 'President'], ['Accept' => 'application/json'])->assertConflict();
        $this->getJson("/api/my/organization-applications/{$application->id}")->assertOk()->assertJsonPath('remarks', 'An organization with this purpose already exists.');
    }

    public function test_review_files_stay_private_to_the_applicant_and_the_reviewers_of_their_college(): void
    {
        $college = $this->college();
        $dean = $this->dean($college);
        $student = $this->student($college);
        $application = $this->submitted($college, $student);

        Sanctum::actingAs($this->sao);
        $this->post("/api/organization-applications/{$application->id}/review-files", ['file' => UploadedFile::fake()->create('annotated.pdf', 10, 'application/pdf')], ['Accept' => 'application/json'])->assertConflict();

        Sanctum::actingAs($dean);
        $this->post("/api/organization-applications/{$application->id}/review-files", ['file' => UploadedFile::fake()->create('script.php', 10)], ['Accept' => 'application/json'])->assertUnprocessable();
        $upload = $this->post("/api/organization-applications/{$application->id}/review-files", ['file' => UploadedFile::fake()->create('annotated.pdf', 10, 'application/pdf'), 'requirement_type_id' => $this->requirementId], ['Accept' => 'application/json'])
            ->assertCreated()->assertJsonPath('stage', 'dean')->assertJsonPath('name', 'annotated.pdf')->assertDontSee('file_path');
        $file = OrganizationApplicationReviewFile::findOrFail($upload->json('id'));
        $this->assertStringStartsWith("organization-application-reviews/{$application->id}/", $file->file_path);
        Storage::disk('local')->assertExists($file->file_path);
        Storage::disk('public')->assertMissing($file->file_path);
        $this->get('/api'.$upload->json('open_url'))->assertOk();
        $this->getJson("/api/organization-applications/{$application->id}")->assertOk()->assertJsonPath('requirements.0.review_files.0.name', 'annotated.pdf')->assertDontSee('file_path');

        Sanctum::actingAs($this->dean($this->college('College of Arts')));
        $this->get('/api'.$upload->json('open_url'))->assertNotFound();
        $this->getJson("/api/organization-applications/{$application->id}")->assertNotFound();
        $this->post("/api/organization-applications/{$application->id}/review-files", ['file' => UploadedFile::fake()->create('x.pdf', 10, 'application/pdf')], ['Accept' => 'application/json'])->assertNotFound();

        Sanctum::actingAs($student);
        $this->get("/api/my/organization-applications/{$application->id}/review-files/{$file->id}")->assertNotFound();
        $this->getJson("/api/my/organization-applications/{$application->id}")->assertOk()->assertJsonPath('requirements.0.review_files', []);

        Sanctum::actingAs($dean);
        $this->review($application, ['action' => 'return', 'remarks' => 'See the annotated copy.'])->assertOk();

        Sanctum::actingAs($student);
        $this->getJson("/api/my/organization-applications/{$application->id}")->assertOk()->assertJsonPath('requirements.0.review_files.0.name', 'annotated.pdf')
            ->assertJsonPath('requirements.0.review_files.0.open_url', "/my/organization-applications/{$application->id}/review-files/{$file->id}");
        $this->get("/api/my/organization-applications/{$application->id}/review-files/{$file->id}")->assertOk();
        Sanctum::actingAs($this->student($college));
        $this->get("/api/my/organization-applications/{$application->id}/review-files/{$file->id}")->assertNotFound();
        $this->getJson("/api/my/organization-applications/{$application->id}")->assertNotFound();

        Sanctum::actingAs($dean);
        $this->deleteJson("/api/organization-applications/{$application->id}/review-files/{$file->id}")->assertConflict();
        $this->assertDatabaseHas('organization_application_review_files', ['id' => $file->id]);
    }

    public function test_a_reviewer_can_remove_their_own_attachment_while_the_application_waits_for_them(): void
    {
        $college = $this->college();
        $dean = $this->dean($college);
        $application = $this->submitted($college, $this->student($college));
        Sanctum::actingAs($dean);
        $id = $this->post("/api/organization-applications/{$application->id}/review-files", ['file' => UploadedFile::fake()->create('a.pdf', 10, 'application/pdf')], ['Accept' => 'application/json'])->assertCreated()->json('id');
        $path = OrganizationApplicationReviewFile::findOrFail($id)->file_path;
        $this->deleteJson("/api/organization-applications/{$application->id}/review-files/{$id}")->assertNoContent();
        Storage::disk('local')->assertMissing($path);
        $this->assertDatabaseMissing('organization_application_review_files', ['id' => $id]);
    }

    private function comment(OrganizationApplication $application, array $payload)
    {
        return $this->postJson("/api/organization-applications/{$application->id}/comments", $payload);
    }

    public function test_a_dean_saves_a_note_for_their_college_without_changing_the_status(): void
    {
        $college = $this->college();
        $student = $this->student($college);
        $application = $this->submitted($college, $student);
        $dean = $this->dean($college);

        Sanctum::actingAs($dean);
        $this->comment($application, ['note' => '  Ask the adviser to sign first.  '])->assertCreated()
            ->assertJsonPath('status', 'pending_dean')
            ->assertJsonCount(1, 'history')
            ->assertJsonPath('history.0.kind', 'comment')
            ->assertJsonPath('history.0.label', 'Comment')
            ->assertJsonPath('history.0.note', 'Ask the adviser to sign first.')
            ->assertJsonPath('history.0.by', trim("{$dean->first_name} {$dean->last_name}"))
            ->assertJsonPath('history.0.stage_label', 'Department Head');

        $application->refresh();
        $this->assertSame('pending_dean', $application->status);
        $this->assertSame(1, $application->round);
        $this->assertDatabaseCount('organization_application_requirement_reviews', 0);
        $this->assertDatabaseMissing('notifications', ['user_id' => $student->school_id]);
        $this->assertDatabaseHas('audit_logs', ['module' => 'organization_applications', 'action' => 'comment', 'record_id' => $application->id, 'user_id' => $dean->school_id]);

        $this->getJson("/api/organization-applications/{$application->id}")->assertOk()->assertJsonPath('history.0.note', 'Ask the adviser to sign first.');
    }

    public function test_the_sao_can_note_an_application_in_any_college_at_any_stage(): void
    {
        $college = $this->college();
        $application = $this->submitted($college, $this->student($college));

        Sanctum::actingAs($this->sao);
        $this->comment($application, ['note' => 'Check the adviser against the faculty list.'])->assertCreated()
            ->assertJsonPath('status', 'pending_dean')->assertJsonPath('history.0.stage_label', 'SAO');

        $application->update(['status' => 'pending_sao']);
        $this->comment($application, ['note' => 'Second look done.'])->assertCreated()->assertJsonPath('status', 'pending_sao')->assertJsonCount(2, 'history');
    }

    public function test_the_history_lists_notes_and_decisions_in_order(): void
    {
        $college = $this->college();
        $application = $this->submitted($college, $this->student($college));

        Sanctum::actingAs($this->dean($college));
        $this->comment($application, ['note' => 'Looks complete.'])->assertCreated();
        $this->review($application, ['action' => 'endorse', 'remarks' => 'Good constitution.'])->assertOk();

        $history = $this->getJson("/api/organization-applications/{$application->id}")->assertOk()->json('history');

        $this->assertSame(['comment', 'decision'], array_column($history, 'kind'));
        $this->assertSame(['Comment', 'Endorsed'], array_column($history, 'label'));
        $this->assertSame(['Looks complete.', 'Good constitution.'], array_column($history, 'note'));
    }

    private function officeStaff(College $college): User
    {
        return User::factory()->admin()->create(['organization_id' => $this->home($college)->id, 'position_title' => 'Department Secretary']);
    }

    public function test_office_staff_review_applications_of_their_own_college_at_the_dean_stage(): void
    {
        $college = $this->college();
        $student = $this->student($college);
        $application = $this->submitted($college, $student);
        $arts = $this->college('College of Arts');
        $other = $this->submitted($arts, $this->student($arts));
        $staff = $this->officeStaff($college);

        Sanctum::actingAs($staff);
        $this->getJson('/api/organization-applications')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $application->id);
        $this->getJson("/api/organization-applications/{$other->id}")->assertNotFound();
        $this->comment($application, ['note' => 'Checked the constitution.'])->assertCreated()
            ->assertJsonPath('history.0.by', trim("{$staff->first_name} {$staff->last_name}"))->assertJsonPath('history.0.stage_label', 'Department Head');
        $this->review($application, ['action' => 'approve'])->assertUnprocessable()->assertJsonValidationErrors('action');
        $this->review($application, ['action' => 'return', 'remarks' => 'Sign the last page.'])->assertOk()->assertJsonPath('status', 'returned');
        $application->refresh();
        $this->assertSame($staff->school_id, (int) $application->returned_by);
        $this->assertSame('DEPARTMENT_HEAD', $application->returned_by_role);

        $application->update(['status' => 'pending_dean']);
        $this->review($application, ['action' => 'endorse'])->assertOk()->assertJsonPath('status', 'pending_sao');
        $this->assertSame($staff->school_id, (int) $application->fresh()->endorsed_by);
    }

    public function test_an_organization_admin_outside_the_college_office_cannot_review_applications(): void
    {
        $college = $this->college();
        $application = $this->submitted($college, $this->student($college));
        $organization = Organization::factory()->create(['college' => $college->name, 'college_id' => $college->id, 'organization_type' => 'STUDENT_ORGANIZATION']);
        $orgAdmin = User::factory()->admin()->create(['organization_id' => $organization->id]);

        Sanctum::actingAs($orgAdmin);
        $this->getJson('/api/organization-applications')->assertForbidden();
        $this->getJson("/api/organization-applications/{$application->id}")->assertForbidden();
        $this->review($application, ['action' => 'endorse'])->assertForbidden();
        $this->assertSame('pending_dean', $application->fresh()->status);
    }

    public function test_a_note_needs_text_and_only_reviewers_of_the_college_can_add_one(): void
    {
        $college = $this->college();
        $student = $this->student($college);
        $application = $this->submitted($college, $student);

        Sanctum::actingAs($this->dean($college));
        $this->comment($application, ['note' => '   '])->assertUnprocessable()->assertJsonValidationErrors('note');
        $this->comment($application, [])->assertUnprocessable()->assertJsonValidationErrors('note');
        $this->comment($application, ['note' => str_repeat('a', 2001)])->assertUnprocessable()->assertJsonValidationErrors('note');

        Sanctum::actingAs($this->dean($this->college('College of Arts')));
        $this->comment($application, ['note' => 'Not mine.'])->assertNotFound();

        Sanctum::actingAs($student);
        $this->comment($application, ['note' => 'Mine.'])->assertForbidden();

        $this->assertDatabaseMissing('audit_logs', ['action' => 'comment']);
    }

    public function test_the_applicant_never_receives_the_reviewers_history(): void
    {
        $college = $this->college();
        $student = $this->student($college);
        $application = $this->submitted($college, $student);

        Sanctum::actingAs($this->dean($college));
        $this->comment($application, ['note' => 'Internal: check the adviser.'])->assertCreated();

        Sanctum::actingAs($student);
        $this->getJson("/api/my/organization-applications/{$application->id}")->assertOk()->assertJsonMissingPath('history')->assertDontSee('Internal: check the adviser.');
    }

    public function test_documents_are_private_and_department_heads_only_see_their_college(): void
    {
        $college = $this->college();
        $student = $this->student($college);
        $application = $this->submitted($college, $student);
        $document = $application->documents->first();

        Sanctum::actingAs($this->dean($this->college('College of Arts')));
        $this->getJson('/api/organization-applications')->assertOk()->assertJsonCount(0, 'data');
        $this->get("/api/organization-applications/{$application->id}/documents/{$document->id}")->assertNotFound();
        $this->review($application, ['action' => 'endorse'])->assertNotFound();

        Sanctum::actingAs($this->dean($college));
        $this->getJson('/api/organization-applications')->assertOk()->assertJsonPath('data.0.id', $application->id)->assertJsonPath('counts.pending_dean', 1)->assertDontSee('file_path');
        $this->get("/api/organization-applications/{$application->id}/documents/{$document->id}")->assertOk();
        $this->getJson("/api/organization-applications/{$application->id}")->assertOk()->assertJsonPath('requirements.0.document.open_url', "/organization-applications/{$application->id}/documents/{$document->id}")->assertDontSee('file_path');

        Sanctum::actingAs($this->student($college));
        $this->getJson('/api/organization-applications')->assertForbidden();
        $this->get("/api/my/organization-applications/{$application->id}/documents/{$document->id}")->assertNotFound();
        Sanctum::actingAs($student);
        $this->get("/api/my/organization-applications/{$application->id}/documents/{$document->id}")->assertOk();
        $this->get("/api/organization-applications/{$application->id}/documents/{$document->id}")->assertForbidden();
    }

    public function test_the_queue_filters_by_status_and_leaves_out_rows_from_the_retired_public_form(): void
    {
        $college = $this->college();
        $dean = $this->dean($college);
        $applicant = User::factory()->student()->create(['organization_id' => $this->home($college)->id, 'first_name' => 'Maria', 'last_name' => 'Reyes']);
        $waiting = $this->submitted($college, $applicant);
        $legacy = [...['college_id' => $college->id, 'acronym' => 'OLD', 'school_id' => 87000002, 'first_name' => 'Old', 'last_name' => 'Row', 'email' => 'old@example.test', 'position_title' => 'President']];
        OrganizationApplication::create([...$legacy, 'name' => 'Never Verified', 'status' => 'pending_verification']);
        OrganizationApplication::create([...$legacy, 'name' => 'Expired Link', 'acronym' => 'EXP', 'status' => 'expired']);
        $approved = OrganizationApplication::create([...$legacy, 'name' => 'Old Approved', 'acronym' => 'OA', 'status' => 'approved', 'email_verified_at' => now()]);

        Sanctum::actingAs($dean);
        $this->getJson('/api/organization-applications')->assertOk()->assertJsonCount(2, 'data')->assertJsonPath('counts.approved', 1)->assertJsonPath('counts.pending_dean', 1);
        $this->getJson('/api/organization-applications?status=pending_dean')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $waiting->id);
        $this->getJson('/api/organization-applications?status=approved')->assertOk()->assertJsonPath('data.0.id', $approved->id);
        $this->getJson('/api/organization-applications?status=pending_endorsement')->assertUnprocessable();
        $this->getJson('/api/organization-applications?search=Old')->assertOk()->assertJsonCount(1, 'data');
    }

    public function test_department_head_role_in_a_student_organization_cannot_review_applications(): void
    {
        $college = $this->college();
        $application = $this->submitted($college, $this->student($college));
        $impostor = User::factory()->departmentHead()->create(['organization_id' => Organization::factory()->create([
            'college' => $college->name, 'college_id' => $college->id, 'organization_type' => 'STUDENT_ORGANIZATION',
        ])->id]);
        Sanctum::actingAs($impostor);
        $this->getJson('/api/organization-applications')->assertOk()->assertJsonCount(0, 'data');
        $this->review($application, ['action' => 'endorse'])->assertNotFound();
    }

    public function test_deleting_a_college_removes_review_files_with_the_application(): void
    {
        $college = $this->college();
        $this->home($college);
        $application = $this->submitted($college, $this->student($college));
        Sanctum::actingAs($this->dean($college));
        $id = $this->post("/api/organization-applications/{$application->id}/review-files", ['file' => UploadedFile::fake()->create('a.pdf', 10, 'application/pdf')], ['Accept' => 'application/json'])->assertCreated()->json('id');
        $path = OrganizationApplicationReviewFile::findOrFail($id)->file_path;

        app(OrganizationDeletionService::class)->deleteCollege($college, $this->sao, null);
        $this->assertDatabaseMissing('organization_applications', ['id' => $application->id]);
        $this->assertDatabaseMissing('organization_application_review_files', ['id' => $id]);
        $this->assertDatabaseCount('organization_applicant_grants', 0);
        Storage::disk('local')->assertMissing($path);
    }

    public function test_redundant_head_profile_is_removed_without_touching_college_access(): void
    {
        $college = $this->college();
        $home = $this->home($college);
        $head = User::factory()->departmentHead()->create(['organization_id' => $home->id]);
        $organization = Organization::factory()->create(['college' => $college->name, 'college_id' => $college->id, 'organization_type' => 'STUDENT_ORGANIZATION']);
        OrganizationApplication::create(['college_id' => $college->id, 'name' => 'Computing Council', 'acronym' => 'CC', 'school_id' => 87651234, 'first_name' => 'Alex', 'last_name' => 'Rivera', 'email' => 'alex@example.test', 'position_title' => 'President', 'status' => 'approved', 'email_verified_at' => now(), 'organization_id' => $organization->id]);
        $other = Organization::factory()->create(['college' => $college->name, 'college_id' => $college->id, 'organization_type' => 'STUDENT_ORGANIZATION']);

        $head->accountProfiles()->create(['organization_id' => $organization->id, 'role' => 'DEPARTMENT_HEAD', 'account_status' => 'active']);
        $this->artisan('hiusa:consolidate-department-head-profiles')->assertExitCode(0);
        $this->assertDatabaseHas('account_profiles', ['user_school_id' => $head->school_id, 'organization_id' => $home->id, 'role' => 'DEPARTMENT_HEAD']);
        $this->assertDatabaseMissing('account_profiles', ['user_school_id' => $head->school_id, 'organization_id' => $organization->id]);
        $this->assertDatabaseMissing('account_profiles', ['user_school_id' => $head->school_id, 'organization_id' => $other->id]);
        $this->artisan('hiusa:consolidate-department-head-profiles')->assertExitCode(0);
        $this->assertSame(1, $head->accountProfiles()->count());
    }
}
