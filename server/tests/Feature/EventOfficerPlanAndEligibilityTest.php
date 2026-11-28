<?php

namespace Tests\Feature;

use App\Models\AccountProfile;
use App\Models\AiOutput;
use App\Models\Attendance;
use App\Models\Event;
use App\Models\Invoice;
use App\Models\InvoicePayment;
use App\Models\Organization;
use App\Models\StudentRegistryEntry;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

class EventOfficerPlanAndEligibilityTest extends TestCase
{
    use CreatesCollegeFixtures, RefreshDatabase;

    private Organization $organization;

    private User $admin;

    private User $officer;

    private Event $event;

    protected function setUp(): void
    {
        parent::setUp();

        $college = $this->makeCollege('CCS');
        $this->makeCollegeHome($college);
        $this->organization = $this->makeCollegeStudentOrganization($college);
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        $this->officer = User::factory()->officer()->create(['organization_id' => $this->organization->id, 'account_status' => 'active']);
        $this->event = Event::factory()->create([
            'organization_id' => $this->organization->id, 'created_by' => $this->admin->school_id, 'status' => 'ongoing',
        ]);
    }

    private function plan(Event $event, string $decision, int $version, string $overview = 'Plan overview'): AiOutput
    {
        return AiOutput::create([
            'organization_id' => $event->organization_id,
            'feature_type' => 'EVENT_WORKFLOW',
            'reference_type' => Event::class,
            'reference_id' => $event->id,
            'prompt_text' => 'internal prompt text',
            'output_text' => $overview,
            'model_name' => 'test-model',
            'structured_input' => ['budget' => 'internal budget context'],
            'structured_output' => [
                'overview' => $overview,
                'timeline' => ['Approve scope'],
                'preparation_phases' => ['Confirm scope'],
                'resources' => ['Room'], 'logistics' => ['Sound'], 'risks' => [], 'scheduling_conflicts' => [],
                'tasks' => [['key' => 'a', 'title' => 'Confirm scope', 'phase' => 'pre_event', 'priority' => 'high', 'deadline' => null, 'recommendation' => ['rankings' => [['officer_id' => 1, 'final_score' => 0.9]]]]],
            ],
            'status' => 'completed',
            'decision_status' => $decision,
            'version' => $version,
        ]);
    }

    public function test_officer_of_the_organization_reads_only_the_confirmed_plan_without_internal_fields(): void
    {
        $this->plan($this->event, 'discarded', 1, 'Old discarded plan');
        $this->plan($this->event, 'accepted', 2, 'Confirmed plan');
        $this->plan($this->event, 'pending', 3, 'Unreviewed draft');

        Sanctum::actingAs($this->officer);
        $response = $this->getJson("/api/events/{$this->event->id}/workflows")->assertOk();

        $response->assertJsonCount(1);
        $response->assertJsonPath('0.decision_status', 'accepted');
        $response->assertJsonPath('0.structured_output.overview', 'Confirmed plan');
        $response->assertJsonMissingPath('0.prompt_text');
        $response->assertJsonMissingPath('0.structured_input');
        $response->assertJsonMissingPath('0.structured_output.tasks.0.recommendation');
        $response->assertJsonPath('0.structured_output.tasks.0.title', 'Confirm scope');
    }

    public function test_officer_sees_the_latest_draft_when_nothing_is_confirmed_yet(): void
    {
        $this->plan($this->event, 'discarded', 1);
        $this->plan($this->event, 'pending', 2, 'Latest draft');

        Sanctum::actingAs($this->officer);
        $this->getJson("/api/events/{$this->event->id}/workflows")->assertOk()
            ->assertJsonCount(1)->assertJsonPath('0.decision_status', 'pending')->assertJsonPath('0.structured_output.overview', 'Latest draft');
    }

