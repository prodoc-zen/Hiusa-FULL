<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\College;
use App\Models\ComplianceRequirementType;
use App\Models\Event;
use App\Models\EventRequirement;
use App\Models\Organization;
use App\Models\OrganizationComplianceSubmission;
use App\Models\Task;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ComplianceLifecycleTest extends TestCase
{
    use RefreshDatabase;

    private function director(): User
    {
        $office = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION', 'lifecycle_status' => 'active']);

        return User::factory()->superAdmin()->create(['organization_id' => $office->id, 'account_status' => 'active']);
    }

    private function studentOrganization(string $name, ?College $college = null, string $lifecycle = 'active'): Organization
    {
        return Organization::factory()->create([
            'name' => $name,
            'organization_type' => 'STUDENT_ORGANIZATION',
            'college_id' => $college?->id,
            'lifecycle_status' => $lifecycle,
        ]);
    }

    private function collegeHead(College $college): User
    {
        $home = Organization::factory()->create([
            'name' => $college->name.' Office',
            'organization_type' => 'COLLEGE',
            'college_id' => $college->id,
            'lifecycle_status' => 'active',
        ]);

        return User::factory()->departmentHead()->create(['organization_id' => $home->id, 'account_status' => 'active']);
    }

    private function requirementType(string $name, ?int $semesterId = null): ComplianceRequirementType
    {
        return ComplianceRequirementType::create([
            'academic_year' => '2026-2027',
            'academic_semester_id' => $semesterId,
            'name' => $name,
            'deadline_at' => '2026-12-31 23:59:59',
            'is_active' => true,
            'created_by' => $this->director()->school_id,
        ]);
    }

    private function submission(Organization $organization, ComplianceRequirementType $type, string $status = 'submitted'): OrganizationComplianceSubmission
    {
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id, 'account_status' => 'active']);

        return OrganizationComplianceSubmission::create([
            'organization_id' => $organization->id,
            'requirement_type_id' => $type->id,
            'status' => $status,
            'file_path' => 'compliance-submissions/'.$organization->id.'/doc.pdf',
            'file_original_name' => 'doc.pdf',
            'mime_type' => 'application/pdf',
            'file_size' => 800,
            'submitted_by' => $admin->school_id,
            'submitted_at' => '2026-09-01 08:00:00',
        ]);
    }

    private function academicYear(): AcademicYear
    {
        return AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
    }

    public function test_creating_a_semester_seeds_the_semestral_accomplishment_report_requirement(): void
    {
        $year = $this->academicYear();
        Sanctum::actingAs($this->director());

        $id = $this->postJson("/api/system/academic-years/{$year->id}/semesters", ['number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31'])
            ->assertCreated()->json('id');

        $type = ComplianceRequirementType::where('academic_semester_id', $id)->where('name', 'Semestral Accomplishment Report')->sole();
        $this->assertSame('2026-2027', $type->academic_year);
        $this->assertSame('2026-12-31', $type->deadline_at->toDateString());
        $this->assertTrue($type->is_active);
        $this->assertSame(11, ComplianceRequirementType::where('academic_semester_id', $id)->count());
    }

    public function test_seed_command_adds_the_semestral_report_to_the_active_semester_once(): void
    {
        $year = $this->academicYear();
        $semester = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'active']);
        $director = $this->director();

        $this->artisan('compliance:seed-semestral-report')->assertSuccessful();
        $this->artisan('compliance:seed-semestral-report')->assertSuccessful();

        $type = ComplianceRequirementType::where('academic_semester_id', $semester->id)->where('name', 'Semestral Accomplishment Report')->sole();
        $this->assertSame('2026-12-31', $type->deadline_at->toDateString());
        $this->assertSame($director->school_id, $type->created_by);
    }

    public function test_seed_command_fails_without_an_active_semester(): void
    {
        $this->artisan('compliance:seed-semestral-report')->assertFailed();

        $this->assertSame(0, ComplianceRequirementType::count());
    }

    public function test_status_lists_only_active_organizations(): void
    {
        $this->requirementType('Letter of Intent');
        $this->studentOrganization('Active Club');
        $this->studentOrganization('Pending Club', null, 'pending');
        $this->studentOrganization('Returned Club', null, 'returned');
        $this->studentOrganization('Archived Club', null, 'archived');
        Sanctum::actingAs($this->director());

        $response = $this->getJson('/api/compliance/status?academic_year=2026-2027')->assertOk();

        $this->assertSame(['Active Club'], collect($response->json('organizations'))->pluck('organization_name')->all());
    }

    public function test_head_reads_status_submissions_and_documents_for_its_college_only(): void
    {
        Storage::fake('local');
        $computing = College::create(['name' => 'College of Computing', 'is_active' => true]);
        $arts = College::create(['name' => 'College of Arts', 'is_active' => true]);
        $mine = $this->studentOrganization('Coding Club', $computing);
        $theirs = $this->studentOrganization('Drama Guild', $arts);
        $type = $this->requirementType('Letter of Intent');
        $mineSubmission = $this->submission($mine, $type);
        $theirSubmission = $this->submission($theirs, $type);
        Storage::disk('local')->put($mineSubmission->file_path, 'pdf');
        Storage::disk('local')->put($theirSubmission->file_path, 'pdf');
        Sanctum::actingAs($this->collegeHead($computing));

        $status = $this->getJson('/api/compliance/status?academic_year=2026-2027')->assertOk();
        $this->assertSame(['Coding Club'], collect($status->json('organizations'))->pluck('organization_name')->all());
        $this->getJson('/api/compliance/status?academic_year=2026-2027&organization_id='.$theirs->id)->assertForbidden();

        $this->getJson('/api/compliance/submissions')->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.id', $mineSubmission->id);
        $this->getJson('/api/compliance/submissions?organization_id='.$theirs->id)->assertForbidden();

        $this->getJson("/api/compliance/submissions/{$mineSubmission->id}/document")->assertOk();
        $this->getJson("/api/compliance/submissions/{$theirSubmission->id}/document")->assertNotFound();
        $this->getJson('/api/compliance/requirement-types')->assertOk()->assertJsonPath('total', 1);
    }

    public function test_head_cannot_submit_or_review(): void
    {
        $college = College::create(['name' => 'College of Computing', 'is_active' => true]);
        $organization = $this->studentOrganization('Coding Club', $college);
        $submission = $this->submission($organization, $this->requirementType('Letter of Intent'));
        Sanctum::actingAs($this->collegeHead($college));

        $this->postJson('/api/compliance/submissions', ['requirement_type_id' => $submission->requirement_type_id])->assertForbidden();
        $this->patchJson("/api/compliance/submissions/{$submission->id}/review", ['status' => 'approved', 'submitted_at' => '2026-09-01 08:00:00'])->assertForbidden();
    }

    public function test_review_and_submit_are_refused_for_an_archived_organization(): void
    {
        Storage::fake('local');
        $organization = $this->studentOrganization('Old Club', null, 'archived');
        $type = $this->requirementType('Letter of Intent');
        $submission = $this->submission($organization, $type);
        $admin = User::where('organization_id', $organization->id)->firstOrFail();

        Sanctum::actingAs($this->director());
        $this->patchJson("/api/compliance/submissions/{$submission->id}/review", ['status' => 'approved', 'submitted_at' => $submission->submitted_at->toIso8601String()])
            ->assertConflict();
        $this->assertSame('submitted', $submission->fresh()->status);

        Sanctum::actingAs($admin);
        $this->postJson('/api/compliance/submissions', ['requirement_type_id' => $this->requirementType('Constitution')->id, 'document' => UploadedFile::fake()->create('c.pdf', 50, 'application/pdf')])
            ->assertConflict();
        $this->assertSame(1, OrganizationComplianceSubmission::where('organization_id', $organization->id)->count());
    }

    public function test_single_review_is_refused_for_pending_and_returned_registrations(): void
    {
        $type = $this->requirementType('Letter of Intent');
        Sanctum::actingAs($this->director());

        foreach (['pending', 'returned'] as $lifecycle) {
            $organization = $this->studentOrganization(ucfirst($lifecycle).' Club', null, $lifecycle);
            $submission = $this->submission($organization, $type);

            $this->patchJson("/api/compliance/submissions/{$submission->id}/review", ['status' => 'approved', 'submitted_at' => $submission->submitted_at->toIso8601String()])
                ->assertConflict()->assertJsonPath('message', 'Registration documents are reviewed through the organization review.');
            $this->assertSame('submitted', $submission->fresh()->status);
        }
    }

    public function test_requirement_type_can_be_deleted_only_without_submissions(): void
    {
        $organization = $this->studentOrganization('Coding Club');
        $empty = $this->requirementType('Empty');
        $used = $this->requirementType('Used');
        $this->submission($organization, $used);
        Sanctum::actingAs($this->director());

        $this->deleteJson("/api/compliance/requirement-types/{$used->id}")->assertConflict();
        $this->assertDatabaseHas('compliance_requirement_types', ['id' => $used->id]);

        $this->deleteJson("/api/compliance/requirement-types/{$empty->id}")->assertNoContent();
        $this->assertDatabaseMissing('compliance_requirement_types', ['id' => $empty->id]);
        $this->assertDatabaseHas('audit_logs', ['module' => 'compliance', 'action' => 'requirement_type_deleted', 'record_id' => $empty->id]);
    }

    public function test_only_super_admin_can_delete_a_requirement_type(): void
    {
        $organization = $this->studentOrganization('Coding Club');
        $type = $this->requirementType('Empty');
        Sanctum::actingAs(User::factory()->admin()->create(['organization_id' => $organization->id]));

        $this->deleteJson("/api/compliance/requirement-types/{$type->id}")->assertForbidden();
    }

    public function test_unreferenced_semester_is_deleted_with_its_seeded_defaults(): void
    {
        $year = $this->academicYear();
        $director = $this->director();
        Sanctum::actingAs($director);
        $id = $this->postJson("/api/system/academic-years/{$year->id}/semesters", ['number' => 2, 'starts_on' => '2027-01-01', 'ends_on' => '2027-05-31'])
            ->assertCreated()->json('id');

        $this->deleteJson("/api/system/academic-semesters/{$id}")->assertNoContent();

        $this->assertDatabaseMissing('academic_semesters', ['id' => $id]);
        $this->assertSame(0, ComplianceRequirementType::where('academic_semester_id', $id)->count());
        $this->assertSame(0, EventRequirement::where('academic_semester_id', $id)->count());
        $this->assertDatabaseHas('audit_logs', ['module' => 'system_administration', 'action' => 'academic_semester_deleted', 'record_id' => $id]);
    }

    public function test_semester_with_references_cannot_be_deleted_and_the_reasons_are_listed(): void
    {
        $year = $this->academicYear();
        $semester = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 2, 'starts_on' => '2027-01-01', 'ends_on' => '2027-05-31', 'status' => 'upcoming']);
        $organization = $this->studentOrganization('Coding Club');
        $creator = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $type = $this->requirementType('Used', $semester->id);
        $this->submission($organization, $type);
        $event = Event::factory()->create(['organization_id' => $organization->id, 'academic_semester_id' => $semester->id, 'created_by' => $creator->school_id]);
        Task::factory()->create(['event_id' => $event->id, 'created_by' => $creator->school_id, 'assigned_to' => $creator->school_id, 'academic_semester_id' => $semester->id]);
        Sanctum::actingAs($this->director());

        $response = $this->deleteJson("/api/system/academic-semesters/{$semester->id}")->assertConflict();

        $this->assertSame(
            ['events', 'tasks', 'compliance submissions'],
            collect($response->json('reasons'))->all(),
        );
        $this->assertDatabaseHas('academic_semesters', ['id' => $semester->id]);
    }

    public function test_active_semester_cannot_be_deleted(): void
    {
        $year = $this->academicYear();
        $semester = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'active']);
        Sanctum::actingAs($this->director());

        $this->deleteJson("/api/system/academic-semesters/{$semester->id}")->assertConflict();
        $this->assertDatabaseHas('academic_semesters', ['id' => $semester->id]);
    }

    public function test_only_super_admin_can_delete_a_semester(): void
    {
        $year = $this->academicYear();
        $semester = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 2, 'starts_on' => '2027-01-01', 'ends_on' => '2027-05-31', 'status' => 'upcoming']);
        Sanctum::actingAs(User::factory()->admin()->create(['organization_id' => $this->studentOrganization('Coding Club')->id]));

        $this->deleteJson("/api/system/academic-semesters/{$semester->id}")->assertForbidden();
    }
}
