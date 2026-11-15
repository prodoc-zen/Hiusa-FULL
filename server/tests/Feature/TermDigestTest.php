<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\Announcement;
use App\Models\Attendance;
use App\Models\Budget;
use App\Models\Election;
use App\Models\ElectionBallot;
use App\Models\Event;
use App\Models\Order;
use App\Models\Organization;
use App\Models\Task;
use App\Models\Transaction;
use App\Models\User;
use App\Services\Records\TermDigest;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** What an organization recorded in one semester, as the narrative and handover drafters read it. */
class TermDigestTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private Organization $other;

    private AcademicSemester $semester;

    private AcademicSemester $earlier;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => now()->subMonths(4)->toDateString(), 'ends_on' => now()->addMonths(6)->toDateString(), 'is_current' => true]);
        $this->earlier = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => now()->subMonths(4)->toDateString(), 'ends_on' => now()->subMonths(3)->toDateString(), 'status' => 'completed']);
        $this->semester = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 2, 'starts_on' => now()->subMonths(2)->toDateString(), 'ends_on' => now()->addMonths(1)->toDateString(), 'status' => 'active']);
        $this->organization = Organization::factory()->create(['name' => 'Computer Science Society']);
        $this->other = Organization::factory()->create();
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id, 'first_name' => 'Maria', 'last_name' => 'Santos', 'position_title' => 'Admin Adviser']);
    }

    private function event(array $overrides = []): Event
    {
        return Event::factory()->create([
            'organization_id' => $this->organization->id,
            'created_by' => $this->admin->school_id,
            'academic_semester_id' => $this->semester->id,
            'start_time' => now()->subDays(20),
            'end_time' => now()->subDays(20)->addHours(3),
            'status' => 'completed',
            ...$overrides,
        ]);
    }

    private function task(string $status, array $overrides = []): Task
    {
        return Task::factory()->create([
            'event_id' => null,
            'organization_id' => $this->organization->id,
            'created_by' => $this->admin->school_id,
            'assigned_to' => $this->admin->school_id,
            'academic_semester_id' => $this->semester->id,
            'status' => $status,
            ...$overrides,
        ]);
    }

    public function test_it_reads_one_semester_of_one_organization(): void
    {
        $contest = $this->event(['title' => 'Programming Contest', 'start_time' => now()->subDays(20)]);
        foreach (User::factory()->student()->count(3)->create() as $student) {
            Attendance::factory()->create(['event_id' => $contest->id, 'user_id' => $student->school_id, 'method' => 'manual']);
        }
        $budget = Budget::factory()->create(['organization_id' => $this->organization->id, 'event_id' => $contest->id, 'allocated_amount' => 25000, 'submission_status' => 'approved']);
        foreach ([['expense', 18400], ['expense', 100.5], ['income', 1000]] as [$type, $amount]) {
            Transaction::factory()->create(['organization_id' => $this->organization->id, 'budget_id' => $budget->id, 'type' => $type, 'amount' => $amount, 'transaction_date' => now()->subDays(19)]);
        }
        $cancelled = $this->event(['title' => 'Foundation Day', 'status' => 'cancelled', 'start_time' => now()->subDays(10)]);
        Attendance::factory()->create(['event_id' => $cancelled->id, 'user_id' => User::factory()->student()->create()->school_id, 'method' => 'manual']);
        Budget::factory()->create(['organization_id' => $this->organization->id, 'event_id' => $cancelled->id, 'allocated_amount' => 9000, 'submission_status' => 'pending_department_head']);
        $this->event(['title' => 'Foam Party', 'status' => 'approved', 'start_time' => now()->addDays(9)]);
        $this->event(['title' => 'Still Planning', 'status' => 'planning']);
        $this->event(['title' => 'Last Term Event', 'academic_semester_id' => $this->earlier->id]);
        Event::factory()->create(['organization_id' => $this->other->id, 'created_by' => $this->admin->school_id, 'academic_semester_id' => $this->semester->id, 'title' => 'Someone Else Event', 'status' => 'completed']);

        foreach (['completed', 'completed', 'overdue', 'pending', 'in_progress'] as $status) {
            $this->task($status);
        }
        $this->task('completed', ['academic_semester_id' => $this->earlier->id]);

        Announcement::factory()->create(['organization_id' => $this->organization->id, 'created_by' => $this->admin->school_id, 'academic_semester_id' => $this->semester->id, 'is_published' => true, 'target_role' => 'all']);
        Announcement::factory()->create(['organization_id' => $this->organization->id, 'created_by' => $this->admin->school_id, 'academic_semester_id' => $this->semester->id, 'is_published' => false, 'target_role' => 'all']);

        foreach (['claimed', 'paid', 'cancelled'] as $status) {
            Order::factory()->create(['organization_id' => $this->organization->id, 'status' => $status, 'created_at' => now()->subDays(15)]);
        }

        Transaction::factory()->create(['organization_id' => $this->organization->id, 'budget_id' => null, 'type' => 'income', 'amount' => 5000, 'transaction_date' => now()->subDays(30)]);
        Transaction::factory()->create(['organization_id' => $this->organization->id, 'budget_id' => null, 'type' => 'income', 'amount' => 700, 'transaction_date' => now()->subMonths(4)]);

        $election = Election::factory()->create(['organization_id' => $this->organization->id, 'academic_semester_id' => $this->semester->id, 'title' => 'SBO Election', 'status' => 'closed']);
        ElectionBallot::factory()->count(2)->create(['election_id' => $election->id, 'round' => 1]);
        Election::factory()->create(['organization_id' => $this->organization->id, 'academic_semester_id' => $this->semester->id, 'title' => 'Not Yet Open', 'status' => 'upcoming']);

        $digest = TermDigest::forOrganization($this->organization->id, $this->semester->id);

        $this->assertSame('Computer Science Society', $digest['organization']);
        $this->assertSame('2nd Semester 2026-2027', $digest['semester']);
        $this->assertSame(['Programming Contest', 'Foundation Day', 'Foam Party'], array_column($digest['events'], 'title'), 'planning, other-semester and other-organization events are left out, oldest first');
        [$held, $called, $scheduled] = $digest['events'];
        $this->assertSame(['completed', 3, 25000.0, 18500.5], [$held['status'], $held['attendance'], $held['budget_allocated'], $held['budget_used']], 'income against a budget is not spending');
        $this->assertSame(now()->subDays(20)->format('Y-m-d'), $held['date']);
        $this->assertSame(['cancelled', null, null, null], [$called['status'], $called['attendance'], $called['budget_allocated'], $called['budget_used']], 'a cancelled event has no attendance, and a budget that is not approved is not counted');
        $this->assertSame(['approved', null, null], [$scheduled['status'], $scheduled['attendance'], $scheduled['budget_used']]);
        $this->assertSame(['completed' => 2, 'overdue' => 1, 'open' => 2], $digest['tasks']);
        $this->assertSame(1, $digest['announcements']['posted']);
        $this->assertSame(['orders' => 2, 'claimed' => 1], $digest['merchandise'], 'a cancelled order is not an order');
        $this->assertSame([['title' => 'SBO Election', 'voters' => $digest['elections'][0]['voters'], 'ballots' => 2]], $digest['elections'], 'only an election that opened is reported');
        $this->assertSame(['Foam Party'], array_column($digest['upcoming_events'], 'title'));
        $this->assertSame([['name' => 'Maria Santos', 'position' => 'Admin Adviser']], $digest['officers']);
        $this->assertSame(['income' => 6000.0, 'expense' => 18500.5, 'closing_balance' => -11800.5], $digest['finance'], 'income and expense are this semester only, the closing balance runs to its last day');
    }

    public function test_a_semester_with_nothing_recorded_is_empty_and_not_an_error(): void
    {
        $digest = TermDigest::forOrganization($this->other->id, $this->semester->id);

        $this->assertSame([], $digest['events']);
        $this->assertSame(['completed' => 0, 'overdue' => 0, 'open' => 0], $digest['tasks']);
        $this->assertSame([], $digest['elections']);
        $this->assertSame(['orders' => 0, 'claimed' => 0], $digest['merchandise']);
        $this->assertSame(['posted' => 0], $digest['announcements']);
        $this->assertSame(['income' => 0.0, 'expense' => 0.0, 'closing_balance' => 0.0], $digest['finance']);
        $this->assertSame([], $digest['upcoming_events']);
    }

    public function test_a_digest_names_no_attendee_payer_or_file(): void
    {
        $student = User::factory()->student()->create(['first_name' => 'Ligaya', 'last_name' => 'Bautista']);
        $event = $this->event(['title' => 'Programming Contest']);
        Attendance::factory()->create(['event_id' => $event->id, 'user_id' => $student->school_id, 'method' => 'manual']);
        Transaction::factory()->create(['organization_id' => $this->organization->id, 'budget_id' => null, 'type' => 'income', 'amount' => 300, 'payer_id' => $student->school_id, 'description' => 'Dues from Ligaya Bautista', 'transaction_date' => now()->subDays(5)]);

        $encoded = json_encode(TermDigest::forOrganization($this->organization->id, $this->semester->id));

        $this->assertStringNotContainsString('Ligaya', $encoded);
        $this->assertStringNotContainsString((string) $student->school_id, $encoded);
        $this->assertStringNotContainsString('Dues from', $encoded);
    }

    public function test_the_officers_of_a_frozen_semester_come_from_its_record(): void
    {
        DB::table('organization_semester_records')->insert([
            'organization_id' => $this->organization->id, 'academic_semester_id' => $this->semester->id, 'lifecycle_status' => 'active',
            'officers' => json_encode([['school_id' => 1, 'name' => 'Former Treasurer', 'position_title' => 'Treasurer', 'role' => 'SBO_OFFICER'], ['school_id' => 2, 'name' => 'Former Admin', 'position_title' => null, 'role' => 'ADMIN']]),
            'created_at' => now(), 'updated_at' => now(),
        ]);

        $digest = TermDigest::forOrganization($this->organization->id, $this->semester->id);

        $this->assertSame([['name' => 'Former Treasurer', 'position' => 'Treasurer'], ['name' => 'Former Admin', 'position' => 'Admin']], $digest['officers']);
    }

    public function test_open_items_list_what_is_still_owed(): void
    {
        $this->task('pending', ['title' => 'Liquidate the fund', 'deadline' => now()->addDays(5)]);
        $this->task('completed');
        $this->event(['title' => 'Foam Party', 'status' => 'approved', 'start_time' => now()->addDays(9)]);
        DB::table('cash_advances')->insert(['organization_id' => $this->organization->id, 'reference' => 'CA-1', 'borrower_id' => $this->admin->school_id, 'amount' => 2000, 'purpose' => 'Secret purpose text', 'status' => 'partially_repaid', 'created_at' => now(), 'updated_at' => now()]);
        DB::table('cash_advance_repayments')->insert(['cash_advance_id' => DB::table('cash_advances')->value('id'), 'amount' => 500, 'recorded_by' => $this->admin->school_id, 'repaid_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
        Election::factory()->create(['organization_id' => $this->organization->id, 'academic_semester_id' => $this->semester->id, 'status' => 'active', 'end_time' => now()->addDay()]);

        $open = TermDigest::openItems($this->organization->id, $this->semester->id);

        $this->assertSame([['title' => 'Liquidate the fund', 'owner' => 'Maria Santos', 'deadline' => now()->addDays(5)->format('Y-m-d')]], $open['pending_tasks']);
        $this->assertSame([['kind' => 'cash_advance', 'amount' => 1500.0, 'note' => 'A cash advance is not fully repaid.']], $open['unsettled']);
        $this->assertStringNotContainsString('Secret purpose', json_encode($open));
        $this->assertSame(['Foam Party'], array_column($open['scheduled_events'], 'title'));
        $this->assertSame('open', $open['election_state']);
        $this->assertSame([], $open['missing_compliance']);
    }

    public function test_requirements_not_yet_submitted_are_missing(): void
    {
        $submitted = DB::table('compliance_requirement_types')->insertGetId(['name' => 'Accomplishment Report', 'category' => 'semestral_report', 'academic_year' => '2026-2027', 'academic_semester_id' => $this->semester->id, 'is_active' => true, 'deadline_at' => now()->addDays(10), 'created_by' => $this->admin->school_id, 'created_at' => now(), 'updated_at' => now()]);
        DB::table('compliance_requirement_types')->insert(['name' => 'Action Plan', 'category' => 'semestral_report', 'academic_year' => '2026-2027', 'academic_semester_id' => $this->semester->id, 'is_active' => true, 'deadline_at' => now()->addDays(10), 'created_by' => $this->admin->school_id, 'created_at' => now(), 'updated_at' => now()]);
        DB::table('compliance_requirement_types')->insert(['name' => 'Old Requirement', 'category' => 'organization', 'academic_year' => '2026-2027', 'academic_semester_id' => $this->earlier->id, 'is_active' => true, 'deadline_at' => now()->addDays(10), 'created_by' => $this->admin->school_id, 'created_at' => now(), 'updated_at' => now()]);
        DB::table('organization_compliance_submissions')->insert(['organization_id' => $this->organization->id, 'requirement_type_id' => $submitted, 'status' => 'submitted', 'file_path' => 'x.pdf', 'file_original_name' => 'x.pdf', 'mime_type' => 'application/pdf', 'file_size' => 1, 'submitted_by' => $this->admin->school_id, 'submitted_at' => now(), 'created_at' => now(), 'updated_at' => now()]);

        $this->assertSame(['Action Plan'], TermDigest::openItems($this->organization->id, $this->semester->id)['missing_compliance']);
        $this->assertSame(['Accomplishment Report', 'Action Plan'], TermDigest::openItems($this->other->id, $this->semester->id)['missing_compliance']);
    }
}
