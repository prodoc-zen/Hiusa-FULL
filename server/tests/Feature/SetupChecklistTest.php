<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\ApprovalRequest;
use App\Models\Budget;
use App\Models\College;
use App\Models\Organization;
use App\Models\SboPosition;
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

    public function test_the_sao_checklist_counts_organizations_without_an_administrator(): void
    {
        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);
        $director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        $withAdmin = Organization::factory()->create();
        Organization::factory()->create();
        User::factory()->admin()->create(['organization_id' => $withAdmin->id]);

        $steps = $this->steps($this->checklistFor($director));

        $this->assertArrayNotHasKey('organizations', $steps, 'Only Department Heads register organizations now.');
        $this->assertFalse($steps['admins']['done']);
        $this->assertSame('1 of 2 organizations have an active administrator.', $steps['admins']['detail']);
        $this->assertSame('/dashboard/super-admin/admins', $steps['admins']['href']);
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

        $this->assertSame(['academic-year', 'college-heads', 'admins', 'requirements', 'venues', 'announcement'], array_keys($steps));
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

    public function test_a_college_whose_head_is_deactivated_is_not_covered(): void
    {
        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);
        $director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        DB::table('colleges')->delete();
        $this->makeCollegeHead($this->makeCollege('CCS'), ['account_status' => 'inactive']);

        $steps = $this->steps($this->checklistFor($director));

        $this->assertFalse($steps['college-heads']['done']);
    }

    public function test_a_department_head_checklist_is_register_follow_review_and_waits_for_the_semester(): void
    {
        $college = $this->makeCollege('CCS');
        $head = $this->makeCollegeHead($college, ['contact_number' => null]);

        $setup = $this->checklistFor($head);
        $steps = $this->steps($setup);

        $this->assertSame(['register', 'follow', 'review'], array_keys($steps));
        $this->assertSame(0, $setup['completed']);
        $this->assertSame(3, $setup['total']);
        $this->assertTrue($steps['register']['blocked']);
        $this->assertSame('Waiting for the SAO to open the semester', $steps['register']['note']);
        $this->assertNull($steps['register']['href'], 'A blocked step has no button.');
        $this->assertFalse($steps['register']['done']);
        $this->assertArrayNotHasKey('blocked', $steps['follow']);

        $this->openSemester();

        $steps = $this->steps($this->checklistFor($head));

        $this->assertArrayNotHasKey('blocked', $steps['register']);
        $this->assertSame('/dashboard/department-head/organizations', $steps['register']['href']);
    }

    public function test_the_department_head_follow_step_tracks_pending_returned_and_active_registrations(): void
    {
        $college = $this->makeCollege('CCS');
        $head = $this->makeCollegeHead($college);
        $this->openSemester();

        $this->makeCollegeStudentOrganization($college, ['lifecycle_status' => 'pending']);
        $steps = $this->steps($this->checklistFor($head));
        $this->assertTrue($steps['register']['done']);
        $this->assertNull($steps['register']['href']);
        $this->assertFalse($steps['follow']['done']);
        $this->assertSame('Waiting for SAO review.', $steps['follow']['detail']);
        $this->assertSame('/dashboard/department-head/organizations?status=pending', $steps['follow']['href']);

        $this->makeCollegeStudentOrganization($college, ['lifecycle_status' => 'returned']);
        $this->app['auth']->forgetGuards();
        $steps = $this->steps($this->checklistFor($head));
        $this->assertFalse($steps['follow']['done']);
        $this->assertSame('1 returned by the SAO: edit and resubmit.', $steps['follow']['detail']);
        $this->assertSame('/dashboard/department-head/organizations?status=returned', $steps['follow']['href']);

        Organization::query()->where('college_id', $college->id)->where('organization_type', 'STUDENT_ORGANIZATION')->update(['lifecycle_status' => 'active']);
        $this->app['auth']->forgetGuards();
        $steps = $this->steps($this->checklistFor($head));
        $this->assertTrue($steps['follow']['done']);
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
        $this->assertTrue($steps['follow']['done']);
    }

    private function openSemester(): void
    {
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'active']);
    }
}
