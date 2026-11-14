<?php

namespace Tests\Feature;

use App\Contracts\TextGenerator;
use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\College;
use App\Models\Organization;
use App\Models\OrganizationApplicantGrant;
use App\Models\OrganizationApplication;
use App\Models\User;
use App\Services\Ai\AskAiService;
use App\Services\Ai\HowToGuideLibrary;
use App\Services\Dashboard\ClientRouteAccess;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\RateLimiter;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\Support\AskAiChatFakeGenerator;
use Tests\TestCase;

class AskAiActionRequestsTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['performance.api_cache.enabled' => false, 'services.groq.key' => '', 'services.anthropic.key' => '']);
        RateLimiter::for('ai-generation', fn () => Limit::none());
    }

    private function sao(): User
    {
        $home = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);

        return User::factory()->superAdmin()->create(['organization_id' => $home->id]);
    }

    private function dean(?College $college = null): User
    {
        return $this->makeCollegeHead($college ?? $this->makeCollege('CCS'));
    }

    private function organization(): Organization
    {
        return Organization::factory()->create(['organization_type' => 'STUDENT_ORGANIZATION', 'lifecycle_status' => 'active', 'is_active' => true]);
    }

    private function userFor(string $role): User
    {
        return match ($role) {
            'SUPER_ADMIN' => $this->sao(),
            'DEPARTMENT_HEAD' => $this->dean(),
            'ADMIN' => User::factory()->admin()->create(['organization_id' => $this->organization()->id]),
            'SBO_OFFICER' => User::factory()->officer()->create(['organization_id' => $this->organization()->id]),
            'STUDENT' => User::factory()->student()->create(['organization_id' => $this->organization()->id]),
        };
    }

    private function activeSemester(): void
    {
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'status' => 'active']);
    }

    private function ask(User $user, string $question): array
    {
        Sanctum::actingAs($user);

        return $this->postJson('/api/ai/assistant/ask', ['question' => $question])->assertOk()->json();
    }

    private function guideTitle(string $id): string
    {
        foreach (app(HowToGuideLibrary::class)->all() as $guide) {
            if ($guide['id'] === $id) {
                return $guide['title'];
            }
        }

        $this->fail("No guide {$id}.");
    }

    private function firstRow(array $answer): array
    {
        return $answer['sections'][0]['rows'][0];
    }

    private function assertButtonOpensForRole(array $answer, string $role, string $context): void
    {
        $href = $this->firstRow($answer)['href'] ?? null;
        $this->assertNotNull($href, "{$context}: the first row has no button");
        $this->assertNotNull(app(ClientRouteAccess::class)->hrefFor($role, $href), "{$context}: {$href} is not a page {$role} can open");
    }

    private function assertNoDeadLinks(array $answer, string $role, string $context): void
    {
        foreach ($answer['sections'] as $section) {
            foreach ($section['rows'] as $row) {
                if (! empty($row['href'])) {
                    $this->assertNotNull(app(ClientRouteAccess::class)->hrefFor($role, $row['href']), "{$context}: {$row['href']} is not a page {$role} can open");
                }
            }
        }
    }

    /** @return array<string, array<int, array{0: string, 1: string, 2: string}>> role => [question, guide id] */
    public static function requestsByRole(): array
    {
        return [
            'SUPER_ADMIN' => [
                ['I wanna create an org', 'sao-create-organization'],
                ["let's set up a new academic year", 'create-academic-year'],
                ['I would like to invite a dean', 'sao-invite-dean'],
                ['can you post an announcement for everyone', 'sao-announcement'],
                ['please add a venue', 'sao-venues'],
                ['I need to open a clearance period', 'sao-clearance-period'],
                ["reset a student's password", 'reset-member-password'],
                ['I want to add SAO staff', 'sao-add-staff'],
                ['upload student records', 'upload-student-records'],
            ],
            'DEPARTMENT_HEAD' => [
                ['I wanna create an org', 'dean-allow-applicant'],
                ['I want to start a new organization for my college', 'dean-allow-applicant'],
                ['we need to register a new club', 'dean-allow-applicant'],
                ['gusto ko mag create ng org', 'dean-allow-applicant'],
                ['can you post a college announcement', 'dean-announcement'],
                ['I need to invite a college secretary', 'dean-office-staff'],
                ['please sign student clearances', 'sign-clearances'],
                ['I want to approve a budget', 'dean-approvals'],
                ["I'd like to upload student records", 'upload-student-records'],
            ],
            'ADMIN' => [
                ['create an event for Friday', 'admin-create-event'],
                ['gusto ko mag create ng event', 'admin-create-event'],
                ['I need to book a venue', 'book-venue'],
                ['let me add a new member', 'admin-add-members'],
                ['I want to open an election', 'admin-election'],
                ['can you help me post an announcement', 'create-announcement'],
                ['I wanna request a budget', 'admin-budget'],
                ['create a task for the officers', 'admin-create-task'],
                ['I need to record an expense', 'admin-ledger'],
            ],
            'SBO_OFFICER' => [
                ['I want to book a venue', 'book-venue'],
                ['I need to record attendance at the event', 'event-check-in'],
                ['let me add a new member', 'admin-add-members'],
                ['post an announcement', 'create-announcement'],
                ['I need to update my task status', 'officer-update-task'],
                ['I want to vote', 'student-vote'],
                ['please sign student clearances', 'sign-clearances'],
                ['I need to order a shirt', 'student-order'],
            ],
            'STUDENT' => [
                ['I wanna create an org', 'student-apply-organization'],
                ['gusto ko mag create ng org', 'student-apply-organization'],
                ['can you help me make a new club', 'student-apply-organization'],
                ['let me file a grievance', 'student-grievance'],
                ['I want to vote', 'student-vote'],
                ['I need to order merchandise', 'student-order'],
                ['I want to buy a shirt', 'student-order'],
                ['pay my fees', 'student-fees'],
            ],
        ];
    }

    public function test_every_role_can_say_what_it_wants_to_do_and_gets_the_page_where_it_is_done(): void
    {
        $this->activeSemester();

        foreach (self::requestsByRole() as $role => $requests) {
            $this->assertGreaterThanOrEqual(6, count($requests), $role);
            $user = $this->userFor($role);

            foreach ($requests as [$question, $guideId]) {
                $context = "{$role}: {$question}";
                $answer = $this->ask($user, $question);

                $this->assertSame('how_to_guide', $answer['intent'], $context);
                $this->assertSame($this->guideTitle($guideId), $answer['title'], $context);
                $this->assertButtonOpensForRole($answer, $role, $context);
                $this->assertSame('Start here', $this->firstRow($answer)['status'], $context);
                $this->assertStringStartsWith('Yes, you can', $answer['answer'], $context);
                $this->assertStringNotContainsString('Here is how', $answer['answer'], $context);
                $this->assertStringNotContainsString('(s)', $answer['answer'], $context);
                $this->assertNoDeadLinks($answer, $role, $context);
                $this->assertContains('how-to-steps', array_column($answer['sections'], 'id'), $context);
            }
        }
    }

    public function test_the_dean_who_types_i_wanna_create_an_org_is_taken_to_organizations_with_their_own_facts(): void
    {
        $this->activeSemester();
        $college = $this->makeCollege('CCS');
        $dean = $this->dean($college);
        $active = $this->makeCollegeStudentOrganization($college, ['lifecycle_status' => 'active', 'is_active' => true]);
        $this->makeCollegeStudentOrganization($college, ['lifecycle_status' => 'active', 'is_active' => true]);
        $student = User::factory()->student()->create(['organization_id' => $active->id]);
        $newcomer = User::factory()->student()->create(['organization_id' => $dean->organization_id]);
        OrganizationApplicantGrant::create(['college_id' => $college->id, 'user_school_id' => $newcomer->school_id, 'granted_by' => $dean->school_id]);
        OrganizationApplication::create([
            'college_id' => $college->id, 'name' => 'Debate Society', 'acronym' => 'DEB', 'school_id' => $student->school_id,
            'first_name' => 'Ana', 'last_name' => 'Reyes', 'email' => 'ana@example.test', 'position_title' => 'President',
            'status' => 'pending_dean', 'round' => 1, 'submitted_at' => now()->subDay(),
        ]);

        $answer = $this->ask($dean, 'I wanna create an org');

        $this->assertSame('how_to_guide', $answer['intent']);
        $first = $this->firstRow($answer);
        $this->assertSame('/dashboard/department-head/organizations', $first['href']);
        $this->assertSame('Open Organizations', $first['action_label']);

        $text = $answer['answer'];
        $this->assertStringStartsWith('Yes, you can start a new organization for your college', $text);
        $this->assertStringContainsString('Allow a student to apply', $text);
        $this->assertStringContainsString('The SAO makes the final decision', $text);
        $this->assertStringContainsString('Your college has 2 student organizations.', $text);
        $this->assertStringContainsString('1 student is allowed to apply and has not applied yet.', $text);
        $this->assertStringContainsString('1 application is waiting for your decision.', $text);
        $this->assertStringContainsString('An active semester is open.', $text);
        $this->assertStringNotContainsString('(s)', $text);
        $this->assertStringNotContainsString('lifecycle', strtolower($text));
        $this->assertStringNotContainsString('how_to_guide', $text);

        $rows = collect($answer['sections'])->flatMap(fn (array $section) => $section['rows'])->pluck('primary')->implode('|');
        $this->assertStringContainsString('Your college has 2 student organizations', $rows);
    }

    public function test_the_dean_readiness_facts_use_the_singular_and_say_what_is_missing(): void
    {
        $college = $this->makeCollege('CBA');
        $dean = $this->dean($college);

        $answer = $this->ask($dean, 'I wanna create an org');

        $this->assertStringContainsString('No student organization has started in your college yet.', $answer['answer']);
        $this->assertStringContainsString('No student is allowed to apply yet. Choose one with Allow a student to apply.', $answer['answer']);
        $this->assertStringContainsString('No application is waiting for your decision.', $answer['answer']);
        $this->assertStringContainsString('No semester is active yet.', $answer['answer']);
    }

    public function test_a_student_hears_where_they_stand_on_applying_without_being_told_to_ask_for_access(): void
    {
        $this->activeSemester();
        $college = $this->makeCollege('CCS');
        $student = User::factory()->student()->create(['organization_id' => $this->makeCollegeHome($college)->id]);

        $before = $this->ask($student, 'I wanna create an org');
        $this->assertStringContainsString('Your Department Head has not allowed you to apply yet.', $before['answer']);
        $this->assertStringNotContainsStringIgnoringCase('ask the', $before['answer']);
        $this->assertStringNotContainsStringIgnoringCase('more access', $before['answer']);
        $this->assertSame('/dashboard/student/apply-organization', $this->firstRow($before)['href']);

        OrganizationApplicantGrant::create(['college_id' => $college->id, 'user_school_id' => $student->school_id]);
        $after = $this->ask($student, 'I wanna create an org');
        $this->assertStringContainsString('Your Department Head has allowed you to apply.', $after['answer']);
    }

    public function test_a_request_opens_the_form_when_the_page_opens_one_from_a_link(): void
    {
        $this->activeSemester();

        $event = $this->ask($this->userFor('ADMIN'), 'create an event for Friday');
        $this->assertSame('/dashboard/events/manage-events?new=1', $this->firstRow($event)['href']);

        $task = $this->ask($this->userFor('ADMIN'), 'I need to create a task');
        $this->assertSame('/dashboard/tasks/task-board?new=1', $this->firstRow($task)['href']);
    }

    /** @return array<string, array{0: string, 1: string}> */
    public static function wrongRoleRequests(): array
    {
        return [
            'student creates an event' => ['STUDENT', 'create an event for Friday'],
            'student books a venue' => ['STUDENT', 'I want to book a venue'],
            'student posts an announcement' => ['STUDENT', 'can you post an announcement'],
            'student adds a member' => ['STUDENT', 'let me add a new member'],
            'student approves a budget' => ['STUDENT', 'I want to approve a budget'],
            'officer approves a budget' => ['SBO_OFFICER', 'I want to approve a budget'],
            'officer creates an event' => ['SBO_OFFICER', 'please create an event'],
            'officer opens an election' => ['SBO_OFFICER', 'I need to open an election'],
            'admin invites a dean' => ['ADMIN', 'I would like to invite a dean'],
            'dean adds a member' => ['DEPARTMENT_HEAD', 'let me add a new member'],
            'dean files a grievance' => ['DEPARTMENT_HEAD', 'I want to file a grievance'],
            'sao books a venue' => ['SUPER_ADMIN', 'I want to book a venue'],
        ];
    }

    #[DataProvider('wrongRoleRequests')]
    public function test_a_request_the_role_cannot_do_says_who_can_and_offers_a_link_that_opens(string $role, string $question): void
    {
        $user = $this->userFor($role);
        $answer = $this->ask($user, $question);
        $context = "{$role}: {$question}";

        $this->assertSame('how_to_guide', $answer['intent'], $context);
        $this->assertMatchesRegularExpression('/^(The SAO|An? [A-Za-z ]+) cannot .+ in HIUSA; that is done by .+\./', $answer['answer'], $context);
        $this->assertStringContainsString('that is done by', $answer['answer'], $context);
        $this->assertStringNotContainsStringIgnoringCase('ask for', $answer['answer'], $context);
        $this->assertStringNotContainsStringIgnoringCase('more access', $answer['answer'], $context);
        $this->assertStringNotContainsString('Step 1', json_encode($answer['sections']), $context);
        $this->assertNoDeadLinks($answer, $role, $context);
        $this->assertSame('Other role', collect($answer['highlights'])->firstWhere('label', 'Your access')['value'], $context);

        if (str_contains($answer['answer'], 'nearest thing')) {
            $this->assertButtonOpensForRole($answer, $role, $context);
        }
    }

    public function test_the_wrong_role_answers_name_the_right_role_and_the_nearest_page(): void
    {
        $student = $this->ask($this->userFor('STUDENT'), 'create an event for Friday');
        $this->assertStringContainsString('A student cannot create an event in HIUSA; that is done by the Organization Admin.', $student['answer']);
        $this->assertSame('/dashboard/events/activity-calendar', $this->firstRow($student)['href']);

        $officer = $this->ask($this->userFor('SBO_OFFICER'), 'I want to approve a budget');
        $this->assertStringContainsString('An SBO Officer cannot', $officer['answer']);
        $this->assertSame('/dashboard/finance/budget-allocation', $this->firstRow($officer)['href']);
    }

    /** @return array<string, array{0: string, 1: string, 2: string}> */
    public static function recordQuestions(): array
    {
        return [
            ['show me overdue tasks', 'ADMIN', 'tasks_workload'],
            ['list organizations without an admin', 'SUPER_ADMIN', 'organizations_without_admin'],
            ['give me the budget balance', 'ADMIN', 'finance_health'],
            ['I want to know how much budget is left', 'ADMIN', 'finance_health'],
            ['can you tell me who has not paid', 'ADMIN', 'finance_health'],
            ['I want to see my clearance', 'STUDENT', 'clearances_status'],
            ['could you list the pending approvals', 'DEPARTMENT_HEAD', 'pending_approvals'],
            ['can you show me the orders waiting to be claimed', 'SBO_OFFICER', 'merchandise_orders'],
            ['please send me the list of unpaid invoices', 'ADMIN', 'finance_health'],
            ['I need to know which events are coming up', 'ADMIN', 'events_attendance'],
            ['let me see the election results', 'STUDENT', 'elections_status'],
            ['open tasks', 'ADMIN', 'tasks_workload'],
            ['order status', 'STUDENT', 'merchandise_orders'],
            ['Is my order ready to claim?', 'STUDENT', 'merchandise_orders'],
            ['update on the budget', 'ADMIN', 'finance_health'],
        ];
    }

    public function test_questions_about_records_still_go_to_their_record_intents(): void
    {
        $service = app(AskAiService::class);

        foreach (self::recordQuestions() as [$question, $role, $intent]) {
            $this->assertSame($intent, $service->classifyIntent($question, null, $role), "{$role}: {$question}");
        }
    }

    public function test_requests_the_role_intents_claim_still_go_to_them(): void
    {
        $service = app(AskAiService::class);

        foreach ([
            ['can you plan an event with AI', 'ADMIN', 'ai_tools'],
            ['I want to draft an announcement with AI', 'ADMIN', 'ai_tools'],
            ['please summarise the financial report', 'ADMIN', 'ai_tools'],
            ['I need a forecast of our budget', 'ADMIN', 'ai_tools'],
            ['help me plan an event', 'SBO_OFFICER', 'ai_tools'],
            ['I need to approve the applications waiting for me', 'DEPARTMENT_HEAD', 'applications_queue'],
            ['can you endorse the applications', 'DEPARTMENT_HEAD', 'applications_queue'],
        ] as [$question, $role, $intent]) {
            $this->assertSame($intent, $service->classifyIntent($question, null, $role), "{$role}: {$question}");
        }
    }

    public function test_how_questions_keep_the_question_voice_and_requests_use_the_doing_voice(): void
    {
        $admin = $this->userFor('ADMIN');

        $question = $this->ask($admin, 'How do I create an event?');
        $this->assertStringStartsWith('Create the event', $question['answer']);
        $this->assertSame('How to: Create an event and submit its requirements', $question['title']);
        $this->assertNotSame('Where to start', $question['sections'][0]['title']);

        $request = $this->ask($admin, 'I want to create an event');
        $this->assertSame('Where to start', $request['sections'][0]['title']);
        $this->assertStringStartsWith('Yes, you can do that, and it starts on the Events page.', $request['answer']);

        $filipino = $this->ask($admin, 'paano mag create ng event');
        $this->assertSame('How to: Create an event and submit its requirements', $filipino['title']);
    }

    public function test_a_request_that_matches_no_guide_lists_what_the_role_can_start(): void
    {
        $answer = $this->ask($this->userFor('STUDENT'), 'I want to open a zxqv wibble');

        $this->assertSame('how_to_guide', $answer['intent']);
        $this->assertStringStartsWith('I could not tell which task you mean', $answer['answer']);
        $this->assertStringContainsString('"I want to file a grievance"', $answer['answer']);
        $this->assertNoDeadLinks($answer, 'STUDENT', 'catalog');
    }

    public function test_the_capabilities_answer_lists_what_each_role_can_start(): void
    {
        $service = app(AskAiService::class);
        $expected = [
            'SUPER_ADMIN' => ['create an organization directly', 'add SAO staff', 'invite a Department Head'],
            'DEPARTMENT_HEAD' => ['start a new organization', 'post a college announcement'],
            'ADMIN' => ['create an event', 'book a campus venue', 'post an announcement'],
            'SBO_OFFICER' => ['book a campus venue', 'post an announcement', 'add members or officers'],
            'STUDENT' => ['file a grievance', 'start a new organization', 'vote in an election'],
        ];

        foreach ($expected as $role => $phrases) {
            $answer = $service->capabilitiesAnswer($this->userFor($role))['answer'];
            foreach ($phrases as $phrase) {
                $this->assertStringContainsString($phrase, $answer, "{$role}: {$phrase}");
            }
            $this->assertStringContainsString('Say what you want to do, for example', $answer, $role);
            $this->assertStringNotContainsString('Use Ask AI', $answer, $role);
            $this->assertStringContainsString('I never approve, assign or publish anything for you', $answer, $role);
        }

        $this->assertStringNotContainsString('create an event', $service->capabilitiesAnswer($this->userFor('STUDENT'))['answer']);
    }

    public function test_the_example_each_role_is_shown_works_when_typed(): void
    {
        $this->activeSemester();

        foreach (['SUPER_ADMIN' => 'I want to invite a dean', 'DEPARTMENT_HEAD' => 'I wanna create an org', 'ADMIN' => 'I need to create an event', 'SBO_OFFICER' => 'I want to book a venue', 'STUDENT' => 'I want to file a grievance'] as $role => $example) {
            $user = $this->userFor($role);
            $this->assertStringContainsString($example, app(AskAiService::class)->capabilitiesAnswer($user)['answer'], $role);

            $answer = $this->ask($user, $example);
            $this->assertSame('how_to_guide', $answer['intent'], $role);
            $this->assertButtonOpensForRole($answer, $role, $role);
        }
    }

    public function test_every_guide_start_link_is_one_its_roles_can_open(): void
    {
        $routes = app(ClientRouteAccess::class);

        foreach (app(HowToGuideLibrary::class)->all() as $guide) {
            if (! isset($guide['open_path'])) {
                continue;
            }
            foreach ($guide['roles'] as $role) {
                $this->assertNotNull($routes->hrefFor($role, $guide['open_path']), "{$guide['id']} open_path for {$role}");
            }
        }
    }

    public function test_guide_search_understands_the_ways_people_name_things(): void
    {
        $library = app(HowToGuideLibrary::class);

        foreach ([
            ['I wanna create an org', 'SUPER_ADMIN', 'sao-create-organization'],
            ['make a new club', 'DEPARTMENT_HEAD', 'dean-allow-applicant'],
            ['creating an organisation', 'DEPARTMENT_HEAD', 'dean-allow-applicant'],
            ['registering a new org', 'DEPARTMENT_HEAD', 'dean-allow-applicant'],
            ['set up a new organization', 'SUPER_ADMIN', 'sao-create-organization'],
            ['sign up a new organization', 'STUDENT', 'student-apply-organization'],
            ['booking a room', 'ADMIN', 'book-venue'],
            ['creating events', 'ADMIN', 'admin-create-event'],
            ['gusto kong mag-create ng event', 'ADMIN', 'admin-create-event'],
            ['filing a complaint', 'STUDENT', 'student-grievance'],
        ] as [$question, $role, $id]) {
            $this->assertSame($id, $library->search($question, $role)['best']['id'] ?? null, "{$role}: {$question}");
        }
    }

    public function test_the_conversation_treats_a_request_like_the_one_shot_answer_and_hands_the_model_the_steps(): void
    {
        $this->activeSemester();
        $admin = $this->userFor('ADMIN');
        Sanctum::actingAs($admin);
        $fake = new AskAiChatFakeGenerator(['Open Elections and create the election.'], null, 'claude-test', false);
        $this->app->instance(TextGenerator::class, $fake);

        $this->postJson('/api/ai/assistant/chat', ['message' => 'I need to open an election'])
            ->assertOk()
            ->assertJsonPath('message.payload.intent', 'how_to_guide')
            ->assertJsonPath('message.payload.model_written', true)
            ->assertJsonPath('message.payload.recommended_action.href', '/dashboard/elections/manage-elections');

        $turn = $fake->lastUserTurn();
        $this->assertStringContainsString('"guide_steps"', $turn);
        $this->assertStringContainsString('Create election', $turn);
        $this->assertStringContainsString('"next_step"', $turn);
        $this->assertStringContainsString('Where to start', $turn);
        $this->assertStringContainsString('Yes, you can do that, and it starts on the Elections page.', $turn);
    }

    public function test_the_conversation_gives_the_same_guide_the_one_shot_path_gives(): void
    {
        $this->activeSemester();
        $officer = $this->userFor('SBO_OFFICER');
        $oneShot = $this->ask($officer, 'I want to book a venue');

        Sanctum::actingAs($officer);
        $chat = $this->postJson('/api/ai/assistant/chat', ['message' => 'I want to book a venue'])->assertOk();

        $chat->assertJsonPath('message.payload.intent', 'how_to_guide');
        $chat->assertJsonPath('message.payload.title', $oneShot['title']);
        $chat->assertJsonPath('message.payload.recommended_action.href', $this->firstRow($oneShot)['href']);
        $chat->assertJsonPath('message.content', $oneShot['answer']);
    }
}
