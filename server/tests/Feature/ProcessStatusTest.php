<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\AccountProfile;
use App\Models\College;
use App\Models\ComplianceRequirementType;
use App\Models\DepartmentHeadInvitation;
use App\Models\Election;
use App\Models\Organization;
use App\Models\OrganizationApplicantGrant;
use App\Models\OrganizationApplication;
use App\Models\OrganizationComplianceSubmission;
use App\Models\StudentRegistryEntry;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ProcessStatusTest extends TestCase
{
    use RefreshDatabase;

    private College $computing;

    private Organization $computingHome;

    private College $arts;

    private Organization $artsHome;

    private User $sao;

    protected function setUp(): void
    {
        parent::setUp();
        $saoHome = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);
        $this->sao = User::factory()->superAdmin()->create(['organization_id' => $saoHome->id]);
        [$this->computing, $this->computingHome] = $this->college('College of Computing');
        [$this->arts, $this->artsHome] = $this->college('College of Arts');
    }

    /** @return array{0: College, 1: Organization} */
    private function college(string $name): array
    {
        $college = College::create(['name' => $name, 'is_active' => true]);
        $home = Organization::factory()->create(['college' => $name, 'college_id' => $college->id, 'organization_type' => 'COLLEGE']);

        return [$college, $home];
    }

    private function studentOrganization(College $college, string $lifecycle = 'active', array $attributes = []): Organization
    {
        return Organization::factory()->create([
            'college' => $college->name, 'college_id' => $college->id, 'organization_type' => 'STUDENT_ORGANIZATION',
            'lifecycle_status' => $lifecycle, ...$attributes,
        ]);
    }

    private function statusOf(User $user)
    {
        Sanctum::actingAs($user);

        return $this->getJson('/api/process/status');
    }

    /** @return array<string, array<string, mixed>> */
    private function steps(array $payload): array
    {
        return collect($payload['steps'])->keyBy('key')->all();
    }

    private function states(array $payload): array
    {
        return collect($payload['steps'])->pluck('state', 'key')->all();
    }

    private function record(College $college, int $schoolId): StudentRegistryEntry
    {
        return StudentRegistryEntry::create([
            'school_id' => $schoolId, 'first_name' => 'Ana', 'last_name' => 'Reyes', 'birth_date' => '2005-01-01',
            'college_id' => $college->id, 'program' => 'BSIT', 'year_level' => '1st Year',
        ]);
    }

    private function application(College $college, User $student, string $status, array $attributes = []): OrganizationApplication
    {
        return OrganizationApplication::create([
            'college_id' => $college->id, 'name' => 'Chess Club '.$student->school_id, 'acronym' => 'CC'.$student->school_id, 'school_id' => $student->school_id,
            'first_name' => $student->first_name, 'last_name' => $student->last_name, 'email' => $student->email, 'position_title' => 'President',
            'status' => $status, ...$attributes,
        ]);
    }

    private function semester(string $startsOn = '2026-08-01', string $status = 'active'): AcademicSemester
    {
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);

        return AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => $startsOn, 'ends_on' => '2026-12-31', 'status' => $status]);
    }

    private function requirement(AcademicSemester $semester, string $category, string $name): ComplianceRequirementType
    {
        return ComplianceRequirementType::create([
            'category' => $category, 'academic_year' => '2026-2027', 'academic_semester_id' => $semester->id, 'name' => $name,
            'allowed_extensions' => ['pdf'], 'is_active' => true, 'deadline_at' => '2026-12-31', 'created_by' => $this->sao->school_id,
        ]);
    }

    private function submit(Organization $organization, ComplianceRequirementType $type, string $status = 'submitted'): void
    {
        OrganizationComplianceSubmission::create([
            'organization_id' => $organization->id, 'requirement_type_id' => $type->id, 'status' => $status,
            'file_path' => 'compliance/x.pdf', 'file_original_name' => 'x.pdf', 'mime_type' => 'application/pdf', 'file_size' => 10,
            'submitted_by' => $this->sao->school_id, 'submitted_at' => now(),
        ]);
    }

    public function test_it_requires_a_signed_in_user_and_is_never_cached(): void
    {
        $this->getJson('/api/process/status')->assertUnauthorized();

        $response = $this->statusOf($this->sao)->assertOk();
        $this->assertStringContainsString('no-store', (string) $response->headers->get('Cache-Control'));
    }

    public function test_an_officer_has_no_tracker(): void
    {
        $officer = User::factory()->officer()->create(['organization_id' => $this->studentOrganization($this->computing)->id]);

        $this->statusOf($officer)->assertOk()->assertExactJson(['title' => null, 'complete' => false, 'steps' => []]);
    }

    public function test_sao_sees_every_active_college_start_at_the_first_open_step(): void
    {
        $payload = $this->statusOf($this->sao)->assertOk()->json();

        $this->assertSame(2, count($payload['colleges']));
        $this->assertFalse($payload['complete']);
        $this->assertSame(['Dean invited', 'Dean active', 'School records loaded', 'Organizations applying', 'Organizations active'], array_column($payload['steps'], 'label'));
        $this->assertSame('current', $payload['steps'][0]['state']);
        $this->assertSame(0, $payload['steps'][0]['count']);
        $this->assertSame(2, $payload['steps'][0]['total']);
        $this->assertSame(['label' => 'Invite the Department Head', 'path' => '/dashboard/super-admin/colleges'], $payload['steps'][0]['action']);
        $this->assertArrayNotHasKey('action', $payload['steps'][1]);
    }

    public function test_sao_per_college_steps_follow_each_colleges_own_records(): void
    {
        $inviter = $this->sao;
        DepartmentHeadInvitation::create([
            'college_id' => $this->arts->id, 'role' => 'DEPARTMENT_HEAD', 'token_hash' => hash('sha256', 'arts'),
            'invited_by' => $inviter->school_id, 'expires_at' => now()->addDays(3),
        ]);
        User::factory()->departmentHead()->create(['organization_id' => $this->computingHome->id]);
        $this->record($this->computing, 2600001);
        $this->record($this->computing, 2600002);
        $student = User::factory()->student()->create(['organization_id' => $this->computingHome->id]);
        $this->application($this->computing, $student, 'pending_dean');

        $payload = $this->statusOf($this->sao)->assertOk()->json();
        $rows = collect($payload['colleges'])->keyBy('name');

        $computing = $rows['College of Computing'];
        $this->assertSame(['dean-invited' => 'done', 'dean-active' => 'done', 'records-loaded' => 'done', 'organizations-applying' => 'done', 'organizations-active' => 'current'], $this->states($computing));
        $this->assertSame(2, $this->steps($computing)['records-loaded']['count']);
        $this->assertSame(1, $this->steps($computing)['organizations-applying']['count']);
        $this->assertSame('/dashboard/super-admin/organizations', $this->steps($computing)['organizations-active']['action']['path']);

        $arts = $rows['College of Arts'];
        $this->assertSame(['dean-invited' => 'done', 'dean-active' => 'current', 'records-loaded' => 'todo', 'organizations-applying' => 'todo', 'organizations-active' => 'todo'], $this->states($arts));
        $this->assertSame(1, $this->steps($arts)['dean-invited']['count']);
        $this->assertSame(0, $this->steps($arts)['dean-active']['count']);

        $aggregate = $this->steps($payload);
        $this->assertSame(2, $aggregate['dean-invited']['count']);
        $this->assertSame('done', $aggregate['dean-invited']['state']);
        $this->assertSame(1, $aggregate['dean-active']['count']);
        $this->assertSame('current', $aggregate['dean-active']['state']);
        $this->assertSame('todo', $aggregate['records-loaded']['state']);
    }

    public function test_sao_ignores_archived_colleges_and_a_deans_disabled_account(): void
    {
        $this->arts->update(['is_active' => false]);
        $dean = User::factory()->departmentHead()->create(['organization_id' => $this->computingHome->id]);
        AccountProfile::where('user_school_id', $dean->school_id)->update(['account_status' => 'disabled']);

        $payload = $this->statusOf($this->sao)->assertOk()->json();

        $this->assertSame(['College of Computing'], array_column($payload['colleges'], 'name'));
        $this->assertSame('current', $this->steps($payload)['dean-invited']['state']);
    }

    public function test_sao_is_complete_when_every_college_has_gone_through_every_step(): void
    {
        foreach ([[$this->computing, $this->computingHome, 2600001], [$this->arts, $this->artsHome, 2600002]] as [$college, $home, $id]) {
            User::factory()->departmentHead()->create(['organization_id' => $home->id]);
            $this->record($college, $id);
            $this->studentOrganization($college);
        }

        $payload = $this->statusOf($this->sao)->assertOk()->json();

        $this->assertTrue($payload['complete']);
        $this->assertSame(['done'], array_values(array_unique(array_column($payload['steps'], 'state'))));
        $this->assertTrue($payload['colleges'][0]['complete']);
    }

    public function test_dean_sees_only_their_own_college(): void
    {
        $dean = User::factory()->departmentHead()->create(['organization_id' => $this->computingHome->id]);
        $this->record($this->arts, 2600001);
        $this->studentOrganization($this->arts);
        $artsStudent = User::factory()->student()->create(['organization_id' => $this->artsHome->id]);
        OrganizationApplicantGrant::create(['college_id' => $this->arts->id, 'user_school_id' => $artsStudent->school_id, 'granted_by' => $this->sao->school_id]);
        $this->application($this->arts, $artsStudent, 'pending_dean');

        $payload = $this->statusOf($dean)->assertOk()->json();

        $this->assertSame('Setting up your college', $payload['title']);
        $this->assertSame(['staff-added', 'records-loaded', 'students-allowed', 'applications-reviewed', 'organizations-active'], array_column($payload['steps'], 'key'));
        $this->assertSame(['current', 'todo', 'todo', 'todo', 'todo'], array_column($payload['steps'], 'state'));
        $this->assertSame(['label' => 'Add office staff', 'path' => '/dashboard/department-head/people'], $payload['steps'][0]['action']);
        $this->assertSame(0, $this->steps($payload)['organizations-active']['count']);
        $this->assertArrayNotHasKey('total', $this->steps($payload)['applications-reviewed']);
        $this->assertArrayNotHasKey('colleges', $payload);
    }

    public function test_dean_steps_advance_with_staff_records_grants_reviews_and_organizations(): void
    {
        $dean = User::factory()->departmentHead()->create(['organization_id' => $this->computingHome->id]);
        $secretary = User::factory()->admin()->create(['organization_id' => $this->computingHome->id]);
        $this->record($this->computing, 2600001);
        $student = User::factory()->student()->create(['organization_id' => $this->computingHome->id]);
        OrganizationApplicantGrant::create(['college_id' => $this->computing->id, 'user_school_id' => $student->school_id, 'granted_by' => $dean->school_id]);
        $this->application($this->computing, $student, 'pending_dean');

        $payload = $this->statusOf($dean)->assertOk()->json();
        $steps = $this->steps($payload);
        $this->assertSame(['done', 'done', 'done', 'current', 'todo'], array_column($payload['steps'], 'state'));
        $this->assertSame(1, $steps['staff-added']['count']);
        $this->assertSame(1, $steps['students-allowed']['count']);
        $this->assertSame(0, $steps['applications-reviewed']['count']);
        $this->assertSame(1, $steps['applications-reviewed']['total']);
        $this->assertSame('/dashboard/organization-applications', $steps['applications-reviewed']['action']['path']);

        OrganizationApplication::query()->update(['status' => 'pending_sao']);
        $steps = $this->steps($this->statusOf($dean)->json());
        $this->assertSame('done', $steps['applications-reviewed']['state']);
        $this->assertSame(1, $steps['applications-reviewed']['count']);
        $this->assertSame('current', $steps['organizations-active']['state']);

        $this->studentOrganization($this->computing);
        $payload = $this->statusOf($dean)->json();
        $this->assertTrue($payload['complete']);

        AccountProfile::where('user_school_id', $secretary->school_id)->update(['account_status' => 'inactive']);
        $this->assertSame('current', $this->steps($this->statusOf($dean)->json())['staff-added']['state']);
    }

    public function test_dean_counts_a_college_with_a_revoked_grant_as_not_yet_allowing_anyone(): void
    {
        $dean = User::factory()->departmentHead()->create(['organization_id' => $this->computingHome->id]);
        $student = User::factory()->student()->create(['organization_id' => $this->computingHome->id]);
        OrganizationApplicantGrant::create(['college_id' => $this->computing->id, 'user_school_id' => $student->school_id, 'granted_by' => $dean->school_id, 'revoked_at' => now()]);

        $this->assertSame('todo', $this->steps($this->statusOf($dean)->json())['students-allowed']['state']);
    }

    public function test_admin_steps_cover_approval_officers_requirements_and_the_election(): void
    {
        $semester = $this->semester();
        $organization = $this->studentOrganization($this->computing, 'active', ['reviewed_at' => '2026-09-10']);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $first = $this->requirement($semester, 'semestral_report', 'Accomplishment Report');
        $second = $this->requirement($semester, 'semestral_report', 'Action Plan');

        $payload = $this->statusOf($admin)->assertOk()->json();
        $this->assertSame('Setting up your organization', $payload['title']);
        $this->assertSame(['organization-approved', 'officers-access', 'semester-requirements', 'next-election'], array_column($payload['steps'], 'key'));
        $this->assertSame(['done', 'current', 'todo', 'todo'], array_column($payload['steps'], 'state'));
        $this->assertSame(['label' => 'Give officers access', 'path' => '/dashboard/admin/users'], $payload['steps'][1]['action']);

        User::factory()->officer()->create(['organization_id' => $organization->id]);
        $this->submit($organization, $first);
        $this->submit($organization, $second, 'returned');
        $steps = $this->steps($this->statusOf($admin)->json());
        $this->assertSame('done', $steps['officers-access']['state']);
        $this->assertSame('current', $steps['semester-requirements']['state']);
        $this->assertSame(1, $steps['semester-requirements']['count']);
        $this->assertSame(2, $steps['semester-requirements']['total']);
        $this->assertSame('/dashboard/compliance', $steps['semester-requirements']['action']['path']);

        OrganizationComplianceSubmission::where('requirement_type_id', $second->id)->update(['status' => 'approved']);
        $steps = $this->steps($this->statusOf($admin)->json());
        $this->assertSame('done', $steps['semester-requirements']['state']);
        $this->assertSame('current', $steps['next-election']['state']);
        $this->assertSame(0, $steps['next-election']['count']);

        $election = Election::create([
            'organization_id' => $organization->id, 'academic_semester_id' => $semester->id, 'title' => 'SBO election', 'status' => 'closed',
            'start_time' => now()->subDays(3), 'end_time' => now()->subDay(),
        ]);
        $steps = $this->steps($this->statusOf($admin)->json());
        $this->assertSame('current', $steps['next-election']['state']);
        $this->assertSame(1, $steps['next-election']['count']);

        $election->forceFill(['access_handed_over_at' => now()])->save();
        $this->assertTrue($this->statusOf($admin)->json()['complete']);
    }

    public function test_admin_renewal_appears_only_when_the_organization_was_approved_before_the_semester_started(): void
    {
        $semester = $this->semester('2026-08-01');
        $renewal = $this->requirement($semester, 'renewal', 'Renewal Form');
        $older = $this->studentOrganization($this->computing, 'active', ['reviewed_at' => '2026-03-01']);
        $newer = $this->studentOrganization($this->computing, 'active', ['reviewed_at' => '2026-09-01']);
        $olderAdmin = User::factory()->admin()->create(['organization_id' => $older->id]);
        $newerAdmin = User::factory()->admin()->create(['organization_id' => $newer->id]);

        $steps = $this->steps($this->statusOf($olderAdmin)->json());
        $this->assertSame(1, $steps['renewal']['total']);
        $this->assertSame(0, $steps['renewal']['count']);
        $this->assertArrayNotHasKey('renewal', $this->steps($this->statusOf($newerAdmin)->json()));

        $this->submit($older, $renewal);
        $this->assertSame('done', $this->steps($this->statusOf($olderAdmin)->json())['renewal']['state']);
    }

    public function test_admin_without_an_active_semester_cannot_finish_the_semester_steps(): void
    {
        $organization = $this->studentOrganization($this->computing);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        User::factory()->officer()->create(['organization_id' => $organization->id]);

        $payload = $this->statusOf($admin)->assertOk()->json();

        $this->assertSame(['done', 'done', 'current', 'todo'], array_column($payload['steps'], 'state'));
        $this->assertArrayNotHasKey('count', $this->steps($payload)['semester-requirements']);
    }

    public function test_admin_of_an_unapproved_organization_is_stopped_at_approval(): void
    {
        $admin = User::factory()->admin()->create(['organization_id' => $this->studentOrganization($this->computing, 'returned')->id]);

        $payload = $this->statusOf($admin)->assertOk()->json();

        $this->assertSame('current', $payload['steps'][0]['state']);
        $this->assertArrayNotHasKey('action', $payload['steps'][0]);
    }

    public function test_college_office_staff_and_the_sao_staff_have_no_organization_tracker(): void
    {
        $secretary = User::factory()->admin()->create(['organization_id' => $this->computingHome->id]);

        $this->statusOf($secretary)->assertOk()->assertJsonPath('steps', []);
    }

    public function test_student_without_a_grant_or_application_sees_nothing(): void
    {
        $student = User::factory()->student()->create(['organization_id' => $this->computingHome->id]);
        $this->application($this->computing, $student, 'pending_verification');

        $this->statusOf($student)->assertOk()->assertJsonPath('steps', []);
    }

    public function test_student_with_a_grant_is_asked_to_apply(): void
    {
        $student = User::factory()->student()->create(['organization_id' => $this->computingHome->id]);
        OrganizationApplicantGrant::create(['college_id' => $this->computing->id, 'user_school_id' => $student->school_id, 'granted_by' => $this->sao->school_id]);

        $payload = $this->statusOf($student)->assertOk()->json();

        $this->assertSame(['Allowed to apply', 'Application sent', 'Dean review', 'SAO review', 'Approved'], array_column($payload['steps'], 'label'));
        $this->assertSame(['done', 'current', 'todo', 'todo', 'todo'], array_column($payload['steps'], 'state'));
        $this->assertSame(['label' => 'Apply for an organization', 'path' => '/dashboard/student/apply-organization'], $payload['steps'][1]['action']);
    }

    public function test_student_application_moves_through_review_and_the_link_opens_their_own_application(): void
    {
        $student = User::factory()->student()->create(['organization_id' => $this->computingHome->id]);
        $application = $this->application($this->computing, $student, 'pending_dean');

        $payload = $this->statusOf($student)->assertOk()->json();
        $this->assertSame(['done', 'done', 'current', 'todo', 'todo'], array_column($payload['steps'], 'state'));
        $this->assertSame("/dashboard/student/organization-applications/{$application->id}", $payload['steps'][2]['action']['path']);

        $application->update(['status' => 'pending_sao', 'endorsed_at' => now()]);
        $this->assertSame(['done', 'done', 'done', 'current', 'todo'], array_column($this->statusOf($student)->json()['steps'], 'state'));

        $application->update(['status' => 'approved']);
        $payload = $this->statusOf($student)->json();
        $this->assertTrue($payload['complete']);
    }

    public function test_student_sees_who_returned_the_application_and_a_rejection_where_it_stopped(): void
    {
        $student = User::factory()->student()->create(['organization_id' => $this->computingHome->id]);
        $application = $this->application($this->computing, $student, 'returned', ['returned_by_role' => 'SUPER_ADMIN']);

        $step = $this->statusOf($student)->json()['steps'][1];
        $this->assertSame('current', $step['state']);
        $this->assertStringContainsString('Returned by SAO', $step['note']);
        $this->assertSame('Update and send again', $step['action']['label']);

        $application->update(['status' => 'rejected', 'endorsed_at' => now()]);
        $payload = $this->statusOf($student)->json();
        $this->assertSame(['done', 'done', 'done', 'current', 'todo'], array_column($payload['steps'], 'state'));
        $this->assertStringContainsString('Not approved', $payload['steps'][3]['note']);
    }

    public function test_a_student_only_ever_sees_their_own_application(): void
    {
        $mine = User::factory()->student()->create(['organization_id' => $this->computingHome->id]);
        $other = User::factory()->student()->create(['organization_id' => $this->computingHome->id]);
        $this->application($this->computing, $other, 'approved');

        $this->statusOf($mine)->assertOk()->assertJsonPath('steps', []);
    }
}
