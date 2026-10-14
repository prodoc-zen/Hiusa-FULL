<?php

namespace Tests\Feature;

use App\Models\ApprovalRequest;
use App\Models\Budget;
use App\Models\College;
use App\Models\Organization;
use App\Models\OrganizationApplication;
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

    public function test_a_department_head_checklist_points_to_endorsement_instead_of_registration(): void
    {
        $college = $this->makeCollege('CCS');
        $head = $this->makeCollegeHead($college, ['contact_number' => null]);

        $setup = $this->checklistFor($head);
        $steps = $this->steps($setup);

        $this->assertSame(['endorse', 'review'], array_keys($steps));
        $this->assertSame(0, $setup['completed']);
        $this->assertSame(2, $setup['total']);
        $this->assertSame('Review organization applications', $steps['endorse']['label']);
        $this->assertSame('/dashboard/organization-applications', $steps['endorse']['href']);
        $this->assertStringContainsString('Applicants apply from the HIUSA home page', $steps['endorse']['detail']);
        $this->assertArrayNotHasKey('register', $steps);
    }

    public function test_the_department_head_endorsement_step_tracks_verified_applications_in_its_college(): void
    {
        $college = $this->makeCollege('CCS');
        $head = $this->makeCollegeHead($college);
        $otherCollege = $this->makeCollege('CBE');
        $this->application($otherCollege, 'pending_endorsement');
        $pending = $this->application($college, 'pending_endorsement');
        $steps = $this->steps($this->checklistFor($head));
        $this->assertFalse($steps['endorse']['done']);
        $this->assertSame('1 verified application awaiting your endorsement before SAO review.', $steps['endorse']['detail']);

        $pending->update(['status' => 'endorsed', 'endorsed_by' => $head->school_id, 'endorsed_at' => now()]);
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