    public function test_admin_still_reads_the_whole_plan_history(): void
    {
        $this->plan($this->event, 'discarded', 1);
        $this->plan($this->event, 'accepted', 2);

        Sanctum::actingAs($this->admin);
        $this->getJson("/api/events/{$this->event->id}/workflows")->assertOk()->assertJsonCount(2)->assertJsonPath('0.prompt_text', 'internal prompt text');
    }

    public function test_officer_of_another_organization_cannot_read_the_plan(): void
    {
        $this->plan($this->event, 'accepted', 1);
        $other = User::factory()->officer()->create(['organization_id' => Organization::factory()->create()->id, 'account_status' => 'active']);

        Sanctum::actingAs($other);
        $this->getJson("/api/events/{$this->event->id}/workflows")->assertNotFound();
    }

    public function test_officer_without_the_events_module_is_refused(): void
    {
        $this->plan($this->event, 'accepted', 1);
        AccountProfile::where('user_school_id', $this->officer->school_id)->update(['modules' => ['finance']]);

        Sanctum::actingAs($this->officer);
        $this->getJson("/api/events/{$this->event->id}/workflows")->assertForbidden();
    }

    public function test_students_and_confirm_or_discard_stay_closed_to_officers(): void
    {
        $plan = $this->plan($this->event, 'pending', 1);

        Sanctum::actingAs($this->officer);
        $this->postJson("/api/events/{$this->event->id}/workflows/{$plan->id}/confirm", ['tasks' => []])->assertForbidden();
        $this->patchJson("/api/events/{$this->event->id}/workflows/{$plan->id}/discard")->assertForbidden();
        $this->postJson("/api/events/{$this->event->id}/generate-plan", [])->assertForbidden();

        $student = User::factory()->student()->create(['organization_id' => $this->organization->id]);
        Sanctum::actingAs($student);
        $this->getJson("/api/events/{$this->event->id}/workflows")->assertForbidden();
        $this->assertSame('pending', $plan->fresh()->decision_status);
    }

    private function member(array $registry = [], ?string $invoice = null): User
    {
        $student = User::factory()->student()->create(['organization_id' => $this->organization->id, 'account_status' => 'active']);
        if ($registry) {
            StudentRegistryEntry::create([
                'school_id' => $student->school_id, 'first_name' => 'Reg', 'last_name' => 'Istered', 'birth_date' => '2005-01-02',
                'college_id' => $this->organization->college_id, 'program' => 'BSIT', 'year_level' => '1st Year', 'record_type' => 'student',
            ]);
        }
        if ($invoice) {
            $row = Invoice::create([
                'organization_id' => $this->organization->id, 'reference' => 'INV-'.$student->school_id, 'student_id' => $student->school_id,
                'description' => 'Membership Fee', 'amount_due' => 100, 'status' => $invoice === 'paid' ? 'paid' : 'unpaid',
                'due_date' => $invoice === 'overdue' ? now()->subWeek()->toDateString() : now()->addWeek()->toDateString(),
            ]);
            if ($invoice === 'paid') {
                InvoicePayment::create(['invoice_id' => $row->id, 'amount' => 100, 'status' => 'approved', 'recorded_by' => $this->admin->school_id]);
            }
        }

        return $student;
    }

    private function loadRegistryFor(): void
    {
        $this->member(['x'])->delete();
    }

    public function test_check_in_reports_enrolled_and_dues_clear(): void
    {
        $student = $this->member(['x'], 'paid');

        Sanctum::actingAs($this->officer);
        $this->postJson("/api/events/{$this->event->id}/attendance", ['user_id' => $student->school_id, 'method' => 'manual'])
            ->assertCreated()
            ->assertJsonPath('eligibility.enrollment', 'enrolled')
            ->assertJsonPath('eligibility.dues', 'clear')
            ->assertJsonPath('eligibility.flagged', false);
    }

