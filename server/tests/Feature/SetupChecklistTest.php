<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\ApprovalRequest;
use App\Models\Budget;
use App\Models\College;
use App\Models\DepartmentHeadInvitation;
use App\Models\Organization;
use App\Models\OrganizationApplication;
use App\Models\SboPosition;
use App\Models\StudentRegistryEntry;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

class SetupChecklistTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        // Several tests change records and read the same user's briefing again.
        config(['performance.api_cache.enabled' => false]);
    }

    private function checklistFor(User $user): array
    {
        Sanctum::actingAs($user);

        return $this->getJson('/api/dashboard/briefing')->assertOk()->json('setup');
    }

    private function steps(array $setup): array
    {
        return collect($setup['steps'])->keyBy('key')->all();
    }

    public function test_a_new_organization_admin_sees_every_step_open_with_working_links(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);

        $setup = $this->checklistFor($admin);
        $steps = $this->steps($setup);

        $this->assertSame(['positions', 'members', 'academic', 'budget', 'event'], array_keys($steps), 'No compliance step before the SAO publishes requirements.');
        $this->assertSame(0, $setup['completed']);
        $this->assertSame('/dashboard/admin/users', $steps['members']['href']);
        $this->assertSame('/dashboard/finance/budget-allocation', $steps['budget']['href']);
    }

    public function test_steps_check_themselves_off_from_real_records(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        SboPosition::create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'title' => 'Treasurer', 'is_active' => true]);
        Budget::factory()->create(['organization_id' => $organization->id]);
        DB::table('compliance_requirement_types')->insert(['academic_year' => '2026-2027', 'name' => 'Constitution and by-laws', 'deadline_at' => now()->addMonth(), 'is_active' => true, 'created_by' => $admin->school_id, 'created_at' => now(), 'updated_at' => now()]);

        $setup = $this->checklistFor($admin);
        $steps = $this->steps($setup);

        $this->assertTrue($steps['positions']['done']);
        $this->assertNull($steps['positions']['href'], 'A finished step needs no link.');
        $this->assertTrue($steps['budget']['done']);
        $this->assertFalse($steps['compliance']['done']);
        $this->assertSame('/dashboard/compliance', $steps['compliance']['href']);
        $this->assertSame(2, $setup['completed']);
        $this->assertSame(6, $setup['total']);
    }

    public function test_a_student_added_from_another_home_organization_counts_as_a_member(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $student = User::factory()->create(['role' => 'STUDENT', 'organization_id' => Organization::factory()->create()->id]);
        DB::table('account_profiles')->insert([
            'user_school_id' => $student->school_id,
            'organization_id' => $organization->id,
            'role' => 'STUDENT',
            'account_status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $steps = $this->steps($this->checklistFor($admin));

        $this->assertTrue($steps['members']['done']);
    }

    public function test_the_sao_checklist_counts_organizations_without_an_administrator(): void
    {
        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);
        $director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        $withAdmin = Organization::factory()->create();
        Organization::factory()->create();
        User::factory()->admin()->create(['organization_id' => $withAdmin->id]);

        $steps = $this->steps($this->checklistFor($director));

        $this->assertArrayNotHasKey('organizations', $steps, 'Applicants register organizations from the public home page.');
        $this->assertFalse($steps['admins']['done']);
        $this->assertSame('1 of 2 organizations have an active administrator.', $steps['admins']['detail']);
        $this->assertSame('/dashboard/organization-applications', $steps['admins']['href']);
    }

    public function test_a_student_checklist_omits_evaluation_even_when_a_window_is_open(): void
    {
        $organization = Organization::factory()->create();
        $student = User::factory()->create(['organization_id' => $organization->id, 'role' => 'STUDENT', 'account_status' => 'active', 'contact_number' => '09171234567']);
        DB::table('evaluation_windows')->insert(['title' => 'First semester evaluation', 'status' => 'open', 'created_at' => now(), 'updated_at' => now()]);

        $steps = $this->steps($this->checklistFor($student));

        $this->assertSame(['contact', 'fingerprint', 'event'], array_keys($steps));
        $this->assertTrue($steps['contact']['done']);
        $this->assertNull($steps['fingerprint']['href'], 'Fingerprint enrollment happens in person, so there is nothing to link.');
        $this->assertSame('/dashboard/events/activity-calendar', $steps['event']['href']);
    }

    public function test_the_sao_checklist_asks_for_a_department_head_in_every_college(): void
    {
        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);
        $director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        DB::table('colleges')->delete();
        $ccs = $this->makeCollege('CCS');
        $cbe = $this->makeCollege('CBE');
        College::create(['name' => 'College of Retired Studies', 'code' => 'CRS', 'is_active' => false]);
        $this->makeCollegeHead($ccs);

        $setup = $this->checklistFor($director);
        $steps = $this->steps($setup);

        $this->assertSame(['academic-year', 'semester', 'semester-active', 'colleges', 'college-heads', 'school-records', 'requirements', 'admins', 'venues', 'announcement'], array_keys($steps));
        $this->assertFalse($steps['college-heads']['done']);
        $this->assertSame('Every college has a Department Head', $steps['college-heads']['label']);
        $this->assertSame('1 of 2 colleges have an active Department Head.', $steps['college-heads']['detail']);
        $this->assertSame('/dashboard/super-admin/colleges', $steps['college-heads']['href']);

        $this->app['auth']->forgetGuards();
        $this->makeCollegeHead($cbe);

        $steps = $this->steps($this->checklistFor($director));

        $this->assertTrue($steps['college-heads']['done']);
        $this->assertNull($steps['college-heads']['href']);
    }

    public function test_the_sao_checklist_follows_the_real_order_and_ticks_from_the_calendar_and_the_records(): void
    {
        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);
        $director = User::factory()->superAdmin()->create(['organization_id' => $sao->id, 'account_status' => 'active']);
        DB::table('colleges')->delete();

        $steps = $this->steps($this->checklistFor($director));
        $this->assertSame('/dashboard/super-admin/academic-years', $steps['academic-year']['href']);
        $this->assertSame('/dashboard/super-admin/academic-years', $steps['semester']['href']);
        $this->assertSame('/dashboard/super-admin/academic-years', $steps['semester-active']['href']);
        $this->assertSame('/dashboard/super-admin/colleges', $steps['colleges']['href']);
        $this->assertSame('/dashboard/super-admin/student-records', $steps['school-records']['href']);
        $this->assertSame('Add the colleges first.', $steps['school-records']['detail']);
        foreach (['academic-year', 'semester', 'semester-active', 'colleges', 'school-records'] as $key) {
            $this->assertFalse($steps[$key]['done'], $key);
        }

        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        $semester = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'upcoming']);
        $ccs = $this->makeCollege('CCS');
        $this->makeCollege('CBE');
        $this->app['auth']->forgetGuards();
        $steps = $this->steps($this->checklistFor($director));
        $this->assertSame([true, true, false, true, false], array_map(fn (string $key) => $steps[$key]['done'], ['academic-year', 'semester', 'semester-active', 'colleges', 'school-records']));
        $this->assertSame('0 of 2 colleges have school records.', $steps['school-records']['detail']);

        $semester->update(['status' => 'active']);
        StudentRegistryEntry::create(['school_id' => 2600001, 'first_name' => 'Ana', 'last_name' => 'Reyes', 'birth_date' => '2005-01-01', 'college_id' => $ccs->id, 'program' => 'BSIT', 'year_level' => '1st Year']);
        $this->app['auth']->forgetGuards();
        $steps = $this->steps($this->checklistFor($director));
        $this->assertTrue($steps['semester-active']['done']);
        $this->assertFalse($steps['school-records']['done'], 'One college of two is not every college.');
        $this->assertSame('1 of 2 colleges have school records.', $steps['school-records']['detail']);
    }

    public function test_the_sao_organizations_step_no_longer_asks_for_a_registration_the_sao_cannot_make(): void
    {
        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);
        $director = User::factory()->superAdmin()->create(['organization_id' => $sao->id, 'account_status' => 'active']);

        $steps = $this->steps($this->checklistFor($director));

        $this->assertSame('No organization has been approved yet. Applications arrive once a Department Head endorses them.', $steps['admins']['detail']);
    }

    public function test_the_department_head_is_asked_for_school_records_and_office_staff_first(): void
    {
        $college = $this->makeCollege('CCS');
        $head = $this->makeCollegeHead($college, ['account_status' => 'active']);
        $home = $head->organization;

        $steps = $this->steps($this->checklistFor($head));
        $this->assertFalse($steps['student-records']['done']);
        $this->assertSame('/dashboard/department-head/people', $steps['student-records']['href']);
        $this->assertFalse($steps['office-staff']['done']);
        $this->assertSame('/dashboard/department-head/people', $steps['office-staff']['href']);

        StudentRegistryEntry::create(['school_id' => 2600001, 'first_name' => 'Ana', 'last_name' => 'Reyes', 'birth_date' => '2005-01-01', 'college_id' => $college->id, 'program' => 'BSIT', 'year_level' => '1st Year']);
        DepartmentHeadInvitation::create(['college_id' => $college->id, 'role' => 'ADMIN', 'token_hash' => hash('sha256', 'staff'), 'invited_by' => $head->school_id, 'expires_at' => now()->addDays(3)]);
        $this->app['auth']->forgetGuards();
        $steps = $this->steps($this->checklistFor($head));
        $this->assertTrue($steps['student-records']['done']);
        $this->assertTrue($steps['office-staff']['done'], 'A staff link that is waiting to be used counts.');

        DepartmentHeadInvitation::query()->delete();
        $this->app['auth']->forgetGuards();
        $this->assertFalse($this->steps($this->checklistFor($head))['office-staff']['done']);

        User::factory()->admin()->create(['organization_id' => $home->id, 'account_status' => 'active']);
        $this->app['auth']->forgetGuards();
        $this->assertTrue($this->steps($this->checklistFor($head))['office-staff']['done']);
    }

    public function test_another_colleges_school_records_do_not_tick_the_deans_step(): void
    {
        $head = $this->makeCollegeHead($this->makeCollege('CCS'), ['account_status' => 'active']);
        $other = $this->makeCollege('CBE');
        StudentRegistryEntry::create(['school_id' => 2600002, 'first_name' => 'Ben', 'last_name' => 'Cruz', 'birth_date' => '2005-01-01', 'college_id' => $other->id, 'program' => 'BSIT', 'year_level' => '1st Year']);

        $this->assertFalse($this->steps($this->checklistFor($head))['student-records']['done']);
    }

    public function test_college_office_staff_get_their_own_short_checklist_not_an_organization_admins(): void
    {
        $college = $this->makeCollege('CCS');
        $head = $this->makeCollegeHead($college, ['account_status' => 'active']);
        $staff = User::factory()->admin()->create(['organization_id' => $head->organization_id, 'account_status' => 'active', 'contact_number' => null]);
        $this->application($college, 'pending_dean');

        $setup = $this->checklistFor($staff);
        $steps = $this->steps($setup);

        $this->assertSame(['contact', 'endorse'], array_keys($steps));
        $this->assertSame('/dashboard/profile', $steps['contact']['href']);
        $this->assertSame('/dashboard/organization-applications', $steps['endorse']['href']);
        $this->assertSame('1 application awaiting your review before SAO.', $steps['endorse']['detail']);
        $this->assertSame(0, $setup['completed']);

        $staff->update(['contact_number' => '09171234567']);
        DB::table('organization_applications')->update(['status' => 'pending_sao', 'endorsed_by' => $staff->school_id, 'endorsed_at' => now()]);
        $this->app['auth']->forgetGuards();
        $steps = $this->steps($this->checklistFor($staff));
        $this->assertTrue($steps['contact']['done']);
        $this->assertTrue($steps['endorse']['done']);
    }

    public function test_a_college_whose_head_is_deactivated_is_not_covered(): void
    {
        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);
        $director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        DB::table('colleges')->delete();
        $this->makeCollegeHead($this->makeCollege('CCS'), ['account_status' => 'inactive']);

        $steps = $this->steps($this->checklistFor($director));

        $this->assertFalse($steps['college-heads']['done']);
    }

    public function test_a_department_head_checklist_points_to_endorsement_instead_of_registration(): void
    {
        $college = $this->makeCollege('CCS');
        $head = $this->makeCollegeHead($college, ['contact_number' => null]);

        $setup = $this->checklistFor($head);
        $steps = $this->steps($setup);

        $this->assertSame(['student-records', 'office-staff', 'endorse', 'review'], array_keys($steps));
        $this->assertSame(0, $setup['completed']);
        $this->assertSame(4, $setup['total']);
        $this->assertSame('Review organization applications', $steps['endorse']['label']);
        $this->assertSame('/dashboard/organization-applications', $steps['endorse']['href']);
        $this->assertStringContainsString('Allow a student to apply from Organizations', $steps['endorse']['detail']);
        $this->assertArrayNotHasKey('register', $steps);
    }

    public function test_the_department_head_endorsement_step_tracks_applications_in_its_college(): void
    {
        $college = $this->makeCollege('CCS');
        $head = $this->makeCollegeHead($college);
        $otherCollege = $this->makeCollege('CBE');
        $this->application($otherCollege, 'pending_dean');
        $pending = $this->application($college, 'pending_dean');
        $steps = $this->steps($this->checklistFor($head));
        $this->assertFalse($steps['endorse']['done']);
        $this->assertSame('1 application awaiting your review before SAO.', $steps['endorse']['detail']);

        $pending->update(['status' => 'pending_sao', 'endorsed_by' => $head->school_id, 'endorsed_at' => now()]);
        $this->app['auth']->forgetGuards();
        $steps = $this->steps($this->checklistFor($head));
        $this->assertTrue($steps['endorse']['done']);
        $this->assertNull($steps['endorse']['href']);
        $this->assertFalse($steps['review']['done']);
        $this->assertSame('/dashboard/department-head/approvals', $steps['review']['href']);
    }

    public function test_the_department_head_review_step_is_done_after_reviewing_an_approval_and_other_colleges_do_not_count(): void
    {
        $ccs = $this->makeCollege('CCS');
        $cbe = $this->makeCollege('CBE');
        $head = $this->makeCollegeHead($ccs);
        $otherHead = $this->makeCollegeHead($cbe);
        $this->makeCollegeStudentOrganization($cbe, ['lifecycle_status' => 'active']);
        $organization = $this->makeCollegeStudentOrganization($ccs);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        ApprovalRequest::create([
            'organization_id' => $organization->id, 'entity_type' => 'event', 'entity_id' => 1, 'requested_by' => $admin->school_id,
            'required_role' => 'DEPARTMENT_HEAD', 'status' => 'approved', 'reviewed_by' => $head->school_id, 'reviewed_at' => now(), 'requested_at' => now()->subDay(),
        ]);

        $steps = $this->steps($this->checklistFor($head));
        $this->assertTrue($steps['review']['done']);
        $this->assertNull($steps['review']['href']);

        $this->app['auth']->forgetGuards();
        $steps = $this->steps($this->checklistFor($otherHead));
        $this->assertFalse($steps['review']['done'], 'Another head reviewing does not tick this head step.');
        $this->assertFalse($steps['endorse']['done']);
    }

    private function application(College $college, string $status): OrganizationApplication
    {
        return OrganizationApplication::create([
            'college_id' => $college->id, 'name' => 'Application '.$college->id,
            'acronym' => 'APP'.$college->id, 'school_id' => 87651234,
            'first_name' => 'Alex', 'last_name' => 'Rivera', 'email' => 'alex@example.test',
            'position_title' => 'President', 'status' => $status, 'email_verified_at' => now(),
        ]);
    }
}
