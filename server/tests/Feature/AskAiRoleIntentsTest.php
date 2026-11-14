<?php

namespace Tests\Feature;

use App\Models\ApprovalRequest;
use App\Models\College;
use App\Models\Event;
use App\Models\FinancialReport;
use App\Models\Organization;
use App\Models\OrganizationApplication;
use App\Models\User;
use App\Models\Venue;
use App\Models\VenueBooking;
use App\Services\Ai\AskAiRoleIntents;
use App\Services\Dashboard\ClientRouteAccess;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

class AskAiRoleIntentsTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private AskAiRoleIntents $intents;

    protected function setUp(): void
    {
        parent::setUp();
        $this->intents = $this->app->make(AskAiRoleIntents::class);
    }

    private function sao(): User
    {
        $home = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);

        return User::factory()->superAdmin()->create(['organization_id' => $home->id]);
    }

    private function application(College $college, string $name, string $status, array $overrides = []): OrganizationApplication
    {
        static $schoolId = 700000;
        $schoolId++;

        return OrganizationApplication::create([
            'college_id' => $college->id,
            'name' => $name,
            'acronym' => strtoupper(substr($name, 0, 3)),
            'school_id' => $schoolId,
            'first_name' => 'Ana',
            'last_name' => 'Reyes',
            'email' => "applicant{$schoolId}@example.test",
            'position_title' => 'President',
            'status' => $status,
            'round' => 1,
            'submitted_at' => now()->subDays(2),
            ...$overrides,
        ]);
    }

    private function approval(Organization $org, User $requester, string $type, int $entityId, string $status, string $requiredRole, array $overrides = []): ApprovalRequest
    {
        return ApprovalRequest::create([
            'organization_id' => $org->id,
            'entity_type' => $type,
            'entity_id' => $entityId,
            'requested_by' => $requester->school_id,
            'required_role' => $requiredRole,
            'status' => $status,
            'requested_at' => now()->subDays(3),
            ...$overrides,
        ]);
    }

    private function rows(array $payload): array
    {
        return collect($payload['sections'])->flatMap(fn (array $section) => $section['rows'])->all();
    }

    private function assertShape(array $payload): void
    {
        foreach (['title', 'answer', 'highlights', 'sections', 'follow_ups'] as $key) {
            $this->assertArrayHasKey($key, $payload);
        }
        foreach ($this->rows($payload) as $row) {
            foreach (['id', 'primary', 'secondary', 'status', 'status_tone', 'meta', 'href', 'action_label'] as $key) {
                $this->assertArrayHasKey($key, $row);
            }
        }
    }

    private function assertLinksOpenForRole(array $payload, string $role): void
    {
        $access = $this->app->make(ClientRouteAccess::class);
        foreach ($this->rows($payload) as $row) {
            if ($row['href'] !== null) {
                $this->assertSame($row['href'], $access->hrefFor($role, $row['href']), "{$row['href']} is not open to {$role}");
            }
        }
    }

    public function test_match_routes_the_example_questions_for_the_roles_that_may_use_them(): void
    {
        $cases = [
            ['Which applications are waiting for me?', 'SUPER_ADMIN', 'applications_queue'],
            ['Which applications need my endorsement?', 'DEPARTMENT_HEAD', 'applications_queue'],
            ['Which organization applications are waiting for my approval?', 'SUPER_ADMIN', 'applications_queue'],
            ['Where is my event proposal?', 'ADMIN', 'my_submissions'],
            ['What happened to our budget request?', 'ADMIN', 'my_submissions'],
            ['Is our report approved?', 'ADMIN', 'my_submissions'],
            ['forecast our finances', 'ADMIN', 'ai_tools'],
            ['Who should I assign this task to?', 'ADMIN', 'ai_tools'],
            ['plan our event', 'SBO_OFFICER', 'ai_tools'],
            ['Help me write an announcement', 'SBO_OFFICER', 'ai_tools'],
            ['Summarize our financial report', 'DEPARTMENT_HEAD', 'ai_tools'],
            ['Where do my membership fees go?', 'STUDENT', 'fee_usage'],
            ["How is our org's money spent?", 'STUDENT', 'fee_usage'],
            ['Where does the money go?', 'STUDENT', 'fee_usage'],
        ];

        foreach ($cases as [$question, $role, $intent]) {
            $this->assertSame($intent, $this->intents->match($question, $role), "{$role}: {$question}");
        }
    }

    public function test_match_returns_null_for_near_misses_and_for_roles_that_may_not_use_the_intent(): void
    {
        $nulls = [
            ['What fees do I still need to pay?', 'STUDENT'],
            ['How do I endorse an application?', 'DEPARTMENT_HEAD'],
            ['How do I create an event?', 'ADMIN'],
            ["What haven't we submitted yet?", 'ADMIN'],
            ['Where is my order?', 'ADMIN'],
            ['Who has overdue tasks?', 'ADMIN'],
            ['What should I do today?', 'SUPER_ADMIN'],
            ['How much budget is left?', 'ADMIN'],
            ['Which tasks are assigned to me?', 'SBO_OFFICER'],
            ['Which applications are waiting for me?', 'ADMIN'],
            ['Which applications are waiting for me?', 'STUDENT'],
            ['Which applications need my endorsement?', 'SBO_OFFICER'],
            ['Where is my event proposal?', 'STUDENT'],
            ['Where is my event proposal?', 'DEPARTMENT_HEAD'],
            ['forecast our finances', 'STUDENT'],
            ['Help me write an announcement', 'SUPER_ADMIN'],
            ['Where do my membership fees go?', 'ADMIN'],
            ['Where do my membership fees go?', 'SUPER_ADMIN'],
            ['How is our org\'s money spent?', 'SBO_OFFICER'],
        ];

        foreach ($nulls as [$question, $role]) {
            $this->assertNull($this->intents->match($question, $role), "{$role}: {$question}");
        }
    }

    public function test_allowed_follows_the_role_for_every_intent(): void
    {
        $expected = [
            'applications_queue' => ['SUPER_ADMIN', 'DEPARTMENT_HEAD'],
            'my_submissions' => ['ADMIN'],
            'ai_tools' => ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD'],
            'fee_usage' => ['STUDENT'],
        ];
        $this->assertSame(array_keys($expected), AskAiRoleIntents::INTENTS);

        foreach (['SUPER_ADMIN', 'DEPARTMENT_HEAD', 'ADMIN', 'SBO_OFFICER', 'STUDENT'] as $role) {
            $user = new User(['role' => $role]);
            foreach ($expected as $intent => $roles) {
                $this->assertSame(in_array($role, $roles, true), $this->intents->allowed($user, $intent), "{$role} {$intent}");
            }
        }
    }

    public function test_sao_sees_only_endorsed_applications_oldest_first_with_real_counts(): void
    {
        $college = $this->makeCollege('ENG');
        $other = $this->makeCollege('ART');
        $this->application($college, 'Newer Endorsed', 'pending_sao', ['endorsed_at' => now()->subDay()]);
        $this->application($other, 'Older Endorsed', 'pending_sao', ['endorsed_at' => now()->subDays(5)]);
        $this->application($college, 'With The Dean', 'pending_dean');
        $this->application($college, 'Already Approved', 'approved');
        $this->application($college, 'Retired Form', 'pending_verification');

        $payload = $this->intents->build($this->sao(), 'applications_queue', 'Which applications are waiting for me?');
        $this->assertShape($payload);
        $rows = $this->rows($payload);

        $this->assertCount(2, $rows);
        $this->assertStringStartsWith('Older Endorsed', $rows[0]['primary']);
        $this->assertStringStartsWith('Newer Endorsed', $rows[1]['primary']);
        $this->assertSame('2', $payload['highlights'][0]['value']);
        $this->assertSame('1', $payload['highlights'][1]['value']);
        $this->assertStringContainsString('2 applications are waiting for your final decision', $payload['answer']);
        $this->assertStringContainsString('The oldest is Older Endorsed', $payload['answer']);
        $this->assertStringContainsString('the decision is yours', $payload['answer']);
        $this->assertStringStartsWith('/dashboard/organization-applications?record=', $rows[0]['href']);
        $this->assertLinksOpenForRole($payload, 'SUPER_ADMIN');
    }

    public function test_sao_with_nothing_waiting_says_where_the_rest_are(): void
    {
        $college = $this->makeCollege('ENG');
        $this->application($college, 'With The Dean', 'pending_dean');

        $payload = $this->intents->build($this->sao(), 'applications_queue', 'Which applications are waiting for me?');

        $this->assertSame([], $this->rows($payload));
        $this->assertStringStartsWith('No applications are waiting for your decision', $payload['answer']);
        $this->assertStringContainsString('1 application is still with the Department Heads', $payload['answer']);
    }

    public function test_department_head_sees_only_verified_applications_of_their_own_college(): void
    {
        $college = $this->makeCollege('ENG');
        $other = $this->makeCollege('ART');
        $head = $this->makeCollegeHead($college);
        $this->makeCollegeHome($other);
        $this->application($college, 'Own Newer', 'pending_dean', ['submitted_at' => now()->subDay()]);
        $this->application($college, 'Own Older', 'pending_dean', ['submitted_at' => now()->subDays(6)]);
        $this->application($college, 'Own Endorsed', 'pending_sao', ['endorsed_at' => now()]);
        $this->application($college, 'Own Returned', 'returned');
        $this->application($other, 'Foreign Waiting', 'pending_dean');

        $payload = $this->intents->build($head, 'applications_queue', 'Which applications need my endorsement?');
        $this->assertShape($payload);
        $rows = $this->rows($payload);

        $this->assertSame(['Own Older (OWN)', 'Own Newer (OWN)'], array_column($rows, 'primary'));
        $this->assertSame('2', $payload['highlights'][0]['value']);
        $this->assertSame('1', $payload['highlights'][1]['value']);
        $this->assertStringContainsString('2 applications from your college are waiting for your endorsement', $payload['answer']);
        $this->assertStringContainsString('the SAO makes the final decision', $payload['answer']);
        $this->assertStringNotContainsString('Foreign Waiting', json_encode($payload));
        $this->assertStringStartsWith('/dashboard/organization-applications?record=', $rows[0]['href']);
        $this->assertLinksOpenForRole($payload, 'DEPARTMENT_HEAD');
    }

    public function test_department_head_without_a_college_sees_nothing_and_is_told_why(): void
    {
        $college = $this->makeCollege('ENG');
        $this->application($college, 'Somebody Elses', 'pending_dean');
        $org = Organization::factory()->create(['organization_type' => 'STUDENT_ORGANIZATION']);
        $head = User::factory()->departmentHead()->create(['organization_id' => $org->id]);

        $payload = $this->intents->build($head, 'applications_queue', 'Which applications need my endorsement?');

        $this->assertSame([], $this->rows($payload));
        $this->assertStringContainsString('not linked to a college', $payload['answer']);
    }

    public function test_admin_sees_their_own_submissions_with_returned_first_and_who_acts_next(): void
    {
        $college = $this->makeCollege('ENG');
        $org = $this->makeCollegeStudentOrganization($college, ['lifecycle_status' => 'active', 'is_active' => true]);
        $stranger = $this->makeCollegeStudentOrganization($college, ['lifecycle_status' => 'active', 'is_active' => true]);
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $strangerAdmin = User::factory()->admin()->create(['organization_id' => $stranger->id]);

        $event = Event::factory()->create(['organization_id' => $org->id, 'title' => 'Foundation Day', 'status' => 'planning', 'created_by' => $admin->school_id]);
        $this->approval($org, $admin, 'event', $event->id, 'pending', 'DEPARTMENT_HEAD', ['requested_at' => now()->subDays(4)]);
        $this->approval($org, $admin, 'budget', 9001, 'rejected', 'DEPARTMENT_HEAD', ['remarks' => 'Attach the quotation', 'reviewed_at' => now()->subDay(), 'decision' => 'rejected']);
        $this->approval($org, $admin, 'financial_report', 9002, 'pending', 'SUPER_ADMIN');
        $this->approval($org, $admin, 'announcement', 9003, 'approved', 'DEPARTMENT_HEAD', ['reviewed_at' => now()->subDays(2), 'decision' => 'approved']);
        $this->approval($org, $admin, 'election', 9004, 'approved', 'DEPARTMENT_HEAD', ['requested_at' => now()->subDays(9), 'reviewed_at' => now()->subDays(8)]);
        $this->approval($org, $admin, 'election', 9004, 'pending', 'SUPER_ADMIN', ['requested_at' => now()->subDays(1)]);
        $this->approval($stranger, $strangerAdmin, 'event', 9100, 'rejected', 'SUPER_ADMIN', ['remarks' => 'Not yours']);

        $venue = Venue::create(['name' => 'Gym', 'location' => 'Main', 'capacity' => 100, 'is_active' => true]);
        VenueBooking::create(['venue_id' => $venue->id, 'organization_id' => $org->id, 'start_time' => now()->addWeek(), 'end_time' => now()->addWeek()->addHours(2), 'status' => 'pending', 'requested_by' => $admin->school_id]);
        VenueBooking::create(['venue_id' => $venue->id, 'organization_id' => $stranger->id, 'start_time' => now()->addWeek(), 'end_time' => now()->addWeek()->addHours(2), 'status' => 'rejected', 'requested_by' => $strangerAdmin->school_id]);

        $payload = $this->intents->build($admin, 'my_submissions', 'Where are our submissions?');
        $this->assertShape($payload);
        $rows = $this->rows($payload);

        $budgetOnly = $this->rows($this->intents->build($admin, 'my_submissions', 'What happened to our budget request?'));
        $this->assertCount(1, $budgetOnly);
        $this->assertSame('Returned to you', $budgetOnly[0]['status']);

        $this->assertCount(6, $rows);
        $this->assertSame('Returned to you', $rows[0]['status']);
        $this->assertSame('danger', $rows[0]['status_tone']);
        $this->assertStringContainsString('Returned to you: Attach the quotation', $rows[0]['secondary']);
        $this->assertStringContainsString('Budget request', $rows[0]['secondary']);
        $this->assertStringContainsString('Submitted', $rows[0]['secondary']);

        $statuses = array_column($rows, 'status');
        $this->assertSame(['Returned to you'], array_slice($statuses, 0, 1));
        $this->assertContains('Waiting for the Department Head', $statuses);
        $this->assertContains('Waiting for SAO', $statuses);
        $this->assertContains('Approved', $statuses);
        $this->assertSame(1, count(array_filter($rows, fn ($row) => str_contains($row['primary'], 'Foundation Day'))));
        $this->assertSame(1, count(array_filter($rows, fn ($row) => $row['id'] === 'approval-'.ApprovalRequest::where('entity_id', 9004)->where('status', 'pending')->value('id'))));
        $this->assertSame(0, count(array_filter($rows, fn ($row) => str_contains($row['secondary'], 'Not yours'))));

        $this->assertSame('1', $payload['highlights'][0]['value']);
        $this->assertSame('4', $payload['highlights'][1]['value']);
        $this->assertSame('1', $payload['highlights'][2]['value']);

        $this->assertStringContainsString('has come back to you for changes', $payload['answer']);
        $this->assertStringContainsString('returned by the Department Head: "Attach the quotation"', $payload['answer']);
        $this->assertStringContainsString('the next move is yours', $payload['answer']);
        $this->assertStringContainsString('4 more are with reviewers', $payload['answer']);
        $this->assertLinksOpenForRole($payload, 'ADMIN');
        $this->assertSame('/dashboard/finance/budget-allocation', $rows[0]['href']);
    }

    public function test_admin_submissions_say_who_reviews_next_when_nothing_is_returned(): void
    {
        $college = $this->makeCollege('ENG');
        $org = $this->makeCollegeStudentOrganization($college, ['lifecycle_status' => 'active', 'is_active' => true]);
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $this->approval($org, $admin, 'event', 9201, 'pending', 'DEPARTMENT_HEAD', ['requested_at' => now()->subDays(5)]);
        $this->approval($org, $admin, 'budget', 9202, 'pending', 'SUPER_ADMIN');

        $payload = $this->intents->build($admin, 'my_submissions', 'Where is my event proposal?');

        $this->assertCount(1, $this->rows($payload));
        $this->assertSame('Waiting for the Department Head', $this->rows($payload)[0]['status']);
        $this->assertStringStartsWith('Nothing has been returned to you. 1 event proposal is with reviewers (1 waiting for the Department Head)', $payload['answer']);
        $this->assertStringContainsString('the reviewer decides next', $payload['answer']);

        $all = $this->intents->build($admin, 'my_submissions', 'Where are our submissions?');
        $this->assertCount(2, $this->rows($all));
        $this->assertStringContainsString('2 submissions are with reviewers (1 waiting for the Department Head and 1 waiting for SAO)', $all['answer']);
    }

    public function test_admin_with_no_submissions_is_told_so_and_a_venue_question_reads_only_bookings(): void
    {
        $college = $this->makeCollege('ENG');
        $org = $this->makeCollegeStudentOrganization($college, ['lifecycle_status' => 'active', 'is_active' => true]);
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);

        $empty = $this->intents->build($admin, 'my_submissions', 'Is our report approved?');
        $this->assertSame([], $this->rows($empty));
        $this->assertStringContainsString('has not sent any financial reports for approval yet', $empty['answer']);

        $this->approval($org, $admin, 'event', 9301, 'pending', 'DEPARTMENT_HEAD');
        $venue = Venue::create(['name' => 'Auditorium', 'location' => 'Main', 'capacity' => 300, 'is_active' => true]);
        VenueBooking::create(['venue_id' => $venue->id, 'organization_id' => $org->id, 'start_time' => now()->addDays(10), 'end_time' => now()->addDays(10)->addHours(3), 'status' => 'rejected', 'remarks' => 'Date is taken', 'requested_by' => $admin->school_id, 'reviewed_at' => now()]);

        $venues = $this->intents->build($admin, 'my_submissions', 'What happened to our venue booking?');
        $rows = $this->rows($venues);
        $this->assertCount(1, $rows);
        $this->assertStringStartsWith('Auditorium on', $rows[0]['primary']);
        $this->assertStringContainsString('Returned to you: Date is taken', $rows[0]['secondary']);
        $this->assertSame('/dashboard/venues', $rows[0]['href']);
    }

    public function test_ai_tools_link_only_to_tools_the_role_may_open(): void
    {
        $org = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $officer = User::factory()->officer()->create(['organization_id' => $org->id]);
        $college = $this->makeCollege('ENG');
        $head = $this->makeCollegeHead($college);

        $forecast = $this->intents->build($admin, 'ai_tools', 'forecast our finances');
        $this->assertShape($forecast);
        $this->assertSame('Financial forecast', $forecast['title']);
        $this->assertSame('/dashboard/finance/financial-insights', $this->rows($forecast)[0]['href']);
        $this->assertStringContainsString('only an estimate that people weigh', $forecast['answer']);
        $this->assertLinksOpenForRole($forecast, 'ADMIN');

        $delegation = $this->intents->build($admin, 'ai_tools', 'who should I assign this task to');
        $this->assertSame('/dashboard/tasks/ai-delegation', $this->rows($delegation)[0]['href']);
        $this->assertStringContainsString('you make the final choice', $delegation['answer']);

        $officerDelegation = $this->intents->build($officer, 'ai_tools', 'who should I assign this task to');
        $this->assertStringContainsString("only for your organization's Admin", $officerDelegation['answer']);
        $this->assertStringContainsString('so you cannot open it', $officerDelegation['answer']);
        $this->assertNotContains('/dashboard/tasks/ai-delegation', array_column($this->rows($officerDelegation), 'href'));
        $this->assertLinksOpenForRole($officerDelegation, 'SBO_OFFICER');

        $officerAnnouncement = $this->intents->build($officer, 'ai_tools', 'help me write an announcement');
        $this->assertSame('/dashboard/announcements/create-announcement', $this->rows($officerAnnouncement)[0]['href']);

        $officerForecast = $this->intents->build($officer, 'ai_tools', 'forecast our finances');
        $this->assertStringContainsString('Your Admin makes the forecast', $officerForecast['answer']);
        $this->assertSame('/dashboard/finance/financial-insights', $this->rows($officerForecast)[0]['href']);

        $headEvent = $this->intents->build($head, 'ai_tools', 'plan our event');
        $this->assertStringContainsString('is only for', $headEvent['answer']);
        $this->assertNotContains('/dashboard/events/event-planner', array_column($this->rows($headEvent), 'href'));

        $headReport = $this->intents->build($head, 'ai_tools', 'summarize our financial report');
        $this->assertSame('/dashboard/department-head/approvals', $this->rows($headReport)[0]['href']);
        $this->assertStringContainsString('you review it and decide', $headReport['answer']);
        $this->assertLinksOpenForRole($headReport, 'DEPARTMENT_HEAD');

        $this->assertSame('/dashboard/events/event-planner', $this->rows($this->intents->build($admin, 'ai_tools', 'plan our event'))[0]['href']);
        $this->assertSame('/dashboard/finance/budget-allocation', $this->rows($this->intents->build($admin, 'ai_tools', 'how much can we spend safely'))[0]['href']);
    }

    public function test_ai_tools_without_a_named_tool_lists_what_the_role_can_open(): void
    {
        $org = Organization::factory()->create();
        $officer = User::factory()->officer()->create(['organization_id' => $org->id]);

        $payload = $this->intents->build($officer, 'ai_tools', 'what ai tools are there');
        $this->assertShape($payload);

        $this->assertSame(['Financial forecast', 'Announcement drafting'], array_column($this->rows($payload), 'primary'));
        $this->assertStringContainsString('a person decides every time', $payload['answer']);
        $this->assertStringNotContainsString('SBO_OFFICER', json_encode($payload));
        $this->assertLinksOpenForRole($payload, 'SBO_OFFICER');
    }

    public function test_fee_usage_reads_only_the_newest_approved_report_of_the_students_own_organization(): void
    {
        $college = $this->makeCollege('ENG');
        $org = $this->makeCollegeStudentOrganization($college, ['name' => 'Engineering Society', 'lifecycle_status' => 'active', 'is_active' => true]);
        $other = $this->makeCollegeStudentOrganization($college, ['lifecycle_status' => 'active', 'is_active' => true]);
        $student = User::factory()->student()->create(['organization_id' => $org->id]);
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);

        config(['client_routes.STUDENT' => [...config('client_routes.STUDENT'), '/dashboard/finance/where-fees-go']]);

        $make = fn (Organization $organization, string $title, string $status, ?string $approvedAt, array $rows) => FinancialReport::create([
            'organization_id' => $organization->id, 'report_type' => 'monthly', 'title' => $title, 'source_transaction_ids' => [], 'signatories' => [],
            'submission_status' => $status, 'generated_by' => $admin->school_id, 'generated_at' => now(), 'submitted_at' => now(),
            'sao_approved_at' => $approvedAt, 'opening_balance_snapshot' => 0, 'transactions_snapshot' => $rows,
        ]);
        $make($org, 'Older approved', 'approved', now()->subMonths(2)->toDateTimeString(), [['type' => 'income', 'amount' => 100, 'category' => 'Fees']]);
        $make($org, 'Newest approved', 'approved', now()->subDay()->toDateTimeString(), [
            ['type' => 'income', 'amount' => 5000, 'category' => 'Membership fees'],
            ['type' => 'expense', 'amount' => 1500.5, 'category' => 'Printing'],
            ['type' => 'expense', 'amount' => 500, 'category' => 'Snacks'],
        ]);
        $make($org, 'Still pending', 'pending_sao', null, [['type' => 'income', 'amount' => 99999, 'category' => 'Pending']]);
        $make($other, 'Foreign approved', 'approved', now()->toDateTimeString(), [['type' => 'income', 'amount' => 77777, 'category' => 'Foreign']]);

        $payload = $this->intents->build($student, 'fee_usage', 'Where do my membership fees go?');
        $this->assertShape($payload);

        $this->assertSame(['Collected', 'Spent', 'Balance'], array_column($payload['highlights'], 'label'));
        $this->assertSame(['₱5,000.00', '₱2,000.50', '₱2,999.50'], array_column($payload['highlights'], 'value'));
        $rows = $this->rows($payload);
        $this->assertSame(['Printing', 'Snacks'], array_column($rows, 'primary'));
        $this->assertSame('75% of spending', $rows[0]['status']);
        $this->assertSame('/dashboard/finance/where-fees-go', $rows[0]['href']);
        $this->assertStringStartsWith('Engineering Society collected ₱5,000.00 and spent ₱2,000.50, leaving ₱2,999.50', $payload['answer']);
        $this->assertStringContainsString('Printing (₱1,500.50, 75%)', $payload['answer']);
        $this->assertStringNotContainsString('99,999', json_encode($payload));
        $this->assertStringNotContainsString('77,777', json_encode($payload));
        $this->assertLinksOpenForRole($payload, 'STUDENT');
    }

    public function test_fee_usage_without_an_approved_report_says_figures_come_after_sao_approval(): void
    {
        $college = $this->makeCollege('ENG');
        $org = $this->makeCollegeStudentOrganization($college, ['name' => 'Engineering Society', 'lifecycle_status' => 'active', 'is_active' => true]);
        $student = User::factory()->student()->create(['organization_id' => $org->id]);
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        FinancialReport::create([
            'organization_id' => $org->id, 'report_type' => 'monthly', 'title' => 'Waiting', 'source_transaction_ids' => [], 'signatories' => [],
            'submission_status' => 'pending_sao', 'generated_by' => $admin->school_id, 'generated_at' => now(), 'submitted_at' => now(),
            'transactions_snapshot' => [['type' => 'income', 'amount' => 123, 'category' => 'Fees']],
        ]);

        $payload = $this->intents->build($student, 'fee_usage', 'How is our org\'s money spent?');
        $this->assertShape($payload);

        $this->assertSame([], $payload['highlights']);
        $this->assertSame([], $this->rows($payload));
        $this->assertStringContainsString('No financial report of Engineering Society has been approved yet', $payload['answer']);
        $this->assertStringContainsString('Figures appear after the SAO approves the organization\'s financial report', $payload['answer']);
    }

    public function test_the_fee_link_is_left_out_while_the_student_cannot_open_the_page(): void
    {
        config(['client_routes.STUDENT' => array_values(array_diff(config('client_routes.STUDENT'), ['/dashboard/finance/where-fees-go']))]);
        $college = $this->makeCollege('ENG');
        $org = $this->makeCollegeStudentOrganization($college, ['lifecycle_status' => 'active', 'is_active' => true]);
        $student = User::factory()->student()->create(['organization_id' => $org->id]);
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        FinancialReport::create([
            'organization_id' => $org->id, 'report_type' => 'monthly', 'title' => 'Done', 'source_transaction_ids' => [], 'signatories' => [],
            'submission_status' => 'approved', 'generated_by' => $admin->school_id, 'generated_at' => now(), 'submitted_at' => now(),
            'sao_approved_at' => now(), 'opening_balance_snapshot' => 0,
            'transactions_snapshot' => [['type' => 'expense', 'amount' => 10, 'category' => 'Misc']],
        ]);

        $rows = $this->rows($this->intents->build($student, 'fee_usage', 'where do my fees go'));

        $this->assertNotEmpty($rows);
        $this->assertNull($rows[0]['href']);
    }
}
