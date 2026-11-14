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
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ApplicantGrantTest extends TestCase
{
    use RefreshDatabase;

    private College $college;

    private Organization $home;

    private User $dean;

    protected function setUp(): void
    {
        parent::setUp();
        $this->college = College::create(['name' => 'College of Computing', 'is_active' => true]);
        $this->home = Organization::factory()->create(['college' => $this->college->name, 'college_id' => $this->college->id, 'organization_type' => 'COLLEGE']);
        $this->dean = User::factory()->departmentHead()->create(['organization_id' => $this->home->id]);
        Sanctum::actingAs($this->dean);
    }

    private function student(?Organization $home = null, array $attributes = []): User
    {
        return User::factory()->student()->create(['organization_id' => ($home ?? $this->home)->id, ...$attributes]);
    }

    public function test_dean_allows_a_student_of_their_college_to_apply_and_the_student_is_told(): void
    {
        $student = $this->student();

        $this->postJson('/api/college/applicant-grants', ['school_id' => $student->school_id])->assertCreated()
            ->assertJsonPath('state', 'open')->assertJsonPath('student.school_id', $student->school_id)->assertJsonPath('student.name', trim("{$student->first_name} {$student->last_name}"))
            ->assertJsonPath('application', null);

        $this->assertDatabaseHas('organization_applicant_grants', ['college_id' => $this->college->id, 'user_school_id' => $student->school_id, 'granted_by' => $this->dean->school_id, 'used_application_id' => null, 'revoked_at' => null]);
        $this->assertDatabaseHas('notifications', ['user_id' => $student->school_id, 'reference_type' => 'organization_applicant_grant', 'title' => 'You can apply for an organization']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'applicant_grant_created', 'user_id' => $this->dean->school_id]);

        Sanctum::actingAs($student);
        $this->getJson('/api/my/organization-applications')->assertOk()->assertJsonPath('can_apply', true);
    }

    public function test_a_student_already_in_a_student_organization_cannot_be_granted(): void
    {
        $organization = Organization::factory()->create(['name' => 'Computing Council', 'college' => $this->college->name, 'college_id' => $this->college->id, 'organization_type' => 'STUDENT_ORGANIZATION']);
        $student = $this->student();
        AccountProfile::create(['user_school_id' => $student->school_id, 'organization_id' => $organization->id, 'role' => 'STUDENT', 'account_status' => 'active']);

        $this->postJson('/api/college/applicant-grants', ['school_id' => $student->school_id])->assertUnprocessable()
            ->assertJsonValidationErrors(['school_id' => 'This student already belongs to Computing Council.']);
        $this->assertDatabaseCount('organization_applicant_grants', 0);
        $this->assertDatabaseMissing('notifications', ['user_id' => $student->school_id, 'reference_type' => 'organization_applicant_grant']);
    }

    public function test_a_lapsed_or_archived_membership_does_not_block_a_grant(): void
    {
        $archived = Organization::factory()->create(['college' => $this->college->name, 'college_id' => $this->college->id, 'organization_type' => 'STUDENT_ORGANIZATION', 'lifecycle_status' => 'archived']);
        $active = Organization::factory()->create(['college' => $this->college->name, 'college_id' => $this->college->id, 'organization_type' => 'STUDENT_ORGANIZATION']);
        $student = $this->student();
        AccountProfile::create(['user_school_id' => $student->school_id, 'organization_id' => $archived->id, 'role' => 'STUDENT', 'account_status' => 'active']);
        AccountProfile::create(['user_school_id' => $student->school_id, 'organization_id' => $active->id, 'role' => 'STUDENT', 'account_status' => 'disabled']);

        $this->postJson('/api/college/applicant-grants', ['school_id' => $student->school_id])->assertCreated();
    }

    public function test_an_open_grant_is_not_honoured_once_the_student_joins_an_organization(): void
    {
        $student = $this->student();
        $this->postJson('/api/college/applicant-grants', ['school_id' => $student->school_id])->assertCreated();
        $organization = Organization::factory()->create(['college' => $this->college->name, 'college_id' => $this->college->id, 'organization_type' => 'STUDENT_ORGANIZATION']);
        AccountProfile::create(['user_school_id' => $student->school_id, 'organization_id' => $organization->id, 'role' => 'STUDENT', 'account_status' => 'active']);

        Sanctum::actingAs($student);
        $this->getJson('/api/my/organization-applications')->assertOk()->assertJsonPath('can_apply', false);
    }

    public function test_the_grant_is_refused_for_anyone_outside_the_college_or_who_is_not_an_active_student(): void
    {
        $other = College::create(['name' => 'College of Arts', 'is_active' => true]);
        $otherHome = Organization::factory()->create(['college' => $other->name, 'college_id' => $other->id, 'organization_type' => 'COLLEGE']);
        $outsider = $this->student($otherHome);
        $inactive = $this->student(null, ['account_status' => 'disabled']);
        $officer = User::factory()->officer()->create(['organization_id' => $this->home->id]);

        foreach ([$outsider->school_id, $inactive->school_id, $officer->school_id, $this->dean->school_id, 99999998] as $schoolId) {
            $this->postJson('/api/college/applicant-grants', ['school_id' => $schoolId])->assertUnprocessable()->assertJsonValidationErrors('school_id');
        }
        $this->postJson('/api/college/applicant-grants', [])->assertUnprocessable()->assertJsonValidationErrors('school_id');
        $this->assertDatabaseCount('organization_applicant_grants', 0);
    }

    public function test_the_list_says_whether_applications_are_open_so_the_dean_is_warned_before_allowing(): void
    {
        $this->getJson('/api/college/applicant-grants', ['Cache-Control' => 'no-cache'])->assertOk()->assertJsonPath('applications_open', false);

        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        $semester = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'active']);
        $this->getJson('/api/college/applicant-grants', ['Cache-Control' => 'no-cache'])->assertOk()->assertJsonPath('applications_open', false);

        ComplianceRequirementType::create(['category' => 'organization', 'academic_year' => $year->label, 'academic_semester_id' => $semester->id, 'name' => 'Constitution', 'deadline_at' => now()->addMonth(), 'is_active' => true, 'created_by' => $this->dean->school_id]);
        $this->getJson('/api/college/applicant-grants', ['Cache-Control' => 'no-cache'])->assertOk()->assertJsonPath('applications_open', true);
    }

    public function test_a_second_open_grant_for_the_same_student_is_refused(): void
    {
        $student = $this->student();
        $this->postJson('/api/college/applicant-grants', ['school_id' => $student->school_id])->assertCreated();
        $this->postJson('/api/college/applicant-grants', ['school_id' => $student->school_id])->assertConflict();
        $this->assertDatabaseCount('organization_applicant_grants', 1);
    }

    public function test_only_a_department_head_can_grant_and_the_list_stays_inside_their_college(): void
    {
        $student = $this->student();
        $this->postJson('/api/college/applicant-grants', ['school_id' => $student->school_id])->assertCreated();

        $other = College::create(['name' => 'College of Arts', 'is_active' => true]);
        $otherHome = Organization::factory()->create(['college' => $other->name, 'college_id' => $other->id, 'organization_type' => 'COLLEGE']);
        $otherStudent = $this->student($otherHome);
        OrganizationApplicantGrant::create(['college_id' => $other->id, 'user_school_id' => $otherStudent->school_id]);

        $this->getJson('/api/college/applicant-grants')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.student.school_id', $student->school_id);
        Sanctum::actingAs(User::factory()->departmentHead()->create(['organization_id' => $otherHome->id]));
        $this->getJson('/api/college/applicant-grants')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.student.school_id', $otherStudent->school_id);

        foreach ([User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->value('id')]), User::factory()->admin()->create(['organization_id' => $this->home->id]), $student] as $account) {
            Sanctum::actingAs($account);
            $this->postJson('/api/college/applicant-grants', ['school_id' => $student->school_id])->assertForbidden();
            $this->getJson('/api/college/applicant-grants')->assertForbidden();
        }
    }

    public function test_the_dean_takes_a_grant_back_before_it_is_used_and_the_student_stops_seeing_the_link(): void
    {
        $student = $this->student();
        $id = $this->postJson('/api/college/applicant-grants', ['school_id' => $student->school_id])->assertCreated()->json('id');
        $this->deleteJson("/api/college/applicant-grants/{$id}")->assertOk()->assertJsonPath('state', 'revoked');
        $this->deleteJson("/api/college/applicant-grants/{$id}")->assertConflict();

        Sanctum::actingAs($student);
        $this->getJson('/api/my/organization-applications')->assertOk()->assertJsonPath('can_apply', false);

        Sanctum::actingAs($this->dean);
        $this->postJson('/api/college/applicant-grants', ['school_id' => $student->school_id])->assertCreated();
        $this->assertDatabaseHas('audit_logs', ['action' => 'applicant_grant_revoked', 'user_id' => $this->dean->school_id]);
    }

    public function test_a_used_grant_cannot_be_taken_back_and_shows_its_application(): void
    {
        $student = $this->student();
        $grant = OrganizationApplicantGrant::create(['college_id' => $this->college->id, 'user_school_id' => $student->school_id, 'granted_by' => $this->dean->school_id]);
        $application = OrganizationApplication::create(['college_id' => $this->college->id, 'name' => 'Computing Council', 'acronym' => 'CC', 'school_id' => $student->school_id, 'first_name' => $student->first_name, 'last_name' => $student->last_name, 'email' => $student->email, 'position_title' => 'President', 'status' => 'pending_dean']);
        $grant->update(['used_application_id' => $application->id]);

        $this->deleteJson("/api/college/applicant-grants/{$grant->id}")->assertConflict();
        $this->getJson('/api/college/applicant-grants')->assertOk()->assertJsonPath('data.0.state', 'used')->assertJsonPath('data.0.application.name', 'Computing Council');

        Sanctum::actingAs(User::factory()->departmentHead()->create(['organization_id' => Organization::factory()->create(['college_id' => College::create(['name' => 'College of Arts', 'is_active' => true])->id, 'organization_type' => 'COLLEGE'])->id]));
        $this->deleteJson("/api/college/applicant-grants/{$grant->id}")->assertNotFound();
    }
}