    public function test_check_in_flags_a_member_missing_from_school_records_but_still_records_it(): void
    {
        $this->loadRegistryFor();
        $student = $this->member();

        Sanctum::actingAs($this->officer);
        $this->postJson("/api/events/{$this->event->id}/attendance", ['user_id' => $student->school_id, 'method' => 'manual'])
            ->assertCreated()
            ->assertJsonPath('eligibility.enrollment', 'not_in_records')
            ->assertJsonPath('eligibility.flagged', true);
        $this->assertSame(1, Attendance::where('event_id', $this->event->id)->count());
    }

    public function test_a_college_with_no_school_records_loaded_is_not_checked_rather_than_not_enrolled(): void
    {
        $student = $this->member();

        Sanctum::actingAs($this->officer);
        $this->postJson("/api/events/{$this->event->id}/attendance", ['user_id' => $student->school_id, 'method' => 'manual'])
            ->assertCreated()
            ->assertJsonPath('eligibility.enrollment', 'not_checked')
            ->assertJsonPath('eligibility.flagged', false);
    }

    public function test_unpaid_and_overdue_dues_flag_the_member_and_paid_dues_do_not(): void
    {
        $unpaid = $this->member(['x'], 'unpaid');
        $overdue = $this->member(['x'], 'overdue');
        $paid = $this->member(['x'], 'paid');

        Sanctum::actingAs($this->admin);
        $this->getJson("/api/events/{$this->event->id}/attendance/eligibility?user_id={$unpaid->school_id}")->assertOk()
            ->assertJsonPath('dues', 'unpaid')->assertJsonPath('flagged', true)->assertJsonPath('dues_balance', 100);
        $this->getJson("/api/events/{$this->event->id}/attendance/eligibility?user_id={$overdue->school_id}")->assertOk()
            ->assertJsonPath('dues', 'overdue')->assertJsonPath('flagged', true);
        $this->getJson("/api/events/{$this->event->id}/attendance/eligibility?user_id={$paid->school_id}")->assertOk()
            ->assertJsonPath('dues', 'clear')->assertJsonPath('flagged', false);
    }

    public function test_attendance_rows_carry_each_attendee_eligibility(): void
    {
        $clear = $this->member(['x']);
        $owing = $this->member(['x'], 'unpaid');
        Attendance::factory()->create(['event_id' => $this->event->id, 'user_id' => $clear->school_id, 'status' => 'present', 'method' => 'manual']);
        Attendance::factory()->create(['event_id' => $this->event->id, 'user_id' => $owing->school_id, 'status' => 'present', 'method' => 'manual']);

        Sanctum::actingAs($this->officer);
        $rows = collect($this->getJson("/api/events/{$this->event->id}/attendance")->assertOk()->json('records'))->keyBy('user_id');

        $this->assertFalse($rows[$clear->school_id]['eligibility']['flagged']);
        $this->assertTrue($rows[$owing->school_id]['eligibility']['flagged']);
        $this->assertSame('unpaid', $rows[$owing->school_id]['eligibility']['dues']);
    }

    public function test_dues_of_another_organization_do_not_flag_the_member_here(): void
    {
        $student = $this->member(['x']);
        $elsewhere = Organization::factory()->create();
        Invoice::create(['organization_id' => $elsewhere->id, 'reference' => 'INV-ELSE', 'student_id' => $student->school_id, 'description' => 'Fee', 'amount_due' => 50, 'status' => 'unpaid']);

        Sanctum::actingAs($this->officer);
        $this->getJson("/api/events/{$this->event->id}/attendance/eligibility?user_id={$student->school_id}")->assertOk()->assertJsonPath('dues', 'clear');
    }

