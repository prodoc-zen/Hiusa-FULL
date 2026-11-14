<?php

namespace Tests\Feature;

use App\Contracts\TextGenerator;
use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\AccountProfile;
use App\Models\ApprovalRequest;
use App\Models\Budget;
use App\Models\ComplianceRequirementType;
use App\Models\Election;
use App\Models\ElectionBallot;
use App\Models\Event;
use App\Models\Merchandise;
use App\Models\Order;
use App\Models\Organization;
use App\Models\OrganizationComplianceSubmission;
use App\Models\Task;
use App\Models\User;
use App\Services\Ai\AskAiService;
use App\Services\Ai\Concerns\GuardsGeneratedText;
use App\Services\Ai\HowToGuideLibrary;
use App\Services\Dashboard\ClientRouteAccess;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\Support\AskAiChatFakeGenerator;
use Tests\TestCase;

class AskAiReviewFixesTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private const FORBIDDEN_WORDS = ['(s)', 'in scope', 'cross-domain', 'Copilot', 'RAG', 'BM25', 'SUPER_ADMIN', 'DEPARTMENT_HEAD', 'SBO_OFFICER', 'Super Admin'];

    protected function setUp(): void
    {
        parent::setUp();
        config(['performance.api_cache.enabled' => false, 'services.groq.key' => '', 'services.anthropic.key' => '']);
        RateLimiter::for('ai-generation', fn () => Limit::none());
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
        $home = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);

        return User::factory()->superAdmin()->create(['organization_id' => $home->id]);
    }

    private function semester(): AcademicSemester
    {
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);

        return AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'status' => 'active']);
    }

    private function answer(User $user, string $intent, string $question = 'Give me the status please'): array
    {
        return $this->app->make(AskAiService::class)->deterministicAnswer($user, $question, $intent);
    }

    private function briefing(User $user): array
    {
        return $this->answer($user, 'daily_priorities', 'What should I do today?');
    }

    private function highlight(array $payload, string $label): ?string
    {
        return collect($payload['highlights'])->firstWhere('label', $label)['value'] ?? null;
    }

    private function rows(array $payload): array
    {
        return collect($payload['sections'])->flatMap(fn (array $section) => $section['rows'])->all();
    }

    private function row(array $payload, string $id): ?array
    {
        return collect($this->rows($payload))->firstWhere('id', $id);
    }

    private function approval(Organization $org, User $requester, string $requiredRole, string $entityType = 'event', array $overrides = []): ApprovalRequest
    {
        static $entityId = 9000;
        $entityId++;

        return ApprovalRequest::create([
            'organization_id' => $org->id,
            'entity_type' => $entityType,
            'entity_id' => $entityId,
            'required_role' => $requiredRole,
            'requested_by' => $requester->school_id,
            'status' => 'pending',
            'requested_at' => now()->subDay(),
            ...$overrides,
        ]);
    }

    /** @return array<string, User> one account of every role, all in a college with one active student organization */
    private function everyRole(): array
    {
        $college = $this->makeCollege('ENG');
        $home = $this->makeCollegeHome($college);
        $org = $this->makeCollegeStudentOrganization($college, ['lifecycle_status' => 'active', 'is_active' => true]);

        return [
            'SUPER_ADMIN' => $this->sao(),
            'DEPARTMENT_HEAD' => User::factory()->departmentHead()->create(['organization_id' => $home->id]),
            'ADMIN' => User::factory()->admin()->create(['organization_id' => $org->id]),
            'SBO_OFFICER' => User::factory()->officer()->create(['organization_id' => $org->id]),
            'STUDENT' => User::factory()->student()->create(['organization_id' => $org->id]),
        ];
    }

    private function assertPlainWords(array $payload, string $label): void
    {
        $text = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        foreach (self::FORBIDDEN_WORDS as $word) {
            $this->assertStringNotContainsString($word, $text, "{$label} contains {$word}");
        }
    }

    // ask-01

    public function test_a_question_with_no_searchable_word_is_answered_for_every_role(): void
    {
        foreach ($this->everyRole() as $role => $user) {
            Sanctum::actingAs($user);
            foreach (['What can you do?', 'What is it?', 'ok'] as $question) {
                $this->postJson('/api/ai/assistant/ask', ['question' => $question])->assertOk();
                $this->postJson('/api/ai/assistant/ask', ['question' => $question, 'topic' => 'semantic_rag'])->assertOk();
            }
        }
    }

    public function test_the_chat_answers_a_question_with_no_searchable_word_instead_of_ending_in_an_error(): void
    {
        $this->app->instance(TextGenerator::class, new AskAiChatFakeGenerator(['Hello.']));
        $admin = $this->everyRole()['ADMIN'];
        Sanctum::actingAs($admin);

        foreach (['What is it?', 'What can you do?'] as $message) {
            $body = $this->postJson('/api/ai/assistant/chat', ['message' => $message], ['Accept' => 'text/event-stream'])->assertOk()->streamedContent();
            $this->assertStringNotContainsString('event: error', $body, $message);
        }
    }

    // ask-06: the invented-name check was removed, so an honest answer is never thrown away.

    public function test_a_model_answer_that_names_an_office_a_page_and_the_askers_college_is_kept(): void
    {
        $fake = new class implements TextGenerator
        {
            use GuardsGeneratedText;

            public function generate(string $instructions, string $input, int $maxOutputTokens = 400, float $temperature = 0.2): ?array
            {
                return ['text' => 'The Student Affairs Office reads the Budget Allocation page for the College of Engineering, and nothing else needs you today.', 'model' => 'claude-test', 'response_id' => null];
            }

            public function generateStructured(string $instructions, array $input, string $schemaName, array $schema, int $maxOutputTokens = 1800, float $temperature = 0.2): ?array
            {
                return null;
            }

            public function converse(string $instructions, array $messages, int $maxOutputTokens = 1400, ?callable $onEvent = null): ?array
            {
                return null;
            }
        };
        $this->app->instance(TextGenerator::class, $fake);
        Sanctum::actingAs($this->everyRole()['ADMIN']);

        $answer = $this->postJson('/api/ai/assistant/ask', ['question' => 'What should I do today?', 'topic' => 'daily_priorities'])->assertOk();

        $this->assertStringContainsString('Student Affairs Office reads the Budget Allocation page', $answer->json('answer'));
        $this->assertSame('Record search + Claude', $answer->json('rag_metadata.engine'));
    }

    // ask-07

    public function test_the_admin_briefing_counts_what_the_orders_answer_counts(): void
    {
        $org = $this->org();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $student = User::factory()->student()->create(['organization_id' => $org->id]);
        $item = Merchandise::factory()->create(['organization_id' => $org->id]);
        Order::factory()->create([
            'organization_id' => $org->id, 'student_id' => $student->school_id, 'merchandise_id' => $item->id,
            'status' => 'pending', 'officer_review_status' => 'pending', 'payment_method' => 'cash_on_claim', 'payment_proof_url' => null,
        ]);

        $this->assertSame('1', $this->highlight($this->briefing($admin), 'Orders to verify'));
        $this->assertStringContainsString('1 order is waiting for payment verification', $this->answer($admin, 'merchandise_orders')['answer']);
    }

    public function test_the_sao_briefing_leaves_out_a_withdrawn_grievance_and_a_request_assigned_to_someone_else(): void
    {
        $sao = $this->sao();
        $org = $this->org();
        $student = User::factory()->student()->create(['organization_id' => $org->id]);
        $author = User::factory()->admin()->create(['organization_id' => $org->id]);
        DB::table('grievances')->insert([
            'organization_id' => $sao->organization_id, 'submitted_by' => $student->school_id, 'title' => 'Withdrawn', 'description' => 'x',
            'urgency' => 'Critical', 'status' => 'submitted', 'deleted_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->approval($org, $author, 'SUPER_ADMIN', 'event', ['assigned_approver' => User::factory()->superAdmin()->create(['organization_id' => $sao->organization_id])->school_id]);

        $briefing = $this->briefing($sao);

        $this->assertNull($this->row($briefing, 'prio-grievances'));
        $this->assertNull($this->row($briefing, 'prio-event-approvals'));
        $this->assertSame('0', $this->highlight($briefing, 'Total action items'));
        $this->assertSame('0', $this->highlight($this->answer($sao, 'grievances_status'), 'Unresolved grievances') ?? '0');
        $this->assertSame('0', $this->highlight($this->answer($sao, 'pending_approvals'), 'Pending approvals'));
    }

    public function test_the_admin_briefing_counts_only_tasks_of_the_selected_semester_and_requests_waiting_for_the_admin(): void
    {
        $semester = $this->semester();
        $earlier = AcademicSemester::create(['academic_year_id' => $semester->academic_year_id, 'number' => 2, 'starts_on' => '2026-01-01', 'ends_on' => '2026-07-31', 'status' => 'completed']);
        $org = $this->org();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $other = User::factory()->admin()->create(['organization_id' => $org->id]);
        $officer = User::factory()->officer()->create(['organization_id' => $org->id]);
        Task::factory()->create(['organization_id' => $org->id, 'assigned_to' => $officer->school_id, 'created_by' => $admin->school_id, 'status' => 'overdue', 'deadline' => now()->subDay(), 'academic_semester_id' => $earlier->id]);
        $this->approval($org, $officer, 'ADMIN', 'event', ['assigned_approver' => $other->school_id]);

        $briefing = $this->briefing($admin);

        $this->assertSame('0', $this->highlight($briefing, 'Overdue tasks'));
        $this->assertSame('0', $this->highlight($this->answer($admin, 'tasks_workload'), 'Overdue tasks'));
        $this->assertNull($this->row($briefing, 'org-approvals'));
        $this->assertSame('0', $this->highlight($this->answer($admin, 'pending_approvals'), 'Pending approvals'));
    }

    // ask-08

    public function test_an_announcement_waiting_for_the_admin_is_reported_as_waiting_for_the_admin(): void
    {
        $org = $this->org();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $officer = User::factory()->officer()->create(['organization_id' => $org->id, 'first_name' => 'Rosa', 'last_name' => 'Lim']);
        $this->approval($org, $officer, 'ADMIN', 'announcement');

        $waiting = $this->answer($admin, 'my_submissions', 'Where is our announcement?');

        $this->assertStringContainsString('1 announcement from your officers is waiting for your approval', $waiting['answer']);
        $this->assertStringNotContainsString('the reviewer decides next', $waiting['answer']);
        $row = $this->rows($waiting)[0];
        $this->assertSame('Waiting for you', $row['status']);
        $this->assertSame('/dashboard/approvals', $row['href']);
        $this->assertSame('0', $this->highlight($waiting, 'Waiting for a reviewer'));
    }

    public function test_an_announcement_the_admin_returned_is_not_reported_back_to_the_admin(): void
    {
        $org = $this->org();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $officer = User::factory()->officer()->create(['organization_id' => $org->id, 'first_name' => 'Rosa', 'last_name' => 'Lim']);
        $this->approval($org, $officer, 'ADMIN', 'announcement', ['status' => 'rejected', 'remarks' => 'Fix the date', 'reviewed_at' => now()]);

        $returned = $this->answer($admin, 'my_submissions', 'Where is our announcement?');

        $this->assertStringNotContainsString('come back to you', $returned['answer']);
        $this->assertSame('0', $this->highlight($returned, 'Returned to you'));
        $row = $this->rows($returned)[0];
        $this->assertSame('You returned this', $row['status']);
        $this->assertStringContainsString('You returned this to Rosa Lim: Fix the date', $row['secondary']);
    }

    // ask-09

    private function openElection(Organization $org, array $overrides = []): Election
    {
        return Election::factory()->create([
            'organization_id' => $org->id, 'status' => 'active', 'phase' => 'voting', 'title' => 'Council Election',
            'approved_at' => now()->subDays(2), 'finalized_at' => now()->subDay(), 'cancelled_at' => null,
            'start_time' => now()->subHour(), 'end_time' => now()->addDay(), ...$overrides,
        ]);
    }

    private function onVoterRoll(User $student): void
    {
        AccountProfile::where('user_school_id', $student->school_id)->update(['created_at' => now()->subDays(5)]);
    }

    public function test_a_student_hears_whether_they_can_vote_have_voted_or_are_not_on_the_voter_list(): void
    {
        $org = $this->org();
        $listed = User::factory()->student()->create(['organization_id' => $org->id]);
        $voted = User::factory()->student()->create(['organization_id' => $org->id]);
        $this->onVoterRoll($listed);
        $this->onVoterRoll($voted);
        $unlisted = User::factory()->student()->create(['organization_id' => $org->id]);
        $election = $this->openElection($org);
        ElectionBallot::factory()->create(['election_id' => $election->id, 'voter_id' => $voted->school_id, 'round' => 1]);

        $can = $this->answer($listed, 'elections_status');
        $this->assertStringContainsString('You can vote in 1 election now; you have already voted in 0.', $can['answer']);
        $this->assertSame('You can vote now', $this->rows($can)[0]['status']);
        $this->assertSame('/dashboard/elections/cast-vote', $this->rows($can)[0]['href']);

        $done = $this->answer($voted, 'elections_status');
        $this->assertStringContainsString('You can vote in 0 elections now; you have already voted in 1.', $done['answer']);
        $this->assertSame('You have voted', $this->rows($done)[0]['status']);
        $this->assertNotSame('/dashboard/elections/cast-vote', $this->rows($done)[0]['href']);

        $not = $this->answer($unlisted, 'elections_status');
        $this->assertStringContainsString('You are not on the voter list for 1 election.', $not['answer']);
        $this->assertSame('You are not on the voter list', $this->rows($not)[0]['status']);
        $this->assertNotSame('/dashboard/elections/cast-vote', $this->rows($not)[0]['href']);
    }

    public function test_a_student_in_a_runoff_is_told_the_runoff_is_open(): void
    {
        $org = $this->org();
        $student = User::factory()->student()->create(['organization_id' => $org->id]);
        $this->onVoterRoll($student);
        $this->openElection($org, [
            'status' => 'completed', 'phase' => 'runoff', 'start_time' => now()->subDays(3), 'end_time' => now()->subDay(),
            'runoff_starts_at' => now()->subHour(), 'runoff_ends_at' => now()->addDay(),
        ]);

        $payload = $this->answer($student, 'elections_status');

        $this->assertStringContainsString('You can vote in 1 election now', $payload['answer']);
        $this->assertStringContainsString('Runoff closes', $this->rows($payload)[0]['secondary']);
    }

    // ask-10

    private function clearanceFor(User $student, Organization $org, array $statuses, array $remarks = []): void
    {
        $periodId = DB::table('clearance_periods')->insertGetId([
            'academic_year' => '2026-2027', 'title' => 'First Semester Clearance', 'required_roles' => json_encode(array_keys($statuses)),
            'created_by' => $this->sao()->school_id, 'created_at' => now(), 'updated_at' => now(),
        ]);
        foreach ($statuses as $role => $status) {
            DB::table('clearance_signatures')->insert([
                'clearance_period_id' => $periodId, 'student_id' => $student->school_id, 'organization_id' => $org->id,
                'required_role' => $role, 'status' => $status, 'remarks' => $remarks[$role] ?? null, 'created_at' => now(), 'updated_at' => now(),
            ]);
        }
    }

    public function test_the_clearance_answer_names_who_has_not_signed_and_shows_no_role_constants(): void
    {
        $college = $this->makeCollege('ENG');
        $home = $this->makeCollegeHome($college);
        $org = $this->makeCollegeStudentOrganization($college, ['name' => 'Circuit Society', 'lifecycle_status' => 'active', 'is_active' => true]);
        $student = User::factory()->student()->create(['organization_id' => $org->id]);
        $head = User::factory()->departmentHead()->create(['organization_id' => $home->id]);
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $sao = $this->sao();
        $this->clearanceFor($student, $org, ['organization' => 'signed', 'department_head' => 'signed', 'sao' => 'pending']);
        $this->clearanceFor(User::factory()->student()->create(['organization_id' => $org->id]), $org, ['department_head' => 'pending']);

        $mine = $this->answer($student, 'clearances_status');
        $this->assertSame('Your organization and the Department Head have signed. The SAO has not signed yet.', $mine['answer']);
        $this->assertSame(['Circuit Society', 'Department Head', 'SAO'], array_column($this->rows($mine), 'primary'));
        $this->assertSame('Waiting for the SAO', $this->rows($mine)[2]['status']);

        foreach ([$mine, $this->answer($head, 'clearances_status'), $this->answer($admin, 'clearances_status'), $this->answer($sao, 'clearances_status')] as $payload) {
            $this->assertDoesNotMatchRegularExpression('/DEPARTMENT_HEAD|ORGANIZATION|SUPER_ADMIN|SBO_OFFICER|Stage:/', json_encode($payload));
        }
        $this->assertSame('Waiting for your signature', $this->rows($this->answer($head, 'clearances_status'))[0]['secondary']);
    }

    public function test_a_held_clearance_says_who_holds_it_and_why(): void
    {
        $org = $this->org();
        $student = User::factory()->student()->create(['organization_id' => $org->id]);
        $this->clearanceFor($student, $org, ['organization' => 'signed', 'sao' => 'held'], ['sao' => 'Unpaid fine']);

        $payload = $this->answer($student, 'clearances_status');

        $this->assertStringContainsString('The SAO is holding your clearance: "Unpaid fine".', $payload['answer']);
        $this->assertSame('Held by the SAO', $this->rows($payload)[1]['status']);
    }

    // ask-12 and ask-13

    public function test_no_answer_for_any_role_carries_system_wording(): void
    {
        $org = $this->org();
        $author = User::factory()->admin()->create(['organization_id' => $org->id]);
        $this->approval($org, $author, 'SUPER_ADMIN');
        Budget::create(['organization_id' => $org->id, 'title' => 'Zorbfest', 'allocated_amount' => 5000, 'remaining_amount' => 4000, 'warning_threshold' => 100, 'submission_status' => 'approved']);
        $intents = ['daily_priorities', 'missing_submissions', 'submitted_documents', 'pending_approvals', 'organizations_without_admin', 'tasks_workload', 'finance_health',
            'merchandise_orders', 'events_attendance', 'clearances_status', 'elections_status', 'grievances_status', 'semantic_rag'];

        foreach ($this->everyRole() as $role => $user) {
            $overview = $this->app->make(AskAiService::class)->overview($user);
            $this->assertStringNotContainsString('Copilot', $overview['role_label']);
            foreach ($intents as $intent) {
                $payload = $this->answer($user, $intent, 'Zorbfest budget');
                $this->assertPlainWords($payload, "{$role} {$intent}");
            }
        }
    }

    public function test_the_record_search_answer_uses_real_plurals_and_no_percentages(): void
    {
        $org = $this->org(['name' => 'Zorbfest Society']);
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        Budget::create(['organization_id' => $org->id, 'title' => 'Zorbfest', 'allocated_amount' => 5000, 'remaining_amount' => 4000, 'warning_threshold' => 100, 'submission_status' => 'approved']);

        $payload = $this->answer($admin, 'semantic_rag', 'Zorbfest');

        $this->assertMatchesRegularExpression('/^Found \d+ records? out of \d+ checked\. The closest: /', $payload['answer']);
        $this->assertStringNotContainsString('%', $payload['answer']);
        $this->assertStringNotContainsString('best match', json_encode($payload['sections']));
    }

    public function test_a_waiting_approval_names_who_it_waits_for_in_words(): void
    {
        $org = $this->org();
        $author = User::factory()->admin()->create(['organization_id' => $org->id]);
        $sao = $this->sao();
        $this->approval($org, $author, 'SUPER_ADMIN');

        $this->assertSame('Waiting for the SAO', $this->rows($this->answer($sao, 'pending_approvals'))[0]['status']);
    }

    public function test_the_engine_label_of_a_guide_answer_and_the_role_labels_are_plain(): void
    {
        $admin = $this->everyRole()['ADMIN'];

        $guide = $this->answer($admin, 'how_to_guide', 'How do I create an event?');

        $this->assertSame('HIUSA guides', $guide['rag_metadata']['engine']);
    }

    public function test_a_student_is_told_about_events_as_a_student_and_offered_only_chips_that_open(): void
    {
        $users = $this->everyRole();
        $student = $users['STUDENT'];
        $org = Organization::find($student->organization_id);
        Event::factory()->create(['organization_id' => $org->id, 'status' => 'approved', 'start_time' => now()->addDay(), 'end_time' => now()->addDays(2)]);
        Event::factory()->create(['organization_id' => $org->id, 'status' => 'approved', 'start_time' => now()->subDays(3), 'end_time' => now()->subDays(2)]);

        $events = $this->answer($student, 'events_attendance');

        $this->assertSame('1 event is coming up for your organization.', $events['answer']);
        $this->assertNull($this->highlight($events, 'Needs closing'));
        $this->assertStringNotContainsString('marked completed', json_encode($events));

        $service = $this->app->make(AskAiService::class);
        foreach (['daily_priorities', 'finance_health', 'merchandise_orders', 'events_attendance', 'clearances_status', 'elections_status', 'semantic_rag', 'missing_submissions', 'pending_approvals'] as $intent) {
            foreach ($this->answer($student, $intent, 'What events can I join?')['follow_ups'] as $followUp) {
                $this->assertTrue($service->canAsk($student, $followUp['topic']), "{$intent} offers {$followUp['topic']}");
            }
        }
    }

    // ask-14

    public function test_the_officer_briefing_says_the_organization_head_uploads_compliance_files(): void
    {
        $this->semester();
        $sao = $this->sao();
        $org = $this->org();
        $officer = User::factory()->officer()->create(['organization_id' => $org->id]);
        ComplianceRequirementType::create(['academic_year' => '2026-2027', 'category' => 'organization', 'name' => 'Constitution', 'deadline_at' => now()->addMonth(), 'is_active' => true, 'created_by' => $sao->school_id]);

        $briefing = $this->briefing($officer);
        $row = $this->row($briefing, 'org-missing-compliance');

        $this->assertSame('Your organization still owes compliance files', $row['primary']);
        $this->assertSame('Waiting for the organization head', $row['status']);
        $this->assertStringContainsString('Your organization head uploads these.', $row['secondary']);
        $this->assertArrayNotHasKey('action_label', $row);
        $this->assertStringNotContainsString('you have 1 missing', $briefing['answer']);
        $this->assertStringContainsString('Your organization head still has 1 compliance requirement to upload.', $briefing['answer']);

        $missing = $this->answer($officer, 'missing_submissions', "What haven't we submitted?");
        $this->assertStringContainsString('Your organization head uploads the compliance files.', $missing['answer']);
        foreach ($this->rows($missing) as $missingRow) {
            if (($missingRow['href'] ?? null) === null) {
                $this->assertArrayNotHasKey('action_label', $missingRow);
            }
        }
    }

    // ask-15

    public function test_an_archived_organization_stays_out_of_the_sao_and_dean_answers(): void
    {
        $this->semester();
        $college = $this->makeCollege('ENG');
        $home = $this->makeCollegeHome($college);
        $active = $this->makeCollegeStudentOrganization($college, ['name' => 'Live Society', 'lifecycle_status' => 'active', 'is_active' => true]);
        $archived = $this->makeCollegeStudentOrganization($college, ['name' => 'Gone Society', 'lifecycle_status' => 'archived', 'is_active' => false]);
        $head = User::factory()->departmentHead()->create(['organization_id' => $home->id]);
        $sao = $this->sao();
        $author = User::factory()->admin()->create(['organization_id' => $archived->id]);
        Budget::create(['organization_id' => $archived->id, 'title' => 'Ghost Budget', 'allocated_amount' => 9000, 'remaining_amount' => 9000, 'warning_threshold' => 100, 'submission_status' => 'approved']);
        Event::factory()->create(['organization_id' => $archived->id, 'created_by' => $author->school_id, 'title' => 'Ghost Gala', 'status' => 'approved', 'start_time' => now()->addWeek(), 'end_time' => now()->addWeek()->addHours(2)]);
        $type = ComplianceRequirementType::create(['academic_year' => '2026-2027', 'category' => 'organization', 'name' => 'Constitution', 'deadline_at' => now()->addMonth(), 'is_active' => true, 'created_by' => $sao->school_id]);
        OrganizationComplianceSubmission::create(['organization_id' => $archived->id, 'requirement_type_id' => $type->id, 'status' => 'submitted', 'file_path' => 'x.pdf', 'file_original_name' => 'x.pdf', 'mime_type' => 'application/pdf', 'file_size' => 1, 'submitted_by' => $author->school_id, 'submitted_at' => now()]);

        foreach ([$sao, $head] as $asker) {
            $this->assertStringNotContainsString('Ghost Budget', json_encode($this->answer($asker, 'finance_health')));
            $this->assertStringNotContainsString('Ghost Gala', json_encode($this->answer($asker, 'events_attendance')));
            $this->assertStringNotContainsString('Gone Society', json_encode($this->answer($asker, 'submitted_documents')));
        }
        $this->assertSame('0', $this->highlight($this->briefing($sao), 'Compliance to review'));
        $this->assertStringContainsString('1 active student organization', $this->briefing($head)['answer']);
    }

    // ask-16

    public function test_the_deans_office_staff_are_given_only_links_their_profile_can_open(): void
    {
        $college = $this->makeCollege('ENG');
        $home = $this->makeCollegeHome($college);
        $org = $this->makeCollegeStudentOrganization($college, ['lifecycle_status' => 'active', 'is_active' => true]);
        $staff = User::factory()->admin()->create(['organization_id' => $home->id]);
        $this->assertTrue($staff->isCollegeOfficeStaff());
        $sao = $this->sao();
        $type = ComplianceRequirementType::create(['academic_year' => '2026-2027', 'category' => 'organization', 'name' => 'Constitution', 'deadline_at' => now()->addMonth(), 'is_active' => true, 'created_by' => $sao->school_id]);
        OrganizationComplianceSubmission::create(['organization_id' => $org->id, 'requirement_type_id' => $type->id, 'status' => 'submitted', 'file_path' => 'x.pdf', 'file_original_name' => 'x.pdf', 'mime_type' => 'application/pdf', 'file_size' => 1, 'submitted_by' => $staff->school_id, 'submitted_at' => now()]);

        $access = $this->app->make(ClientRouteAccess::class);
        $hrefs = [];
        foreach (['Constitution compliance requirements', 'compliance files submitted', 'announcements events budgets'] as $question) {
            Sanctum::actingAs($staff);
            $payload = $this->postJson('/api/ai/assistant/ask', ['question' => $question, 'topic' => 'semantic_rag'])->assertOk()->json();
            $hrefs = [...$hrefs, ...array_filter(array_column($this->rows($payload), 'href'))];
        }
        $this->assertNotEmpty($hrefs);
        foreach ($hrefs as $href) {
            $this->assertNotNull($access->hrefFor('ADMIN', $href), "{$href} is refused for the Admin profile");
        }
        $this->assertNotContains('/dashboard/department-head/compliance', $hrefs);
    }

    public function test_a_guide_step_on_a_page_office_staff_cannot_open_names_the_page_they_can(): void
    {
        $library = $this->app->make(HowToGuideLibrary::class);
        $step = ['title' => 'Open College compliance', 'path' => '/dashboard/department-head/compliance'];

        $this->assertSame(['/dashboard/department-head/compliance', '/dashboard/department-head/documents'], $library->stepPaths($step, 'DEPARTMENT_HEAD'));
        $this->assertSame(['/dashboard/department-head/compliance'], $library->stepPaths($step, 'ADMIN'));
        $this->assertSame([], $library->stepPaths(['title' => 'No page'], 'ADMIN'));
    }

    // ask-17

    public function test_a_word_that_is_only_somebodys_first_name_does_not_add_related_records(): void
    {
        $sao = $this->sao();
        $org = $this->org(['name' => 'Harbor Society']);
        User::factory()->officer()->create(['organization_id' => $org->id, 'first_name' => 'Organization', 'last_name' => 'Adviser', 'position_title' => 'President']);

        $payload = $this->answer($sao, 'pending_approvals', 'Which organization applications are waiting for my approval?');
        $this->assertNull(collect($payload['sections'])->firstWhere('id', 'rag-augmented-context'));

        $named = $this->answer($sao, 'semantic_rag', 'Is Organization Adviser the president?');
        $this->assertContains('Organization Adviser', $named['rag_metadata']['matched_entities']);

        $first = $this->answer($sao, 'semantic_rag', 'Which organization has a president?');
        $this->assertNotContains('Organization', $first['rag_metadata']['matched_entities']);
        $this->assertNotContains('President', $first['rag_metadata']['matched_entities']);
    }
}
