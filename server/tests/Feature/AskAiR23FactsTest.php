<?php

namespace Tests\Feature;

use App\Contracts\TextGenerator;
use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\ApprovalRequest;
use App\Models\Budget;
use App\Models\Event;
use App\Models\FinancialReportDeadline;
use App\Models\Organization;
use App\Models\Task;
use App\Models\Transaction;
use App\Models\User;
use App\Services\Ai\AiInstructions;
use App\Services\Ai\AskAiService;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\RateLimiter;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\Support\AskAiChatFakeGenerator;
use Tests\TestCase;

/**
 * r23: four Ask AI answers that were wrong because the facts or the routing were wrong, not the writer.
 * P1 upcoming events with their tasks, P2 the budgets waiting for the Department Head with their amounts,
 * P3 what to do before submitting the financial report, P4 a budget whose remaining amount is above its allocation.
 * Every date is pinned, so the tests do not drift with the calendar.
 */
class AskAiR23FactsTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['performance.api_cache.enabled' => false, 'services.groq.key' => '', 'services.anthropic.key' => '']);
        RateLimiter::for('ai-generation', fn () => Limit::none());
        $this->travelTo(Carbon::parse('2026-11-25 08:00:00'));

        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-06-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        $this->semester = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-06-01', 'ends_on' => '2026-12-31', 'status' => 'active']);
    }

    private AcademicSemester $semester;

    private function org(array $overrides = []): Organization
    {
        return Organization::factory()->create([
            'organization_type' => 'STUDENT_ORGANIZATION',
            'lifecycle_status' => 'active',
            'is_active' => true,
            ...$overrides,
        ]);
    }

    private function service(): AskAiService
    {
        return $this->app->make(AskAiService::class);
    }

    private function fake(array $chunks = []): AskAiChatFakeGenerator
    {
        $fake = new AskAiChatFakeGenerator($chunks, null, 'claude-test');
        $this->app->instance(TextGenerator::class, $fake);

        return $fake;
    }

    private function factsOf(AskAiChatFakeGenerator $fake): array
    {
        $turn = $fake->lastUserTurn();

        return json_decode(substr($turn, strpos($turn, '```json') + 8, strrpos($turn, '```') - strpos($turn, '```json') - 8), true);
    }

    private function section(array $payload, string $id): array
    {
        return collect($payload['sections'])->firstWhere('id', $id) ?? ['rows' => []];
    }

    private function rowText(array $rows): string
    {
        return implode("\n", array_map(fn (array $row) => implode(' | ', array_filter([$row['primary'] ?? null, $row['secondary'] ?? null, $row['status'] ?? null, $row['meta'] ?? null])), $rows));
    }

    private function event(Organization $org, User $creator, string $title, string $status, string $start, string $end, array $overrides = []): Event
    {
        return Event::factory()->create([
            'organization_id' => $org->id,
            'created_by' => $creator->school_id,
            'academic_semester_id' => $this->semester->id,
            'title' => $title,
            'status' => $status,
            'start_time' => $start,
            'end_time' => $end,
            'location' => 'University Gymnasium',
            ...$overrides,
        ]);
    }

    // -------------------------------------------------------------------------
    // P1: What events are coming up and what tasks do they have?
    // -------------------------------------------------------------------------

    /** The shape of the seeded PSITS data: one ongoing event, one approved, one still planning, and two that must stay out. */
    private function psitsEvents(Organization $org, User $admin, User $vp): array
    {
        $ongoing = $this->event($org, $admin, 'Leadership Seminar 2024', 'ongoing', '2026-11-23 08:00:00', '2026-11-28 17:00:00');
        $sports = $this->event($org, $admin, 'Sports Fest 2024', 'approved', '2026-12-08 07:00:00', '2026-12-08 18:00:00');
        $induction = $this->event($org, $admin, 'Induction and Recognition Ceremony', 'planning', '2026-12-24 17:00:00', '2026-12-24 21:00:00');
        $this->event($org, $admin, 'General Assembly', 'completed', '2026-09-10 08:00:00', '2026-09-10 12:00:00');
        $this->event($org, $admin, 'Cancelled Mixer', 'cancelled', '2026-12-12 08:00:00', '2026-12-12 12:00:00');

        Task::factory()->create(['organization_id' => $org->id, 'event_id' => $sports->id, 'title' => 'Source merchandise suppliers for Sports Fest', 'assigned_to' => $vp->school_id, 'created_by' => $admin->school_id, 'status' => 'pending', 'deadline' => '2026-12-15 16:47:31']);
        Task::factory()->create(['organization_id' => $org->id, 'event_id' => $ongoing->id, 'title' => 'Print seminar certificates', 'assigned_to' => $admin->school_id, 'created_by' => $admin->school_id, 'status' => 'in_progress', 'deadline' => '2026-11-27 12:00:00']);

        return [$ongoing, $sports, $induction];
    }

    public function test_p1_a_question_about_events_and_their_tasks_is_read_as_the_events_answer_not_the_task_list(): void
    {
        foreach (['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD'] as $role) {
            $this->assertSame('events_attendance', $this->service()->classifyIntent('What events are coming up and what tasks do they have?', null, $role), $role);
            $this->assertSame('events_attendance', $this->service()->classifyIntent('Which upcoming events still have tasks open?', null, $role), $role);
        }

        // A question about tasks alone is still the task list, and one about events alone is still the events list.
        $this->assertSame('tasks_workload', $this->service()->classifyIntent('Which tasks are overdue?', null, 'ADMIN'));
        $this->assertSame('events_attendance', $this->service()->classifyIntent('What events are coming up?', null, 'ADMIN'));
    }

    public function test_p1_the_events_facts_list_ongoing_approved_and_planning_events_with_dates_and_status_and_leave_out_finished_ones(): void
    {
        $org = $this->org();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $vp = User::factory()->officer()->create(['organization_id' => $org->id, 'first_name' => 'Angela', 'last_name' => 'Santos']);
        $this->psitsEvents($org, $admin, $vp);
        $this->event($this->org(), $admin, 'Another Club Fair', 'approved', '2026-12-02 08:00:00', '2026-12-02 12:00:00');

        $payload = $this->service()->deterministicAnswer($admin, 'What events are coming up and what tasks do they have?', 'events_attendance');
        $events = $this->rowText($this->section($payload, 'upcoming-events-list')['rows']);

        $this->assertStringContainsString('Leadership Seminar 2024', $events);
        $this->assertStringContainsString('Ongoing', $events);
        $this->assertStringContainsString('Nov 23, 2026', $events);
        $this->assertStringContainsString('Sports Fest 2024', $events);
        $this->assertStringContainsString('Dec 8, 2026', $events);
        $this->assertStringContainsString('Induction and Recognition Ceremony', $events);
        $this->assertStringContainsString('Dec 24, 2026', $events);
        $this->assertStringContainsString('Planning', $events);
        $this->assertStringNotContainsString('General Assembly', $events);
        $this->assertStringNotContainsString('Cancelled Mixer', $events);
        $this->assertStringNotContainsString('Another Club Fair', $events);
        $this->assertStringContainsString('3 events are upcoming or ongoing', $payload['answer']);
    }

    public function test_p1_each_event_task_reaches_the_facts_with_its_event_assignee_due_date_and_status(): void
    {
        $org = $this->org();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $vp = User::factory()->officer()->create(['organization_id' => $org->id, 'first_name' => 'Angela', 'last_name' => 'Santos']);
        $this->psitsEvents($org, $admin, $vp);
        // A task of a finished event and a task with no event are not tasks of an upcoming event.
        $done = Event::where('title', 'General Assembly')->first();
        Task::factory()->create(['organization_id' => $org->id, 'event_id' => $done->id, 'title' => 'Book catering for General Assembly', 'assigned_to' => $vp->school_id, 'created_by' => $admin->school_id, 'status' => 'completed', 'deadline' => '2026-09-01 12:00:00']);
        Task::factory()->create(['organization_id' => $org->id, 'event_id' => null, 'title' => 'Update official member roster', 'assigned_to' => $vp->school_id, 'created_by' => $admin->school_id, 'status' => 'overdue', 'deadline' => '2026-11-19 16:47:31']);

        $payload = $this->service()->deterministicAnswer($admin, 'What events are coming up and what tasks do they have?', 'events_attendance');
        $tasks = $this->rowText($this->section($payload, 'upcoming-event-tasks')['rows']);

        $this->assertStringContainsString('Source merchandise suppliers for Sports Fest', $tasks);
        $this->assertStringContainsString('Sports Fest 2024', $tasks);
        $this->assertStringContainsString('Angela Santos', $tasks);
        $this->assertStringContainsString('Dec 15, 2026', $tasks);
        $this->assertStringContainsString('Pending', $tasks);
        $this->assertStringContainsString('Print seminar certificates', $tasks);
        $this->assertStringContainsString('In Progress', $tasks);
        $this->assertStringNotContainsString('Book catering', $tasks);
        $this->assertStringNotContainsString('member roster', $tasks);

        // An upcoming event with no task says so, so the writer does not have to guess.
        $this->assertStringContainsString('Induction and Recognition Ceremony', $this->rowText($this->section($payload, 'upcoming-events-list')['rows']));
        $this->assertStringContainsString('No tasks yet', $this->rowText($this->section($payload, 'upcoming-events-list')['rows']));
    }

    public function test_p1_an_officer_sees_only_their_own_tasks_of_the_upcoming_events(): void
    {
        $org = $this->org();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $vp = User::factory()->officer()->create(['organization_id' => $org->id, 'first_name' => 'Angela', 'last_name' => 'Santos']);
        $other = User::factory()->officer()->create(['organization_id' => $org->id, 'first_name' => 'Bruno', 'last_name' => 'Reyes']);
        [, $sports] = $this->psitsEvents($org, $admin, $vp);
        Task::factory()->create(['organization_id' => $org->id, 'event_id' => $sports->id, 'title' => 'Bruno private task', 'assigned_to' => $other->school_id, 'created_by' => $admin->school_id, 'status' => 'pending', 'deadline' => '2026-12-05 12:00:00']);

        $payload = $this->service()->deterministicAnswer($vp, 'What events are coming up and what tasks do they have?', 'events_attendance');
        $tasks = $this->rowText($this->section($payload, 'upcoming-event-tasks')['rows']);

        $this->assertStringContainsString('Source merchandise suppliers for Sports Fest', $tasks);
        $this->assertStringNotContainsString('Bruno private task', $tasks);
        $this->assertStringNotContainsString('Print seminar certificates', $tasks);
    }

    public function test_p1_a_student_still_sees_only_approved_and_ongoing_events_and_no_task_rows(): void
    {
        $org = $this->org();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $vp = User::factory()->officer()->create(['organization_id' => $org->id]);
        $student = User::factory()->student()->create(['organization_id' => $org->id]);
        $this->psitsEvents($org, $admin, $vp);

        $payload = $this->service()->deterministicAnswer($student, 'What events are coming up?', 'events_attendance');
        $events = $this->rowText($this->section($payload, 'upcoming-events-list')['rows']);

        $this->assertStringContainsString('Sports Fest 2024', $events);
        $this->assertStringContainsString('Leadership Seminar 2024', $events);
        $this->assertStringNotContainsString('Induction and Recognition Ceremony', $events);
        $this->assertSame([], $this->section($payload, 'upcoming-event-tasks')['rows']);
        $this->assertStringNotContainsString('Source merchandise suppliers', json_encode($payload));
    }

    public function test_p1_the_chat_hands_the_writer_the_events_and_their_tasks(): void
    {
        $org = $this->org();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $vp = User::factory()->officer()->create(['organization_id' => $org->id, 'first_name' => 'Angela', 'last_name' => 'Santos']);
        $this->psitsEvents($org, $admin, $vp);
        Sanctum::actingAs($admin);
        $fake = $this->fake(['Three events are on: Leadership Seminar 2024 is ongoing, Sports Fest 2024 is on Dec 8, 2026 and the Induction and Recognition Ceremony is on Dec 24, 2026.']);

        $response = $this->postJson('/api/ai/assistant/chat', ['message' => 'What events are coming up and what tasks do they have?'])->assertOk();

        $response->assertJsonPath('message.payload.intent', 'events_attendance');
        $response->assertJsonPath('message.payload.engine', 'claude');
        $facts = json_encode($this->factsOf($fake));
        $this->assertStringContainsString('Leadership Seminar 2024', $facts);
        $this->assertStringContainsString('Dec 8, 2026', $facts);
        $this->assertStringContainsString('Dec 24, 2026', $facts);
        $this->assertStringContainsString('Source merchandise suppliers for Sports Fest', $facts);
        $this->assertStringContainsString('Angela Santos', $facts);
    }

    // -------------------------------------------------------------------------
    // P2: What budgets are waiting for me to approve and how much?
    // -------------------------------------------------------------------------

    private function waitingBudget(Organization $org, User $requester, string $title, float $amount, ?Event $event, string $status = 'pending_department_head'): Budget
    {
        $budget = Budget::create([
            'organization_id' => $org->id,
            'event_id' => $event?->id,
            'title' => $title,
            'allocated_amount' => $amount,
            'remaining_amount' => $amount,
            'warning_threshold' => 1000,
            'submission_status' => $status,
        ]);
        ApprovalRequest::create([
            'organization_id' => $org->id,
            'entity_type' => 'budget',
            'entity_id' => $budget->id,
            'required_role' => 'DEPARTMENT_HEAD',
            'requested_by' => $requester->school_id,
            'status' => 'pending',
            'requested_at' => now()->subDays(2),
        ]);

        return $budget;
    }

    /** @return array{0: User, 1: Organization, 2: Organization, 3: User} */
    private function deanSetup(): array
    {
        $college = $this->makeCollege('CCS');
        $head = $this->makeCollegeHead($college);
        $psits = $this->makeCollegeStudentOrganization($college, ['acronym' => 'PSITS-CCS', 'name' => 'PSITS', 'lifecycle_status' => 'active', 'is_active' => true]);
        $second = $this->makeCollegeStudentOrganization($college, ['acronym' => 'ACM-CCS', 'name' => 'ACM Chapter', 'lifecycle_status' => 'active', 'is_active' => true]);
        $requester = User::factory()->admin()->create(['organization_id' => $psits->id, 'first_name' => 'Marco', 'last_name' => 'Dela Cruz']);

        return [$head, $psits, $second, $requester];
    }

    public function test_p2_the_heads_facts_list_each_pending_budget_with_organization_title_event_amount_and_stage(): void
    {
        [$head, $psits, $second, $requester] = $this->deanSetup();
        $sportsFest = $this->event($psits, $requester, 'Sports Fest 2024', 'approved', '2026-12-08 07:00:00', '2026-12-08 18:00:00');
        $this->waitingBudget($psits, $requester, 'Sports Fest 2024 Budget', 25000, $sportsFest);
        $this->waitingBudget($second, $requester, 'test 2', 3000, null);

        $payload = $this->service()->deterministicAnswer($head, 'What budgets are waiting for me to approve and how much?', 'pending_approvals');
        $rows = $this->rowText($this->section($payload, 'pending-budgets-list')['rows']);

        $this->assertStringContainsString('Sports Fest 2024 Budget', $rows);
        $this->assertStringContainsString('PSITS-CCS', $rows);
        $this->assertStringContainsString('Sports Fest 2024', $rows);
        $this->assertStringContainsString('₱25,000.00', $rows);
        $this->assertStringContainsString('Waiting for the Department Head', $rows);
        $this->assertStringContainsString('test 2', $rows);
        $this->assertStringContainsString('ACM-CCS', $rows);
        $this->assertStringContainsString('₱3,000.00', $rows);

        $labels = array_column($payload['highlights'], 'value', 'label');
        $this->assertSame('2', $labels['Budgets waiting']);
        $this->assertSame('₱28,000.00', $labels['Budget amount waiting']);
        $this->assertStringContainsString('₱28,000.00', $payload['answer']);
    }

    public function test_p2_a_budget_of_another_college_or_one_already_decided_is_not_listed(): void
    {
        [$head, $psits, , $requester] = $this->deanSetup();
        $this->waitingBudget($psits, $requester, 'Mine To Decide', 7000, null);
        $decided = $this->waitingBudget($psits, $requester, 'Already Approved Budget', 9000, null, 'approved');
        ApprovalRequest::where('entity_id', $decided->id)->update(['status' => 'approved']);

        $otherCollege = $this->makeCollege('ENG');
        $engOrg = $this->makeCollegeStudentOrganization($otherCollege, ['acronym' => 'ENG-ORG', 'lifecycle_status' => 'active', 'is_active' => true]);
        $engAdmin = User::factory()->admin()->create(['organization_id' => $engOrg->id]);
        $this->waitingBudget($engOrg, $engAdmin, 'Not My College Budget', 12345, null);

        $payload = $this->service()->deterministicAnswer($head, 'What budgets are waiting for me to approve and how much?', 'pending_approvals');
        $rows = $this->rowText($this->section($payload, 'pending-budgets-list')['rows']);

        $this->assertStringContainsString('Mine To Decide', $rows);
        $this->assertStringNotContainsString('Already Approved Budget', $rows);
        $this->assertStringNotContainsString('Not My College Budget', json_encode($payload));
        $this->assertSame('1', array_column($payload['highlights'], 'value', 'label')['Budgets waiting']);
    }

    public function test_p2_the_chat_hands_the_head_the_amounts_instead_of_leaving_the_writer_to_say_they_are_not_visible(): void
    {
        [$head, $psits, $second, $requester] = $this->deanSetup();
        $this->waitingBudget($psits, $requester, 'Sports Fest 2024 Budget', 25000, null);
        $this->waitingBudget($second, $requester, 'test 2', 3000, null);
        Sanctum::actingAs($head);
        $fake = $this->fake(['Two budgets wait for you: Sports Fest 2024 Budget at PHP 25,000.00 and test 2 at PHP 3,000.00, PHP 28,000.00 in all.']);

        $response = $this->postJson('/api/ai/assistant/chat', ['message' => 'What budgets are waiting for me to approve and how much?'])->assertOk();

        $response->assertJsonPath('message.payload.intent', 'pending_approvals');
        $response->assertJsonPath('message.payload.engine', 'claude');
        $facts = json_encode($this->factsOf($fake), JSON_UNESCAPED_UNICODE);
        $this->assertStringContainsString('₱25,000.00', $facts);
        $this->assertStringContainsString('₱3,000.00', $facts);
        $this->assertStringContainsString('PSITS-CCS', $facts);
    }

    // -------------------------------------------------------------------------
    // P3: What should I do before submitting the financial report?
    // -------------------------------------------------------------------------

    private function reportOrg(): array
    {
        $org = $this->org();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $approved = Budget::create(['organization_id' => $org->id, 'title' => 'General Operations Fund', 'allocated_amount' => 50000, 'remaining_amount' => 36500, 'warning_threshold' => 5000, 'submission_status' => 'approved']);
        $pending = Budget::create(['organization_id' => $org->id, 'title' => 'Sports Fest 2024 Budget', 'allocated_amount' => 25000, 'remaining_amount' => 25000, 'warning_threshold' => 5000, 'submission_status' => 'pending_department_head']);
        FinancialReportDeadline::create(['deadline_at' => '2026-12-08 17:00:00', 'set_by' => $admin->school_id]);

        // Two expenses with no receipt reference, one with a receipt, and one large entry linked to nothing.
        foreach ([['Supplies', 1500], ['Venue', 2000]] as [$category, $amount]) {
            Transaction::factory()->create(['organization_id' => $org->id, 'budget_id' => $approved->id, 'type' => 'expense', 'category' => $category, 'amount' => $amount, 'receipt_reference' => null, 'transaction_date' => '2026-11-10']);
        }
        Transaction::factory()->create(['organization_id' => $org->id, 'budget_id' => $approved->id, 'type' => 'expense', 'category' => 'Printing', 'amount' => 800, 'receipt_reference' => 'OR-1001', 'transaction_date' => '2026-11-11']);
        Transaction::factory()->create(['organization_id' => $org->id, 'budget_id' => null, 'event_id' => null, 'type' => 'income', 'category' => 'Sponsorship', 'amount' => 6000, 'receipt_reference' => null, 'transaction_date' => '2026-11-12']);

        return [$org, $admin, $approved, $pending];
    }

    public function test_p3_what_to_do_before_submitting_the_report_is_its_own_intent_and_the_tool_description_keeps_its_own_questions(): void
    {
        foreach ([
            'What should I do before submitting the financial report?',
            'What do I need to do before we send the financial report?',
            'What should we prepare before submitting our financial report?',
        ] as $question) {
            $this->assertSame('report_preparation', $this->service()->classifyIntent($question, null, 'ADMIN'), $question);
        }

        // What the checks are stays the tool description, and a Department Head, who reviews reports, is not told to prepare one.
        $this->assertSame('ai_tools', $this->service()->classifyIntent('Check our report before we send it', null, 'ADMIN'));
        $this->assertSame('ai_tools', $this->service()->classifyIntent('What should I do before submitting the financial report?', null, 'DEPARTMENT_HEAD'));
    }

    public function test_p3_the_report_preparation_facts_carry_the_deadline_the_checks_the_pending_budgets_and_the_unlinked_entries(): void
    {
        [, $admin] = $this->reportOrg();

        $payload = $this->service()->deterministicAnswer($admin, 'What should I do before submitting the financial report?', 'report_preparation');
        $text = json_encode($payload, JSON_UNESCAPED_UNICODE);
        $labels = array_column($payload['highlights'], 'value', 'label');

        $this->assertSame('Dec 8, 2026', $labels['Report deadline']);
        $this->assertSame('1', $labels['Budgets waiting']);
        $this->assertSame('2', $labels['Expenses without a receipt']);
        $this->assertSame('1', $labels['Entries not linked']);
        $this->assertStringContainsString('Sports Fest 2024 Budget', $text);
        $this->assertStringContainsString('₱25,000.00', $text);
        $this->assertStringContainsString('Dec 8, 2026', $payload['answer']);
        $this->assertStringContainsString('no receipt reference', $text);
        $this->assertStringContainsString('not linked to a budget or an event', $text);
        $this->assertNotSame('', $this->rowText($this->section($payload, 'report-prep-steps')['rows']));
        $this->assertStringNotContainsString('AI tool', $payload['title']);
    }

    public function test_p3_a_report_with_nothing_to_fix_says_so_instead_of_inventing_work(): void
    {
        $org = $this->org();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        FinancialReportDeadline::create(['deadline_at' => '2026-12-08 17:00:00', 'set_by' => $admin->school_id]);

        $payload = $this->service()->deterministicAnswer($admin, 'What should I do before submitting the financial report?', 'report_preparation');

        $this->assertStringContainsString('found nothing to fix', $payload['answer']);
        $labels = array_column($payload['highlights'], 'value', 'label');
        $this->assertSame('0', $labels['Budgets waiting']);
    }

    public function test_p3_the_chat_keeps_a_correct_report_preparation_answer_and_does_not_fall_back_to_the_summary(): void
    {
        [, $admin] = $this->reportOrg();
        Sanctum::actingAs($admin);
        $text = "Before you send the report, three things need your attention.\n\nThe deadline is Dec 8, 2026. Sports Fest 2024 Budget (PHP 25,000.00) is still waiting for the Department Head, so it does not count as available. 2 expenses have no receipt reference and 1 entry is not linked to a budget or an event.";
        $this->fake([$text]);

        $response = $this->postJson('/api/ai/assistant/chat', ['message' => 'What should I do before submitting the financial report?'])->assertOk();

        $response->assertJsonPath('message.payload.intent', 'report_preparation');
        $response->assertJsonPath('message.payload.engine', 'claude');
        $response->assertJsonPath('message.payload.notice', null);
        $this->assertSame($text, $response->json('message.content'));
    }

    // -------------------------------------------------------------------------
    // P4: remaining = allocated + income - spent is not a defect
    // -------------------------------------------------------------------------

    private function fundWithIncome(Organization $org, float $storedRemaining = 80000.0): Budget
    {
        $budget = Budget::create(['organization_id' => $org->id, 'title' => 'General Operations Fund', 'allocated_amount' => 50000, 'remaining_amount' => $storedRemaining, 'warning_threshold' => 10000, 'submission_status' => 'approved']);
        Transaction::factory()->create(['organization_id' => $org->id, 'budget_id' => $budget->id, 'type' => 'income', 'category' => 'Collections', 'amount' => 43500, 'transaction_date' => '2026-11-05']);
        Transaction::factory()->create(['organization_id' => $org->id, 'budget_id' => $budget->id, 'type' => 'expense', 'category' => 'Supplies', 'amount' => 13500, 'transaction_date' => '2026-11-06']);

        return $budget;
    }

    private function budgetChunk(User $asker): string
    {
        $payload = $this->service()->deterministicAnswer($asker, 'Which organizations need my approval? General Operations Fund budget', 'pending_approvals');

        return implode("\n", array_map(fn (array $chunk) => $chunk['primary'].' | '.$chunk['secondary'], array_filter($payload['rag_chunks'], fn (array $chunk) => str_contains($chunk['primary'], 'General Operations Fund'))));
    }

    public function test_p4_the_budget_record_the_writer_reads_shows_income_and_the_working_so_a_remaining_above_the_allocation_adds_up(): void
    {
        [$head, $psits] = $this->deanSetup();
        $this->fundWithIncome($psits);

        $chunk = $this->budgetChunk($head);

        $this->assertStringContainsString('Allocated: ₱50,000.00', $chunk);
        $this->assertStringContainsString('Income posted: ₱43,500.00', $chunk);
        $this->assertStringContainsString('Spent: ₱13,500.00', $chunk);
        $this->assertStringContainsString('Remaining: ₱80,000.00', $chunk);
        $this->assertStringContainsString('₱50,000.00 allocated + ₱43,500.00 income posted - ₱13,500.00 spent = ₱80,000.00 left', $chunk);
        $this->assertStringNotContainsString('do not add up', $chunk);
    }

    public function test_p4_a_real_mismatch_is_still_flagged_on_the_budget_record(): void
    {
        [$head, $psits] = $this->deanSetup();
        $this->fundWithIncome($psits, 70000.0);

        $chunk = $this->budgetChunk($head);

        $this->assertStringContainsString('Remaining: ₱70,000.00', $chunk);
        $this->assertStringContainsString('do not add up', $chunk);
        $this->assertStringNotContainsString('income posted - ₱13,500.00 spent = ₱70,000.00 left', $chunk);
    }

    public function test_p4_the_chat_brief_says_income_raises_the_remaining_amount_and_only_a_real_mismatch_is_a_problem(): void
    {
        $brief = AiInstructions::askAiChat();

        $this->assertStringContainsString('allocated plus income posted minus spent', $brief);
        $this->assertStringContainsString('above the amount allocated', $brief);
        $this->assertStringContainsString('only when', $brief);
    }
}