    public function test_the_eligibility_lookup_refuses_a_school_id_outside_the_organization(): void
    {
        $this->loadRegistryFor();
        $outsider = User::factory()->student()->create([
            'organization_id' => Organization::factory()->create()->id, 'account_status' => 'active',
        ]);
        StudentRegistryEntry::create([
            'school_id' => $outsider->school_id, 'first_name' => 'Out', 'last_name' => 'Sider', 'birth_date' => '2005-01-02',
            'college_id' => $this->organization->college_id, 'program' => 'BSIT', 'year_level' => '1st Year', 'record_type' => 'student',
        ]);

        Sanctum::actingAs($this->officer);
        $this->getJson("/api/events/{$this->event->id}/attendance/eligibility?user_id={$outsider->school_id}")
            ->assertStatus(422)
            ->assertExactJson(['message' => 'Selected user does not belong to this organization.']);
        $this->getJson("/api/events/{$this->event->id}/attendance/eligibility?user_id=999999999")
            ->assertStatus(422);
    }

    public function test_the_eligibility_lookup_is_for_this_organizations_officers_only(): void
    {
        $student = $this->member(['x']);

        Sanctum::actingAs($student);
        $this->getJson("/api/events/{$this->event->id}/attendance/eligibility?user_id={$student->school_id}")->assertForbidden();

        $other = User::factory()->officer()->create(['organization_id' => Organization::factory()->create()->id, 'account_status' => 'active']);
        Sanctum::actingAs($other);
        $this->getJson("/api/events/{$this->event->id}/attendance/eligibility?user_id={$student->school_id}")->assertNotFound();
    }

    public function test_an_officer_without_finance_access_gets_the_dues_flag_but_not_the_amount(): void
    {
        $owing = $this->member(['x'], 'unpaid');
        Attendance::factory()->create(['event_id' => $this->event->id, 'user_id' => $owing->school_id, 'status' => 'present', 'method' => 'manual']);
        $publicInfo = User::factory()->officer()->create(['organization_id' => $this->organization->id, 'account_status' => 'active', 'position_title' => 'Public Information Officer']);

        Sanctum::actingAs($publicInfo);
        $lookup = $this->getJson("/api/events/{$this->event->id}/attendance/eligibility?user_id={$owing->school_id}")->assertOk()
            ->assertJsonPath('dues', 'unpaid')->assertJsonPath('flagged', true)->json();
        $this->assertArrayNotHasKey('dues_balance', $lookup);

        $row = collect($this->getJson("/api/events/{$this->event->id}/attendance")->assertOk()->json('records'))->firstWhere('user_id', $owing->school_id);
        $this->assertSame('unpaid', $row['eligibility']['dues']);
        $this->assertTrue($row['eligibility']['flagged']);
        $this->assertArrayNotHasKey('dues_balance', $row['eligibility']);

        $checkIn = $this->member(['x'], 'unpaid');
        $reply = $this->postJson("/api/events/{$this->event->id}/attendance", ['user_id' => $checkIn->school_id, 'method' => 'manual'])->assertCreated()->json();
        $this->assertSame('unpaid', $reply['eligibility']['dues']);
        $this->assertArrayNotHasKey('dues_balance', $reply['eligibility']);
    }

    public function test_an_officer_with_finance_access_and_the_admin_get_the_dues_amount(): void
    {
        $owing = $this->member(['x'], 'unpaid');
        Attendance::factory()->create(['event_id' => $this->event->id, 'user_id' => $owing->school_id, 'status' => 'present', 'method' => 'manual']);
        $treasurer = User::factory()->officer()->create(['organization_id' => $this->organization->id, 'account_status' => 'active', 'position_title' => 'Treasurer']);

        foreach ([$treasurer, $this->admin] as $viewer) {
            Sanctum::actingAs($viewer);
            $this->getJson("/api/events/{$this->event->id}/attendance/eligibility?user_id={$owing->school_id}")->assertOk()->assertJsonPath('dues_balance', 100);
            $row = collect($this->getJson("/api/events/{$this->event->id}/attendance")->assertOk()->json('records'))->firstWhere('user_id', $owing->school_id);
            $this->assertEquals(100, $row['eligibility']['dues_balance']);
        }
    }
}
