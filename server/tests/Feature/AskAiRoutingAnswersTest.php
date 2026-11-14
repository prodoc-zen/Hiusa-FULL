<?php

namespace Tests\Feature;

use App\Models\Announcement;
use App\Models\ApprovalRequest;
use App\Models\Budget;
use App\Models\Event;
use App\Models\Grievance;
use App\Models\Invoice;
use App\Models\Organization;
use App\Models\Task;
use App\Models\User;
use App\Models\Venue;
use App\Models\VenueBooking;
use App\Services\Ai\AskAiActions;
use App\Services\Ai\AskAiRoleIntents;
use App\Services\Ai\AskAiService;
use App\Services\Dashboard\ClientRouteAccess;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

/**
 * The answer a person reads, not the intent label: every test asks in plain words, as one role, and checks the title,
 * the sentence, the rows and where each row's button goes. No model key is set, so this is the deterministic answer.
 */
class AskAiRoutingAnswersTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['performance.api_cache.enabled' => false, 'services.groq.key' => '', 'services.anthropic.key' => '', 'approvals.budget_final' => 'SUPER_ADMIN']);
    }

    private function org(array $overrides = []): Organization
    {
        return Organization::factory()->create([
            'organization_type' => 'STUDENT_ORGANIZATION',
            'lifecycle_status' => 'active',
            'is_active' => true,
            ...$overrides,
        ]);
    }

    private function sao(): User
    {
        return User::factory()->superAdmin()->create(['organization_id' => $this->org(['organization_type' => 'SYSTEM_ADMINISTRATION'])->id]);
    }

    /** @return array{intent: string, title: string, answer: string, rows: array<int, array<string, mixed>>, hrefs: array<int, string>, text: string} */
    private function ask(User $user, string $question): array
    {
        $service = $this->app->make(AskAiService::class);
        $intent = $service->classifyIntent($question, null, $user->role);
        $payload = $service->deterministicAnswer($user, $question, $intent);
        $rows = collect($payload['sections'])->pluck('rows')->flatten(1)->all();

        return [
            'intent' => $intent,
            'title' => $payload['title'],
            'answer' => $payload['answer'],
            'rows' => $rows,
            'hrefs' => array_values(array_filter(array_column($rows, 'href'))),
            'text' => json_encode($payload, JSON_UNESCAPED_UNICODE),
        ];
    }

    private function rowTexts(array $answer): string
    {
        return implode(' | ', array_map(fn (array $row) => ($row['primary'] ?? '').' / '.($row['secondary'] ?? '').' / '.($row['status'] ?? ''), $answer['rows']));
    }

    private function assertHrefsOpenFor(array $answer, string $role): void
    {
        $access = $this->app->make(ClientRouteAccess::class);
        foreach ($answer['hrefs'] as $href) {
            $this->assertNotNull($access->hrefFor($role, $href), "{$href} is refused for {$role}");
        }
    }

    // -------------------------------------------------------------------------
    // st-09: a student never reads an organization's budgets or events that are not approved
    // -------------------------------------------------------------------------

    public function test_a_student_never_reads_budgets_or_unapproved_events_however_the_question_is_worded(): void
    {
        $org = $this->org();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $student = User::factory()->student()->create(['organization_id' => $org->id]);
        Budget::create(['organization_id' => $org->id, 'title' => 'Zorbfest Budget', 'allocated_amount' => 5000, 'remaining_amount' => 4000, 'warning_threshold' => 100, 'submission_status' => 'approved']);
        Budget::create(['organization_id' => $org->id, 'title' => 'Quillgate Budget', 'allocated_amount' => 8000, 'remaining_amount' => 8000, 'warning_threshold' => 100, 'submission_status' => 'pending_department_head']);
        Event::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->school_id, 'title' => 'Quillgate Summit', 'status' => 'planning', 'start_time' => now()->addWeek(), 'end_time' => now()->addWeek()->addHours(2)]);
        Event::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->school_id, 'title' => 'Mothwick Gala', 'status' => 'cancelled', 'start_time' => now()->addWeek(), 'end_time' => now()->addWeek()->addHours(2)]);
        Announcement::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->school_id, 'title' => 'Officers Only Memo', 'target_role' => 'officer', 'is_published' => true]);

        $questions = [
            'What is the budget of my organization?',
            'How much money does Zorbfest have left?',
            'Tell me about the Quillgate Summit',
            'What events are planned for next week?',
            'Show me every event and its status',
            'Which budget requests are still pending?',
            'How much did we spend on Zorbfest Budget?',
            'Is the Mothwick Gala still happening?',
            'Search for Quillgate',
            'What is on the officers only memo?',
        ];

        foreach ($questions as $question) {
            $answer = $this->ask($student, $question);
            $answer['text'] = str_replace([$question, trim((string) json_encode($question), '"')], '', $answer['text']);
            foreach (['Zorbfest', 'Quillgate', 'Mothwick', 'Officers Only Memo'] as $secret) {
                $this->assertStringNotContainsString($secret, $answer['text'], "{$question} -> {$answer['intent']}: {$secret}");
            }
            $this->assertStringNotContainsString('rag-budget', $answer['text'], $question);
        }
    }

    // -------------------------------------------------------------------------
    // ask-02: money and event words from a student or an Admin are not compliance words
    // -------------------------------------------------------------------------

    public function test_a_student_asking_about_money_gets_their_own_account_not_a_refusal(): void
    {
        $org = $this->org();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $student = User::factory()->student()->create(['organization_id' => $org->id]);
        Invoice::create(['organization_id' => $org->id, 'reference' => 'INV-RT-1', 'student_id' => $student->school_id, 'description' => 'Membership Fee', 'amount_due' => 250, 'status' => 'unpaid', 'due_date' => now()->addWeek()->toDateString()]);
        Event::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->school_id, 'title' => 'Founders Day Picnic', 'status' => 'approved', 'start_time' => now()->addDays(3), 'end_time' => now()->addDays(3)->addHours(2)]);

        foreach (['What is my outstanding balance?', 'When is the deadline to pay my fees?', 'I am missing a receipt for my payment', 'Is my payment still pending approval?'] as $question) {
            $answer = $this->ask($student, $question);
            $this->assertSame('finance_health', $answer['intent'], $question);
            $this->assertSame('Your Fees & Account Balance', $answer['title'], $question);
            $this->assertStringContainsString('You owe your organization ₱250.00 across 1 open invoice', $answer['answer'], $question);
            $this->assertStringContainsString('Membership Fee', $this->rowTexts($answer), $question);
            $this->assertSame(['/dashboard/finance/statement-of-account'], array_values(array_unique($answer['hrefs'])), $question);
        }

        $events = $this->ask($student, 'What new events were assigned this month?');
        $this->assertSame('events_attendance', $events['intent']);
        $this->assertStringContainsString('Founders Day Picnic', $this->rowTexts($events));
        $this->assertStringNotContainsString('Not available', $events['title']);
    }

    public function test_an_admin_asking_about_an_outstanding_balance_gets_the_finance_answer_not_the_compliance_list(): void
    {
        $org = $this->org();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $student = User::factory()->student()->create(['organization_id' => $org->id]);
        Invoice::create(['organization_id' => $org->id, 'reference' => 'INV-RT-2', 'student_id' => $student->school_id, 'description' => 'Membership Fee', 'amount_due' => 250, 'status' => 'unpaid']);

        foreach (['What is our outstanding balance?', 'Which students have an outstanding balance?'] as $question) {
            $answer = $this->ask($admin, $question);
            $this->assertSame('finance_health', $answer['intent'], $question);
            $this->assertSame('Budget Utilization & Financial Status', $answer['title'], $question);
            $this->assertStringContainsString('1 student invoice is unpaid', $answer['answer'], $question);
            $this->assertStringNotContainsString('compliance requirement', $answer['answer'], $question);
        }
    }

    // -------------------------------------------------------------------------
    // ask-03: the dean's own word for a waiting request is endorsement
    // -------------------------------------------------------------------------

    public function test_a_dean_asking_what_is_waiting_for_endorsement_reads_the_budget_and_event_requests(): void
    {
        $college = $this->makeCollege('CCS');
        $this->makeCollegeHome($college);
        $org = $this->makeCollegeStudentOrganization($college, ['lifecycle_status' => 'active', 'is_active' => true]);
        $dean = $this->makeCollegeHead($college);
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $budget = Budget::create(['organization_id' => $org->id, 'title' => 'Sports Fest 2024 Budget', 'allocated_amount' => 5000, 'remaining_amount' => 5000, 'warning_threshold' => 100, 'submission_status' => 'pending_department_head']);
        $event = Event::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->school_id, 'title' => 'Induction and Recognition Ceremony', 'status' => 'planning']);
        foreach ([['budget', $budget->id], ['event', $event->id]] as [$type, $id]) {
            ApprovalRequest::create(['organization_id' => $org->id, 'entity_type' => $type, 'entity_id' => $id, 'requested_by' => $admin->school_id, 'required_role' => 'DEPARTMENT_HEAD', 'status' => 'pending', 'requested_at' => now()]);
        }

        foreach (['What is waiting for my endorsement?', 'Which budget requests are waiting for my endorsement?', 'Summarize the reports waiting for my approval'] as $question) {
            $answer = $this->ask($dean, $question);
            $this->assertSame('pending_approvals', $answer['intent'], $question);
            $this->assertSame('Pending Approvals & Review Queue', $answer['title'], $question);
            $this->assertStringContainsString('2 approval requests are waiting for your review', $answer['answer'], $question);
            $rows = $this->rowTexts($answer);
            $this->assertStringContainsString('Sports Fest 2024 Budget', $rows, $question);
            $this->assertStringContainsString('Induction and Recognition Ceremony', $rows, $question);
            $this->assertSame(['/dashboard/approvals'], array_values(array_unique($answer['hrefs'])), $question);
        }
    }

    public function test_the_applications_answer_does_not_say_all_clear_while_approval_requests_wait(): void
    {
        $college = $this->makeCollege('CBA');
        $this->makeCollegeHome($college);
        $org = $this->makeCollegeStudentOrganization($college, ['lifecycle_status' => 'active', 'is_active' => true]);
        $dean = $this->makeCollegeHead($college);
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $budget = Budget::create(['organization_id' => $org->id, 'title' => 'Library Week Budget', 'allocated_amount' => 5000, 'remaining_amount' => 5000, 'warning_threshold' => 100, 'submission_status' => 'pending_department_head']);
        ApprovalRequest::create(['organization_id' => $org->id, 'entity_type' => 'budget', 'entity_id' => $budget->id, 'requested_by' => $admin->school_id, 'required_role' => 'DEPARTMENT_HEAD', 'status' => 'pending', 'requested_at' => now()]);

        $answer = $this->ask($dean, 'Which applications are waiting for my endorsement?');

        $this->assertSame('applications_queue', $answer['intent']);
        $this->assertStringContainsString('No applications are waiting for your endorsement right now.', $answer['answer']);
        $this->assertStringContainsString('1 approval request is waiting for your decision', $answer['answer']);
        $this->assertStringContainsString('What is waiting for my approval?', $answer['answer']);
    }

    // -------------------------------------------------------------------------
    // ask-04: a venue question reads the venue bookings
    // -------------------------------------------------------------------------

    public function test_the_sao_asking_about_venue_bookings_is_told_which_bookings_wait(): void
    {
        $sao = $this->sao();
        $orgA = $this->org(['name' => 'Chess Guild', 'acronym' => 'CHESS']);
        $orgB = $this->org(['name' => 'Drama Circle', 'acronym' => 'DRAMA']);
        $requester = User::factory()->admin()->create(['organization_id' => $orgA->id]);
        $venue = Venue::create(['name' => 'Main Gymnasium', 'location' => 'Campus', 'capacity' => 500, 'is_active' => true]);
        $booking = fn (Organization $org, string $status, int $days) => VenueBooking::create(['venue_id' => $venue->id, 'organization_id' => $org->id, 'start_time' => now()->addDays($days), 'end_time' => now()->addDays($days)->addHours(3), 'status' => $status, 'requested_by' => $requester->school_id]);
        $booking($orgA, 'pending', 5);
        $booking($orgB, 'pending', 9);
        $booking($orgB, 'approved', 12);

        foreach (['What venue bookings are waiting for me?', 'Which venue bookings are pending?'] as $question) {
            $answer = $this->ask($sao, $question);
            $this->assertSame('pending_approvals', $answer['intent'], $question);
            $this->assertStringContainsString('2 venue bookings are waiting for your confirmation', $answer['answer'], $question);
            $rows = $this->rowTexts($answer);
            $this->assertStringContainsString('Main Gymnasium · CHESS', $rows, $question);
            $this->assertStringContainsString('Main Gymnasium · DRAMA', $rows, $question);
            $this->assertCount(2, array_filter($answer['rows'], fn (array $row) => str_starts_with((string) $row['secondary'], 'Venue booking')), $question);
            $this->assertStringContainsString('Main Gymnasium', $rows, $question);
            $this->assertContains('/dashboard/super-admin/venues', $answer['hrefs'], $question);
            $this->assertHrefsOpenFor($answer, 'SUPER_ADMIN');
        }
    }

    public function test_an_admin_asking_about_venue_bookings_reads_their_own_organizations_bookings(): void
    {
        $org = $this->org();
        $other = $this->org();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $venue = Venue::create(['name' => 'Main Gymnasium', 'location' => 'Campus', 'capacity' => 500, 'is_active' => true]);
        VenueBooking::create(['venue_id' => $venue->id, 'organization_id' => $org->id, 'start_time' => now()->addDays(5), 'end_time' => now()->addDays(5)->addHours(3), 'status' => 'pending', 'requested_by' => $admin->school_id]);
        VenueBooking::create(['venue_id' => $venue->id, 'organization_id' => $other->id, 'start_time' => now()->addDays(6), 'end_time' => now()->addDays(6)->addHours(3), 'status' => 'pending', 'requested_by' => $admin->school_id]);

        $answer = $this->ask($admin, 'What venue bookings are waiting for approval?');

        $this->assertSame('my_submissions', $answer['intent']);
        $this->assertSame('Where Your Submissions Stand', $answer['title']);
        $this->assertCount(1, $answer['rows']);
        $this->assertStringContainsString('Main Gymnasium', $answer['rows'][0]['primary']);
        $this->assertStringContainsString('Venue booking', $answer['rows'][0]['secondary']);
        $this->assertStringContainsString('1 venue booking is with reviewers', $answer['answer']);
        $this->assertSame(['/dashboard/venues'], $answer['hrefs']);
    }

    // -------------------------------------------------------------------------
    // ask-11: a grievance question is answered from the grievances this person may open
    // -------------------------------------------------------------------------

    private function grievance(array $overrides): Grievance
    {
        return Grievance::create([
            'is_anonymous' => false,
            'description' => 'Details',
            'category' => 'Facilities',
            'urgency' => 'Medium',
            'status' => 'submitted',
            ...$overrides,
        ]);
    }

    public function test_an_admin_asking_about_grievances_reads_only_their_own_organizations(): void
    {
        $org = $this->org();
        $other = $this->org();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $student = User::factory()->student()->create(['organization_id' => $org->id, 'first_name' => 'Zelda', 'last_name' => 'Quimby']);
        $this->grievance(['organization_id' => $org->id, 'submitted_by' => $student->school_id, 'title' => 'Broken Aircon In Room Nine', 'urgency' => 'High']);
        $this->grievance(['organization_id' => $org->id, 'submitted_by' => $student->school_id, 'title' => 'Late Reimbursement', 'status' => 'under_review']);
        $this->grievance(['organization_id' => $org->id, 'submitted_by' => $student->school_id, 'title' => 'Already Settled Matter', 'status' => 'resolved']);
        $this->grievance(['organization_id' => $other->id, 'submitted_by' => $student->school_id, 'title' => 'Other Organization Complaint']);
        $this->grievance(['organization_id' => null, 'submitted_by' => $student->school_id, 'title' => 'Addressed To The SAO']);

        foreach (['Are there urgent student grievances?', 'Any complaints from our members?'] as $question) {
            $answer = $this->ask($admin, $question);
            $this->assertSame('grievances_status', $answer['intent'], $question);
            $this->assertSame('Grievances Addressed to Your Organization', $answer['title'], $question);
            $this->assertStringContainsString('2 grievances are unresolved, and 1 of them is high or critical urgency', $answer['answer'], $question);
            $rows = $this->rowTexts($answer);
            $this->assertStringContainsString('Broken Aircon In Room Nine', $rows, $question);
            $this->assertStringContainsString('Late Reimbursement', $rows, $question);
            foreach (['Already Settled Matter', 'Other Organization Complaint', 'Addressed To The SAO', $student->first_name, $student->last_name] as $hidden) {
                $this->assertStringNotContainsString($hidden, $answer['text'], $question);
            }
            $this->assertSame(['/dashboard/grievances'], array_values(array_unique($answer['hrefs'])), $question);
            $this->assertHrefsOpenFor($answer, 'ADMIN');
        }
    }

    public function test_a_student_asking_about_a_grievance_reads_only_their_own(): void
    {
        $org = $this->org();
        $student = User::factory()->student()->create(['organization_id' => $org->id]);
        $classmate = User::factory()->student()->create(['organization_id' => $org->id]);
        $this->grievance(['organization_id' => $org->id, 'submitted_by' => $student->school_id, 'title' => 'Noisy Hallway Near Library', 'status' => 'under_review']);
        $this->grievance(['organization_id' => null, 'submitted_by' => $student->school_id, 'title' => 'Scholarship Delay', 'status' => 'resolved']);
        $this->grievance(['organization_id' => $org->id, 'submitted_by' => $classmate->school_id, 'title' => 'Classmates Private Matter']);

        $queue = $this->app->make(AskAiService::class)->deterministicAnswer($student, 'Give me the status please', 'grievances_status');
        $this->assertSame('Your Grievances', $queue['title']);
        $this->assertStringNotContainsString('Classmates Private Matter', json_encode($queue));

        foreach (['What happened to my grievance?', 'Is my complaint still open?'] as $question) {
            $answer = $this->ask($student, $question);
            $this->assertSame('grievances_status', $answer['intent'], $question);
            $this->assertSame('Your Grievances', $answer['title'], $question);
            $this->assertStringContainsString('You have filed 2 grievances, and 1 is still open', $answer['answer'], $question);
            $rows = $this->rowTexts($answer);
            $this->assertStringContainsString('Noisy Hallway Near Library', $rows, $question);
            $this->assertStringContainsString('Under Review', $rows, $question);
            $this->assertStringContainsString('Scholarship Delay', $rows, $question);
            $this->assertStringNotContainsString('Classmates Private Matter', $answer['text'], $question);
            $this->assertStringNotContainsString('Not available', $answer['title'], $question);
            $this->assertSame(['/dashboard/my-grievances'], array_values(array_unique($answer['hrefs'])), $question);
            $this->assertHrefsOpenFor($answer, 'STUDENT');
        }
    }

    public function test_officers_and_deans_are_told_who_reads_grievances(): void
    {
        $college = $this->makeCollege('CTE');
        $this->makeCollegeHome($college);
        $org = $this->makeCollegeStudentOrganization($college, ['lifecycle_status' => 'active', 'is_active' => true]);
        $student = User::factory()->student()->create(['organization_id' => $org->id]);
        $this->grievance(['organization_id' => $org->id, 'submitted_by' => $student->school_id, 'title' => 'Hidden From Officers']);

        foreach ([User::factory()->officer()->create(['organization_id' => $org->id]), $this->makeCollegeHead($college)] as $reader) {
            $answer = $this->ask($reader, 'Are there urgent student grievances?');
            $this->assertSame('grievances_status', $answer['intent'], $reader->role);
            $this->assertStringContainsString('read by the organization head and the SAO', $answer['answer'], $reader->role);
            $this->assertStringNotContainsString('Hidden From Officers', $answer['text'], $reader->role);
            $this->assertSame([], $answer['rows'], $reader->role);
        }
    }

    // -------------------------------------------------------------------------
    // ask-16: the dean's office staff are given only links their profile can open
    // -------------------------------------------------------------------------

    public function test_office_staff_are_given_guide_links_their_profile_can_open_and_the_dean_keeps_the_dean_pages(): void
    {
        $college = $this->makeCollege('ENG');
        $home = $this->makeCollegeHome($college);
        $staff = User::factory()->admin()->create(['organization_id' => $home->id]);
        $staff->activateProfile($staff->accountProfiles()->firstOrFail(), true);
        $this->assertSame('DEPARTMENT_HEAD', $staff->role);
        $dean = $this->makeCollegeHead($college);

        $fallbacks = [
            'How do I check compliance and remind organizations?' => '/dashboard/department-head/documents',
            'How do I post a college announcement?' => '/dashboard/announcements/view-announcements',
            'I want to post a college announcement' => '/dashboard/announcements/view-announcements',
        ];
        foreach ($fallbacks as $question => $fallback) {
            $answer = $this->ask($staff, $question);
            $this->assertSame('how_to_guide', $answer['intent'], $question);
            $this->assertHrefsOpenFor($answer, 'ADMIN');
            $this->assertContains($fallback, $answer['hrefs'], $question);
            $this->assertNotContains('/dashboard/department-head/compliance', $answer['hrefs'], $question);
            $this->assertNotContains('/dashboard/department-head/announcements', $answer['hrefs'], $question);
        }

        foreach (['How do I approve requests from my college organizations?', 'I wanna create an org', 'How do I do something with a spaceship', 'I want to zxqv wibble'] as $question) {
            $answer = $this->ask($staff, $question);
            $this->assertHrefsOpenFor($answer, 'ADMIN');
        }

        $this->assertContains('/dashboard/department-head/compliance', $this->ask($dean, 'How do I check compliance and remind organizations?')['hrefs']);
        $this->assertContains('/dashboard/department-head/announcements', $this->ask($dean, 'How do I post a college announcement?')['hrefs']);
    }

    // -------------------------------------------------------------------------
    // ask-05: everyday questions reach the answer that already read their records
    // -------------------------------------------------------------------------

    public function test_everyday_admin_and_officer_questions_reach_the_records_not_a_tracker_or_a_tool_explainer(): void
    {
        $org = $this->org();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $officer = User::factory()->officer()->create(['organization_id' => $org->id]);
        Event::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->school_id, 'title' => 'Leadership Summit', 'location' => 'Hall B Auditorium', 'status' => 'approved', 'start_time' => now()->addDay(), 'end_time' => now()->addDay()->addHours(2)]);
        Task::factory()->create(['organization_id' => $org->id, 'title' => 'Print the programs', 'assigned_to' => $officer->school_id, 'status' => 'pending']);

        $missing = $this->ask($admin, 'What are our missing submissions?');
        $this->assertSame('missing_submissions', $missing['intent']);
        $this->assertSame('Missing or Returned Requirements', $missing['title']);

        $clearance = $this->ask($admin, 'What is the status of my clearance requests?');
        $this->assertSame('clearances_status', $clearance['intent']);
        $this->assertStringNotContainsString('Where Your Submissions Stand', $clearance['title']);

        $held = $this->ask($admin, 'Where is our event being held tomorrow?');
        $this->assertSame('events_attendance', $held['intent']);
        $this->assertStringContainsString('Leadership Summit', $this->rowTexts($held));
        $this->assertStringContainsString('Hall B Auditorium', $this->rowTexts($held));

        $drafts = $this->ask($admin, 'Which draft announcements are still unpublished?');
        $this->assertNotSame('ai_tools', $drafts['intent']);
        $this->assertStringNotContainsString('The AI tools', $drafts['title']);

        $week = $this->ask($officer, 'Help me plan my week');
        $this->assertSame('daily_priorities', $week['intent']);
        $this->assertStringNotContainsString('only for your organization', $week['answer']);
        $this->assertStringContainsString('1 task is pending or in progress', $this->rowTexts($week));
    }

    public function test_the_wording_a_tool_explainer_would_take_still_reaches_it(): void
    {
        $org = $this->org();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);

        foreach (['Write an announcement about the fun run' => 'Announcement drafting', 'Help me plan our event' => 'Event planning'] as $question => $tool) {
            $answer = $this->ask($admin, $question);
            $this->assertSame('ai_tools', $answer['intent'], $question);
            $this->assertStringContainsString($tool, $answer['text'], $question);
        }
    }

    // -------------------------------------------------------------------------
    // The live questions that failed the second check, one test per kind of question.
    // Old answers are what the live check read; the new ones are asserted here.
    // -------------------------------------------------------------------------

    /** @return array<string, User> */
    private function fiveRoles(): array
    {
        $college = $this->makeCollege('CCS');
        $this->makeCollegeHome($college);
        $org = $this->makeCollegeStudentOrganization($college, ['lifecycle_status' => 'active', 'is_active' => true]);

        return [
            'SUPER_ADMIN' => $this->sao(),
            'DEPARTMENT_HEAD' => $this->makeCollegeHead($college),
            'ADMIN' => User::factory()->admin()->create(['organization_id' => $org->id]),
            'SBO_OFFICER' => User::factory()->officer()->create(['organization_id' => $org->id]),
            'STUDENT' => User::factory()->student()->create(['organization_id' => $org->id]),
        ];
    }

    // rt-01: "what do I owe" used to answer SAO, dean, Admin and officer with organization budget totals.
    public function test_what_do_i_owe_is_the_askers_own_account_never_the_organizations_budget(): void
    {
        $users = $this->fiveRoles();
        foreach (['ADMIN', 'SBO_OFFICER', 'STUDENT'] as $role) {
            Invoice::create(['organization_id' => $users[$role]->organization_id, 'reference' => 'INV-OWE-'.$role, 'student_id' => $users[$role]->school_id, 'description' => 'Membership Fee', 'amount_due' => 250, 'status' => 'unpaid']);
        }
        $org = Organization::find($users['ADMIN']->organization_id);
        Budget::create(['organization_id' => $org->id, 'title' => 'Orientation Budget', 'allocated_amount' => 9000, 'remaining_amount' => 9000, 'warning_threshold' => 100, 'submission_status' => 'approved']);

        foreach (['ADMIN', 'SBO_OFFICER', 'STUDENT'] as $role) {
            $answer = $this->ask($users[$role], 'what do I owe');
            $this->assertSame($role === 'STUDENT' ? 'finance_health' : 'own_balance', $answer['intent'], $role);
            $this->assertSame('Your Fees & Account Balance', $answer['title'], $role);
            $this->assertStringContainsString('You owe your organization ₱250.00 across 1 open invoice', $answer['answer'], $role);
            $this->assertStringNotContainsString('Orientation Budget', $answer['text'], $role);
            $this->assertSame(['/dashboard/finance/statement-of-account'], array_values(array_unique($answer['hrefs'])), $role);
            $this->assertHrefsOpenFor($answer, $role);
        }

        foreach (['SUPER_ADMIN' => 'The SAO', 'DEPARTMENT_HEAD' => 'The Department Head / Dean'] as $role => $who) {
            $answer = $this->ask($users[$role], 'what do I owe');
            $this->assertSame('how_to_guide', $answer['intent'], $role);
            $this->assertStringContainsString($who, $answer['answer'], $role);
            $this->assertStringContainsString('cannot', $answer['answer'], $role);
            $this->assertStringNotContainsString('approved budgets total', $answer['answer'], $role);
            $this->assertStringNotContainsString('Orientation Budget', $answer['text'], $role);
        }
    }

    // rt-02: "open election" used to be read as a question and answered with a count of elections.
    public function test_open_election_is_a_request_to_do_something_not_a_count(): void
    {
        $users = $this->fiveRoles();

        foreach (['SUPER_ADMIN', 'DEPARTMENT_HEAD', 'SBO_OFFICER'] as $role) {
            $answer = $this->ask($users[$role], 'open election');
            $this->assertSame('how_to_guide', $answer['intent'], $role);
            $this->assertSame('Set up and run an election', $answer['title'], $role);
            $this->assertStringContainsString('cannot set up and run an election in HIUSA; that is done by the Organization Admin.', $answer['answer'], $role);
            $this->assertStringNotContainsString('open for voting now', $answer['answer'], $role);
            $this->assertNotSame([], $answer['hrefs'], $role);
            $this->assertHrefsOpenFor($answer, $role);
        }

        $admin = $this->ask($users['ADMIN'], 'open election');
        $this->assertSame('Set up and run an election', $admin['title']);
        $this->assertStringStartsWith('Yes, you can do that, and it starts on the Elections page.', $admin['answer']);
        $this->assertContains('/dashboard/elections/manage-elections', $admin['hrefs']);
        $this->assertHrefsOpenFor($admin, 'ADMIN');
        $this->assertMatchesRegularExpression('/\n\nFrom your records: .+\n\nThe ".+" button below takes you there/s', $admin['answer']);
    }

    // rt-03: "approve the budget" told the SAO the Department Head approves, under a title written for the dean's college.
    public function test_approve_the_budget_gives_each_reviewer_their_own_guide_and_names_every_reviewer(): void
    {
        $users = $this->fiveRoles();

        $sao = $this->ask($users['SUPER_ADMIN'], 'approve the budget');
        $this->assertSame('Give final approval to budgets, events, and financial reports', $sao['title']);
        $this->assertStringStartsWith('Yes, you can do that', $sao['answer']);
        $this->assertContains('/dashboard/super-admin/organization-approvals', $sao['hrefs']);
        $this->assertStringNotContainsString('college', $sao['title']);
        $this->assertHrefsOpenFor($sao, 'SUPER_ADMIN');

        $dean = $this->ask($users['DEPARTMENT_HEAD'], 'approve the budget');
        $this->assertSame('Approve budgets, events, and reports for your college', $dean['title']);
        $this->assertContains('/dashboard/department-head/approvals', $dean['hrefs']);

        foreach (['ADMIN', 'SBO_OFFICER'] as $role) {
            $answer = $this->ask($users[$role], 'approve the budget');
            $this->assertSame('Approve budgets, events and reports', $answer['title'], $role);
            $this->assertStringContainsString('that is done by the Department Head and the SAO.', $answer['answer'], $role);
            $this->assertHrefsOpenFor($answer, $role);
        }
    }

    // rt-04: "i wanna create an org" was titled "as SAO" for an Admin or an officer and never said a student can apply.
    public function test_create_an_org_from_a_role_that_cannot_says_who_does_and_how_a_student_can_apply(): void
    {
        $users = $this->fiveRoles();

        foreach (['ADMIN' => 'An Organization Admin', 'SBO_OFFICER' => 'An SBO Officer'] as $role => $who) {
            $answer = $this->ask($users[$role], 'i wanna create an org');
            $this->assertSame('Create an organization directly', $answer['title'], $role);
            $this->assertStringStartsWith($who.' cannot create an organization directly in HIUSA; that is done by the SAO.', $answer['answer'], $role);
            $this->assertStringContainsString('A student who wants to start an organization applies for it once the Department Head of their college allows them to', $answer['answer'], $role);
            $this->assertHrefsOpenFor($answer, $role);
        }

        $sao = $this->ask($users['SUPER_ADMIN'], 'i wanna create an org');
        $this->assertSame('Create an organization directly as SAO', $sao['title']);
        $this->assertStringStartsWith('Yes, you can', $sao['answer']);

        $student = $this->ask($users['STUDENT'], 'i wanna create an org');
        $this->assertSame('Apply to register a new organization', $student['title']);
        $this->assertContains('/dashboard/student/apply-organization', $student['hrefs']);
    }

    // rt-05: an officer's overdue count is the officer's own tasks, and the answer now says so.
    public function test_an_officers_task_answer_says_it_counts_only_their_own_tasks(): void
    {
        $users = $this->fiveRoles();
        $orgId = $users['ADMIN']->organization_id;
        Task::factory()->create(['organization_id' => $orgId, 'title' => 'Mine To Finish', 'assigned_to' => $users['SBO_OFFICER']->school_id, 'created_by' => $users['ADMIN']->school_id, 'status' => 'overdue', 'deadline' => now()->subDay()]);
        Task::factory()->count(2)->create(['organization_id' => $orgId, 'assigned_to' => $users['ADMIN']->school_id, 'created_by' => $users['ADMIN']->school_id, 'status' => 'overdue', 'deadline' => now()->subDay()]);

        $officer = $this->ask($users['SBO_OFFICER'], 'show me overdue tasks');
        $this->assertSame('tasks_workload', $officer['intent']);
        $this->assertStringStartsWith('Of the tasks assigned to you, 1 task is overdue, and 0 tasks are still pending or in progress.', $officer['answer']);
        $this->assertStringContainsString('Mine To Finish', $this->rowTexts($officer));

        $admin = $this->ask($users['ADMIN'], 'show me overdue tasks');
        $this->assertStringStartsWith('3 tasks are overdue', $admin['answer']);
    }

    // rt-06: "how much budget is left" from a student was answered as if they had asked for their fees.
    public function test_a_student_asking_about_the_budget_is_told_budgets_are_not_theirs_to_see(): void
    {
        $users = $this->fiveRoles();
        $student = $users['STUDENT'];
        Budget::create(['organization_id' => $student->organization_id, 'title' => 'Orientation Budget', 'allocated_amount' => 9000, 'remaining_amount' => 7000, 'warning_threshold' => 100, 'submission_status' => 'approved']);

        foreach (['how much budget is left', 'What is the budget of my organization?'] as $question) {
            $answer = $this->ask($student, $question);
            $this->assertSame('finance_health', $answer['intent'], $question);
            $this->assertStringStartsWith('Organization budgets are not shown to students. You owe your organization ₱0.00', $answer['answer'], $question);
            $this->assertStringNotContainsString('Orientation Budget', $answer['text'], $question);
            $this->assertStringNotContainsString('9,000', $answer['text'], $question);
        }
    }

    // rt-07: a budget that shows more remaining than allocated now explains why.
    public function test_remaining_budget_above_the_allocation_is_explained(): void
    {
        $users = $this->fiveRoles();
        $orgId = $users['ADMIN']->organization_id;
        Budget::create(['organization_id' => $orgId, 'title' => 'General Operations Fund', 'allocated_amount' => 50000, 'remaining_amount' => 80000, 'warning_threshold' => 100, 'submission_status' => 'approved']);

        $answer = $this->ask($users['ADMIN'], 'how is our budget?');

        $this->assertStringContainsString('₱50,000.00 allocated with ₱80,000.00 remaining', $answer['answer']);
        $this->assertStringContainsString('higher than the amount allocated because income recorded against a budget is added to it', $answer['answer']);

        Budget::query()->update(['remaining_amount' => 20000]);
        $this->assertStringNotContainsString('income recorded', $this->ask($users['ADMIN'], 'how is our budget?')['answer']);
    }

    // rt-cap: "what can you do?" lists the actions the signed-in role can use, and only those.
    public function test_what_can_you_do_lists_the_actions_the_role_can_use(): void
    {
        $users = $this->fiveRoles();
        $service = $this->app->make(AskAiService::class);
        $actions = $this->app->make(AskAiActions::class);
        $all = ['Create an event', 'Create a task', 'Propose a budget', 'Draft an announcement', 'File a grievance', 'Let a student apply for a new organization', 'Add a college'];

        foreach ($users as $role => $user) {
            $mine = $actions->titlesFor($user);
            $this->assertNotSame([], $mine, $role);
            $answer = $service->capabilitiesAnswer($user)['answer'];
            $this->assertStringContainsString('In the chat I can also fill in the form for you, for these: ', $answer, $role);
            $this->assertStringContainsString('Nothing is saved until you check the form and confirm it.', $answer, $role);
            foreach ($all as $title) {
                $line = 'for these: ';
                $listed = substr($answer, (int) strpos($answer, $line) + strlen($line));
                $listed = substr($listed, 0, (int) strpos($listed, '. Nothing is saved'));
                if (in_array($title, $mine, true)) {
                    $this->assertStringContainsString(lcfirst($title), $listed, "{$role}: {$title}");
                } else {
                    $this->assertStringNotContainsString(lcfirst($title), $listed, "{$role}: {$title}");
                }
            }
            $this->assertStringContainsString('I never approve, assign or publish anything for you', $answer, $role);
            $this->assertStringNotContainsString('I only read', $answer, $role);
        }

        $this->assertSame(['Draft an announcement'], $actions->titlesFor($users['SBO_OFFICER']));
        $this->assertStringContainsString('for these: file a grievance.', $service->capabilitiesAnswer($users['STUDENT'])['answer']);
    }

    public function test_the_role_intent_matcher_leaves_the_questions_the_older_answers_read_to_them(): void
    {
        $matcher = $this->app->make(AskAiRoleIntents::class);

        foreach ([
            ['What are our missing submissions?', 'ADMIN'],
            ['What is the status of my clearance requests?', 'ADMIN'],
            ['Where is our event being held tomorrow?', 'ADMIN'],
            ['Which draft announcements are still unpublished?', 'ADMIN'],
            ['Summarize the reports waiting for my approval', 'DEPARTMENT_HEAD'],
            ['Help me plan my week', 'SBO_OFFICER'],
            ['What is waiting for my endorsement?', 'DEPARTMENT_HEAD'],
            ['Which budget requests are waiting for my endorsement?', 'DEPARTMENT_HEAD'],
            ['What venue bookings are waiting for me?', 'SUPER_ADMIN'],
        ] as [$question, $role]) {
            $this->assertNull($matcher->match($question, $role), "{$role}: {$question}");
        }

        $this->assertSame('applications_queue', $matcher->match('Which applications need my endorsement?', 'DEPARTMENT_HEAD'));
        $this->assertSame('my_submissions', $matcher->match('Where is our budget request?', 'ADMIN'));
    }
}
