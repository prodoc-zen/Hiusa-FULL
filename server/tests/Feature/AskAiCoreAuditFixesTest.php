<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\AiOutput;
use App\Models\ApprovalRequest;
use App\Models\ComplianceRequirementType;
use App\Models\Election;
use App\Models\ElectionBallot;
use App\Models\FinancialReport;
use App\Models\Merchandise;
use App\Models\Order;
use App\Models\Organization;
use App\Models\Task;
use App\Models\User;
use App\Services\Ai\AskAiRoleIntents;
use App\Services\Ai\AskAiService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

class AskAiCoreAuditFixesTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['performance.api_cache.enabled' => false, 'services.groq.key' => '', 'services.anthropic.key' => '']);
    }

    private function service(): AskAiService
    {
        return $this->app->make(AskAiService::class);
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

    private function briefing(User $user): array
    {
        return $this->service()->deterministicAnswer($user, 'What should I do today?', 'daily_priorities');
    }

    private function rows(array $payload): array
    {
        return collect($payload['sections'])->pluck('rows')->flatten(1)->all();
    }

    private function storeRow(User $asker, string $role, ?int $organizationId, string $question, array $input = []): AiOutput
    {
        return AiOutput::create([
            'organization_id' => $organizationId,
            'feature_type' => 'ASK_AI_ASSISTANT',
            'reference_type' => User::class,
            'reference_id' => $asker->school_id,
            'prompt_text' => $question,
            'output_text' => 'Stored answer for '.$role,
            'context_version' => 'ask-ai-rag-v2',
            'structured_input' => ['question' => $question, 'role' => $role, ...$input],
            'structured_output' => ['title' => 'Stored', 'highlights' => [], 'section_count' => 0],
            'status' => 'completed',
            'decision_status' => 'accepted',
            'requested_by' => $asker->school_id,
            'decided_by' => $asker->school_id,
            'decided_at' => now(),
            'created_at' => now(),
        ]);
    }

    public function test_recent_questions_stay_with_the_profile_that_asked_them_and_carry_their_topic(): void
    {
        $studentOrg = $this->org();
        $officerOrg = $this->org();
        $user = User::factory()->student()->create(['organization_id' => $studentOrg->id]);
        $officerProfile = $user->accountProfiles()->create(['organization_id' => $officerOrg->id, 'role' => 'SBO_OFFICER', 'account_status' => 'active']);

        $asStudent = $this->storeRow($user, 'STUDENT', $studentOrg->id, 'Who hasn\'t signed my clearance yet, and why?', ['topic' => 'clearances_status', 'intent' => 'clearances_status']);
        $fromChat = $this->storeRow($user, 'STUDENT', $studentOrg->id, 'Where do my membership fees go?', ['intent' => 'fee_usage']);
        $asOfficer = $this->storeRow($user, 'SBO_OFFICER', $officerOrg->id, 'Which orders need payment checking?', ['topic' => 'merchandise_orders']);
        $otherOrgSameRole = $this->storeRow($user, 'STUDENT', $officerOrg->id, 'Older question from another organization');

        $user->activateProfile($user->accountProfiles()->where('organization_id', $studentOrg->id)->firstOrFail());
        $student = collect($this->service()->overview($user)['recent_queries']);
        $this->assertEqualsCanonicalizing([$asStudent->id, $fromChat->id], $student->pluck('id')->all());
        $this->assertSame('clearances_status', $student->firstWhere('id', $asStudent->id)['topic']);
        $this->assertSame('fee_usage', $student->firstWhere('id', $fromChat->id)['topic']);

        $user->activateProfile($officerProfile);
        $officer = collect($this->service()->overview($user)['recent_queries']);
        $this->assertSame([$asOfficer->id], $officer->pluck('id')->all());
        $this->assertSame('merchandise_orders', $officer[0]['topic']);
        $this->assertNotContains($otherOrgSameRole->id, $officer->pluck('id')->all());
    }

    public function test_every_suggested_question_and_briefing_follow_up_routes_to_its_own_topic_without_the_topic(): void
    {
        $service = $this->service();
        foreach (['SUPER_ADMIN', 'DEPARTMENT_HEAD', 'ADMIN', 'SBO_OFFICER', 'STUDENT'] as $role) {
            foreach ($service->suggestedQuestions($role) as $prompt) {
                $this->assertSame($prompt['topic'], $service->classifyIntent($prompt['question'], null, $role), "{$role}: {$prompt['question']}");
            }
        }

        $college = $this->makeCollege('CAS');
        $this->makeCollegeHome($college);
        $org = $this->makeCollegeStudentOrganization($college);
        $users = [
            'SUPER_ADMIN' => User::factory()->superAdmin()->create(['organization_id' => $this->org(['organization_type' => 'SYSTEM_ADMINISTRATION'])->id]),
            'DEPARTMENT_HEAD' => $this->makeCollegeHead($college),
            'ADMIN' => User::factory()->admin()->create(['organization_id' => $org->id]),
            'SBO_OFFICER' => User::factory()->officer()->create(['organization_id' => $org->id]),
            'STUDENT' => User::factory()->student()->create(['organization_id' => $org->id]),
        ];
        foreach ($users as $role => $user) {
            foreach ($this->briefing($user)['follow_ups'] as $followUp) {
                $this->assertSame($followUp['topic'], $service->classifyIntent($followUp['question'], null, $role), "{$role}: {$followUp['question']}");
            }
        }
    }

    public function test_plain_questions_reach_the_intent_a_person_means(): void
    {
        $service = $this->service();
        $cases = [
            ['How much is left in our budget?', 'ADMIN', 'finance_health'],
            ['How much is my unpaid fee?', 'STUDENT', 'finance_health'],
            ['What is my balance?', 'STUDENT', 'finance_health'],
            ['Where is my receipt for the fee?', 'STUDENT', 'finance_health'],
            ['Which orgs are missing an administrator?', 'SUPER_ADMIN', 'organizations_without_admin'],
            ['Which organizations have no head yet?', 'DEPARTMENT_HEAD', 'organizations_without_admin'],
            ['How many students are allowed to vote?', 'ADMIN', 'elections_status'],
            ['In order to vote, what do I need?', 'STUDENT', 'elections_status'],
            ['Is my order ready to claim?', 'STUDENT', 'merchandise_orders'],
            ['Which event requests are waiting for approval?', 'DEPARTMENT_HEAD', 'pending_approvals'],
            ['Which venue bookings are pending?', 'SUPER_ADMIN', 'pending_approvals'],
            ['What is the deadline for our requirements?', 'ADMIN', 'missing_submissions'],
            ['What compliance files are we lacking?', 'ADMIN', 'missing_submissions'],
            ['Which clearance signatures am I missing?', 'STUDENT', 'clearances_status'],
            ['Why is my clearance incomplete?', 'STUDENT', 'clearances_status'],
            ['What tasks are assigned to me?', 'SBO_OFFICER', 'tasks_workload'],
            ['Is the coffee fund allowed?', 'ADMIN', 'semantic_rag'],
            ['What does the feedback form say?', 'ADMIN', 'semantic_rag'],
            ['What is on my plate today?', 'ADMIN', 'daily_priorities'],
            ['Which organizations haven\'t submitted compliance or financial reports?', 'SUPER_ADMIN', 'missing_submissions'],
            ['Who has submitted compliance documents or reports for review?', 'SUPER_ADMIN', 'submitted_documents'],
            ['Are there urgent grievances?', 'SUPER_ADMIN', 'grievances_status'],
            ['Are there urgent grievances?', 'ADMIN', 'semantic_rag'],
            ['How do I endorse an application?', 'DEPARTMENT_HEAD', 'how_to_guide'],
            ['Which applications need my endorsement?', 'DEPARTMENT_HEAD', 'applications_queue'],
            ['Where is my event proposal?', 'ADMIN', 'my_submissions'],
            ['What does task delegation do?', 'ADMIN', 'ai_tools'],
            ['Where do my membership fees go?', 'STUDENT', 'fee_usage'],
        ];

        foreach ($cases as [$question, $role, $expected]) {
            $this->assertSame($expected, $service->classifyIntent($question, null, $role), "{$role}: {$question}");
        }

        foreach (AskAiRoleIntents::INTENTS as $intent) {
            $this->assertSame($intent, $service->classifyIntent('anything at all', $intent, 'STUDENT'));
        }
    }

    public function test_the_new_intents_answer_for_their_roles_and_are_refused_for_the_others(): void
    {
        $sao = User::factory()->superAdmin()->create(['organization_id' => $this->org(['organization_type' => 'SYSTEM_ADMINISTRATION'])->id]);
        $org = $this->org();
        $student = User::factory()->student()->create(['organization_id' => $org->id]);

        Sanctum::actingAs($sao);
        $res = $this->postJson('/api/ai/assistant/ask', ['question' => 'Which organization applications are waiting for my approval?'])->assertOk();
        $res->assertJsonPath('intent', 'applications_queue');
        $this->assertNotSame('Not available for your access', $res->json('title'));

        Sanctum::actingAs($student);
        $this->postJson('/api/ai/assistant/ask', ['question' => 'Where do my membership fees go?'])
            ->assertOk()->assertJsonPath('intent', 'fee_usage');

        $refused = $this->postJson('/api/ai/assistant/ask', ['question' => 'Which applications are waiting?', 'topic' => 'applications_queue'])->assertOk();
        $refused->assertJsonPath('title', 'Not available for your access');
        $this->assertStringNotContainsString('organization head', $refused->json('answer'));
    }

    public function test_a_student_asking_for_staff_only_answers_is_pointed_to_what_a_student_can_do(): void
    {
        $org = $this->org();
        $student = User::factory()->student()->create(['organization_id' => $org->id]);
        Sanctum::actingAs($student);

        foreach (['What tasks are assigned to me?' => 'tasks_workload', 'Has my organization application been approved?' => 'pending_approvals', 'What have we submitted?' => 'submitted_documents'] as $question => $intent) {
            $res = $this->postJson('/api/ai/assistant/ask', ['question' => $question])->assertOk();
            $res->assertJsonPath('intent', $intent);
            $res->assertJsonPath('title', 'Not available for your access');
            $this->assertStringNotContainsString('organization head', $res->json('answer'));
            $this->assertStringNotContainsString('add it to your access', $res->json('answer'));
            $this->assertStringContainsString('student account', $res->json('answer'));
            $this->assertNotEmpty($res->json('follow_ups'));
            foreach ($res->json('follow_ups') as $followUp) {
                $this->assertTrue($this->service()->canAsk($student, $followUp['topic']));
            }
        }
    }

    public function test_starter_prompts_are_six_the_role_may_ask_and_the_student_set_swaps_events_for_fees(): void
    {
        $org = $this->org();
        $student = User::factory()->student()->create(['organization_id' => $org->id]);
        Sanctum::actingAs($student);
        $prompts = collect($this->getJson('/api/ai/assistant')->assertOk()->json('starter_prompts'));
        $this->assertCount(6, $prompts);
        $this->assertContains('fee_usage', $prompts->pluck('topic')->all());
        $this->assertNotContains('events_attendance', $prompts->pluck('topic')->all());
        $this->assertSame('Where do my membership fees go?', $prompts->firstWhere('topic', 'fee_usage')['question']);

        $service = $this->service();
        $college = $this->makeCollege('CBA');
        $this->makeCollegeHome($college);
        $collegeOrg = $this->makeCollegeStudentOrganization($college);
        $limited = User::factory()->officer()->create(['organization_id' => $collegeOrg->id]);
        $limited->accountProfiles()->update(['modules' => ['tasks']]);
        $limited->activateProfile($limited->accountProfiles()->firstOrFail());
        $users = [
            User::factory()->superAdmin()->create(['organization_id' => $this->org(['organization_type' => 'SYSTEM_ADMINISTRATION'])->id]),
            $this->makeCollegeHead($college),
            User::factory()->admin()->create(['organization_id' => $collegeOrg->id]),
            User::factory()->officer()->create(['organization_id' => $collegeOrg->id]),
            $limited,
            $student,
        ];
        foreach ($users as $user) {
            $topics = array_column($service->starterPrompts($user), 'topic');
            $this->assertLessThanOrEqual(6, count($topics));
            $this->assertNotEmpty($topics);
            foreach ($topics as $topic) {
                $this->assertTrue($service->canAsk($user, $topic), "{$user->role}: {$topic}");
            }
        }

        $limitedTopics = array_column($service->starterPrompts($limited), 'topic');
        $this->assertContains('tasks_workload', $limitedTopics);
        $this->assertNotContains('finance_health', $limitedTopics);
        $this->assertNotContains('merchandise_orders', $limitedTopics);
        $this->assertNotContains('events_attendance', $limitedTopics);
    }

    public function test_the_capabilities_answer_lists_the_new_intents_for_the_roles_that_have_them(): void
    {
        $org = $this->org();
        $service = $this->service();
        $expect = [
            [User::factory()->superAdmin()->create(['organization_id' => $this->org(['organization_type' => 'SYSTEM_ADMINISTRATION'])->id]), ['Applications to approve'], ['Where my fees go', 'The AI tools']],
            [User::factory()->admin()->create(['organization_id' => $org->id]), ['Where our submissions stand', 'The AI tools'], ['Where my fees go', 'Applications to approve']],
            [User::factory()->officer()->create(['organization_id' => $org->id]), ['The AI tools'], ['Where my fees go', 'Where our submissions stand']],
            [User::factory()->student()->create(['organization_id' => $org->id]), ['Where my fees go'], ['The AI tools', 'Applications to approve']],
        ];

        foreach ($expect as [$user, $present, $absent]) {
            $answer = $service->capabilitiesAnswer($user)['answer'];
            foreach ($present as $label) {
                $this->assertStringContainsString($label, $answer, "{$user->role} should list {$label}");
            }
            foreach ($absent as $label) {
                $this->assertStringNotContainsString($label, $answer, "{$user->role} should not list {$label}");
            }
        }
    }

    public function test_a_student_with_only_a_reserved_order_is_not_told_they_are_all_caught_up(): void
    {
        $org = $this->org();
        $student = User::factory()->student()->create(['organization_id' => $org->id]);
        $item = Merchandise::factory()->create(['organization_id' => $org->id]);
        Order::factory()->create([
            'organization_id' => $org->id, 'student_id' => $student->school_id, 'merchandise_id' => $item->id,
            'status' => 'pending', 'payment_method' => 'cash_on_claim', 'total_price' => 250, 'payment_proof_url' => null,
            'processed_by' => null, 'approved_by' => null, 'claimed_at' => null,
        ]);

        $payload = $this->briefing($student);
        $rows = collect($this->rows($payload));
        $this->assertStringNotContainsString('caught up', $payload['answer']);
        $this->assertStringContainsString('1 unpaid reserved order (₱250.00)', $payload['answer']);
        $this->assertNotContains('stu-fees', $rows->pluck('id')->all());
        $reserved = $rows->firstWhere('id', 'stu-reserved-orders');
        $this->assertSame('/dashboard/merchandise/my-orders', $reserved['href']);
        $this->assertSame('₱250.00', collect($payload['highlights'])->firstWhere('label', 'Account balance')['value']);

        Order::query()->delete();
        $this->assertStringContainsString('caught up', $this->briefing($student)['answer']);
    }

    private function election(Organization $org, array $overrides = []): Election
    {
        return Election::factory()->create([
            'organization_id' => $org->id, 'title' => 'Election', 'status' => 'active',
            'approved_at' => now()->subDays(2), 'finalized_at' => now(), 'start_time' => now()->subDay(), 'end_time' => now()->addDays(2),
            ...$overrides,
        ]);
    }

    public function test_the_student_ballot_check_counts_every_open_election_and_ignores_closed_windows_and_voted_ones(): void
    {
        $org = $this->org();
        $student = User::factory()->student()->create(['organization_id' => $org->id]);

        $voted = $this->election($org, ['title' => 'Already voted', 'end_time' => now()->addHours(5)]);
        ElectionBallot::factory()->create(['election_id' => $voted->id, 'voter_id' => $student->school_id, 'round' => 1]);
        $this->assertStringContainsString('caught up', $this->briefing($student)['answer']);

        $this->election($org, ['title' => 'Not started yet', 'start_time' => now()->addDay(), 'end_time' => now()->addDays(3)]);
        $this->election($org, ['title' => 'Window over', 'start_time' => now()->subDays(3), 'end_time' => now()->subDay()]);
        $this->assertStringContainsString('caught up', $this->briefing($student)['answer']);

        $this->election($org, ['title' => 'Closes second', 'end_time' => now()->addDays(4)]);
        $this->election($org, ['title' => 'Closes first', 'end_time' => now()->addDay()]);
        $payload = $this->briefing($student);
        $vote = collect($this->rows($payload))->firstWhere('id', 'stu-vote');
        $this->assertSame('Cast your ballots in 2 open elections', $vote['primary']);
        $this->assertStringContainsString('Closes first closes first', $vote['secondary']);
        $this->assertStringContainsString('2 open ballots waiting for your vote', $payload['answer']);
        $this->assertSame('2 open', collect($payload['highlights'])->firstWhere('label', 'Open ballot')['value']);
    }

    public function test_the_student_ballot_check_follows_a_college_profile_and_the_runoff_round(): void
    {
        $college = $this->makeCollege('COE');
        $home = $this->makeCollegeHome($college);
        $club = $this->makeCollegeStudentOrganization($college, ['lifecycle_status' => 'active']);
        $student = User::factory()->student()->create(['organization_id' => $home->id]);
        $student->accountProfiles()->create(['organization_id' => $club->id, 'role' => 'STUDENT', 'account_status' => 'active']);

        $this->election($club, ['title' => 'Club election']);
        $this->assertSame('Cast your ballot in Club election', collect($this->rows($this->briefing($student)))->firstWhere('id', 'stu-vote')['primary']);

        $runoff = $this->election($club, [
            'title' => 'Runoff', 'status' => 'closed', 'phase' => 'runoff', 'start_time' => now()->subDays(5), 'end_time' => now()->subDays(4),
            'runoff_starts_at' => now()->subHour(), 'runoff_ends_at' => now()->addHours(3),
        ]);
        ElectionBallot::factory()->create(['election_id' => $runoff->id, 'voter_id' => $student->school_id, 'round' => 1]);
        $vote = collect($this->rows($this->briefing($student)))->firstWhere('id', 'stu-vote');
        $this->assertSame('Cast your ballots in 2 open elections', $vote['primary']);
        $this->assertStringStartsWith('Runoff closes first', $vote['secondary']);
    }

    public function test_the_department_head_briefing_counts_a_submitted_financial_report_once_and_only_active_organizations(): void
    {
        $college = $this->makeCollege('CIT');
        $this->makeCollegeHome($college);
        $active = $this->makeCollegeStudentOrganization($college, ['lifecycle_status' => 'active']);
        $this->makeCollegeStudentOrganization($college, ['lifecycle_status' => 'archived', 'is_active' => false]);
        $head = $this->makeCollegeHead($college);
        $author = User::factory()->admin()->create(['organization_id' => $active->id]);

        $report = FinancialReport::create([
            'organization_id' => $active->id, 'report_type' => 'monthly', 'title' => 'Monthly report',
            'source_transaction_ids' => [], 'signatories' => [], 'submission_status' => 'pending_department_head',
            'generated_by' => $author->school_id, 'generated_at' => now(), 'submitted_at' => now(),
        ]);
        ApprovalRequest::create([
            'organization_id' => $active->id, 'entity_type' => 'financial_report', 'entity_id' => $report->id,
            'requested_by' => $author->school_id, 'required_role' => 'DEPARTMENT_HEAD', 'status' => 'pending', 'requested_at' => now(),
        ]);

        $payload = $this->briefing($head);
        $rows = collect($this->rows($payload));
        $this->assertSame(['dh-reports'], $rows->pluck('id')->all());
        $this->assertSame('Waiting for the Department Head', $rows[0]['status']);
        $this->assertSame('/dashboard/department-head/approvals', $rows[0]['href']);
        $this->assertSame('1', collect($payload['highlights'])->firstWhere('label', 'College organizations')['value']);
        $this->assertSame('1', collect($payload['highlights'])->firstWhere('label', 'Pending approvals')['value']);
        $this->assertStringContainsString('1 financial report waiting for your review', $payload['answer']);
        $this->assertStringNotContainsString('clear', $payload['answer']);
    }

    public function test_the_sao_briefing_splits_approvals_by_the_tab_that_holds_them_and_skips_archived_organizations(): void
    {
        $sao = User::factory()->superAdmin()->create(['organization_id' => $this->org(['organization_type' => 'SYSTEM_ADMINISTRATION'])->id]);
        $active = $this->org();
        $archived = $this->org(['lifecycle_status' => 'archived', 'is_active' => false]);
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'status' => 'active']);
        ComplianceRequirementType::create(['academic_year' => '2026-2027', 'category' => 'organization', 'name' => 'Constitution', 'deadline_at' => now()->addMonth(), 'is_active' => true, 'created_by' => $sao->school_id]);
        $author = User::factory()->admin()->create(['organization_id' => $active->id]);
        config(['approvals.budget_final' => 'SUPER_ADMIN']);
        foreach ([['event', 1], ['event', 2], ['financial_report', 3], ['budget', 4]] as [$type, $id]) {
            ApprovalRequest::create([
                'organization_id' => $active->id, 'entity_type' => $type, 'entity_id' => $id,
                'requested_by' => $author->school_id, 'required_role' => 'SUPER_ADMIN', 'status' => 'pending', 'requested_at' => now(),
            ]);
        }

        $payload = $this->briefing($sao);
        $rows = collect($this->rows($payload))->keyBy('id');
        $this->assertSame('/dashboard/super-admin/compliance?tab=event-reviews', $rows['prio-event-approvals']['href']);
        $this->assertSame('/dashboard/super-admin/compliance?tab=financial', $rows['prio-report-approvals']['href']);
        $this->assertSame('/dashboard/super-admin/organization-approvals', $rows['prio-other-approvals']['href']);
        $this->assertSame('2 event proposals are waiting for your final decision.', $rows['prio-event-approvals']['secondary']);
        $this->assertSame('Waiting for SAO', $rows['prio-event-approvals']['status']);
        $this->assertStringContainsString('4 final approval requests', $payload['answer']);
        $this->assertSame('1', collect($payload['highlights'])->firstWhere('label', 'Incomplete orgs')['value']);
    }

    public function test_briefing_answers_use_real_singular_and_plural_words(): void
    {
        $org = $this->org();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $student = User::factory()->student()->create(['organization_id' => $org->id]);
        Task::factory()->create(['organization_id' => $org->id, 'assigned_to' => $admin->school_id, 'created_by' => $admin->school_id, 'status' => 'overdue', 'deadline' => now()->subDay()]);

        $one = $this->briefing($admin);
        $this->assertStringContainsString('1 overdue task', $one['answer']);
        $this->assertStringNotContainsString('1 overdue tasks', $one['answer']);
        $this->assertSame('1 task is past its deadline and needs an update.', collect($this->rows($one))->firstWhere('id', 'org-overdue-tasks')['secondary']);

        Task::factory()->create(['organization_id' => $org->id, 'assigned_to' => $admin->school_id, 'created_by' => $admin->school_id, 'status' => 'overdue', 'deadline' => now()->subDays(2)]);
        $two = $this->briefing($admin);
        $this->assertStringContainsString('2 overdue tasks', $two['answer']);
        $this->assertSame('2 tasks are past their deadline and need an update.', collect($this->rows($two))->firstWhere('id', 'org-overdue-tasks')['secondary']);

        $sao = User::factory()->superAdmin()->create(['organization_id' => $this->org(['organization_type' => 'SYSTEM_ADMINISTRATION'])->id]);
        $college = $this->makeCollege('CTE');
        $this->makeCollegeHome($college);
        $head = $this->makeCollegeHead($college);
        foreach ([$sao, $head, $admin, User::factory()->officer()->create(['organization_id' => $org->id]), $student] as $user) {
            $payload = $this->briefing($user);
            $text = $payload['answer'].json_encode($payload['sections']);
            $this->assertStringNotContainsString('(s)', $text, $user->role);
            $this->assertStringNotContainsString('Live operational queues', $text, $user->role);
            $this->assertStringNotContainsString('Prioritized', $text, $user->role);
        }

        $howTo = $this->service()->deterministicAnswer($admin, 'How do I create an event?', 'how_to_guide');
        $this->assertStringNotContainsString('(s)', $howTo['answer'].json_encode($howTo['sections']));
        $this->assertMatchesRegularExpression('/There are \d+ steps/', $howTo['answer']);
    }

    public function test_an_officer_limited_to_other_areas_still_reads_their_own_tasks_and_nobody_elses(): void
    {
        $org = $this->org();
        $officer = User::factory()->officer()->create(['organization_id' => $org->id]);
        $officer->accountProfiles()->update(['modules' => ['events']]);
        $other = User::factory()->officer()->create(['organization_id' => $org->id]);
        Task::factory()->create(['organization_id' => $org->id, 'title' => 'Mine to finish', 'assigned_to' => $officer->school_id, 'created_by' => $officer->school_id, 'status' => 'pending', 'deadline' => now()->addDay()]);
        Task::factory()->create(['organization_id' => $org->id, 'title' => 'Someone elses job', 'assigned_to' => $other->school_id, 'created_by' => $officer->school_id, 'status' => 'overdue', 'deadline' => now()->subDay()]);

        Sanctum::actingAs($officer);
        $res = $this->postJson('/api/ai/assistant/ask', ['question' => 'What tasks are assigned to me?'])->assertOk();
        $res->assertJsonPath('intent', 'tasks_workload');
        $res->assertJsonPath('title', 'Tasks & Officer Workload');
        $payload = json_encode($res->json());
        $this->assertStringContainsString('Mine to finish', $payload);
        $this->assertStringNotContainsString('Someone elses job', $payload);

        $this->assertSame('1', collect($this->briefing($officer)['highlights'])->firstWhere('label', 'Active tasks')['value']);
    }

    public function test_the_overview_builds_the_briefing_without_writing_an_audit_row(): void
    {
        $org = $this->org();
        Sanctum::actingAs(User::factory()->admin()->create(['organization_id' => $org->id]));

        $this->getJson('/api/ai/assistant')->assertOk()
            ->assertJsonStructure(['daily_briefing' => ['title', 'summary', 'highlights', 'sections'], 'starter_prompts', 'recent_queries']);
        $this->assertSame(0, DB::table('ai_outputs')->count());
    }
}
