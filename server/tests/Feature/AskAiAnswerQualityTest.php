<?php

namespace Tests\Feature;

use App\Contracts\TextGenerator;
use App\Models\Attendance;
use App\Models\Event;
use App\Models\Invoice;
use App\Models\Merchandise;
use App\Models\Order;
use App\Models\Organization;
use App\Models\StudentRegistryEntry;
use App\Models\User;
use App\Services\Ai\AskAiService;
use App\Services\Ai\HowToGuideLibrary;
use App\Services\Dashboard\ClientRouteAccess;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\Support\AskAiChatFakeGenerator;
use Tests\TestCase;

/**
 * What a person reads when Ask AI cannot match the question, the new student and school-records answers, the how-to
 * guides held to the role that asks, and the one line that says where the facts came from. Every test asks in plain
 * words as one role with no model key, and checks the title, the sentence, the rows and where each button goes.
 */
class AskAiAnswerQualityTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private const NO_ANSWER = 'I do not have an answer for that';

    protected function setUp(): void
    {
        parent::setUp();
        config(['performance.api_cache.enabled' => false, 'services.groq.key' => '', 'services.anthropic.key' => '']);
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

    /** @return array{intent: string, title: string, answer: string, rows: array<int, array<string, mixed>>, hrefs: array<int, string>, text: string, payload: array<string, mixed>} */
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
            'payload' => $payload,
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

    private function record(int $schoolId, int $collegeId, string $program, array $overrides = []): StudentRegistryEntry
    {
        return StudentRegistryEntry::create([
            'school_id' => $schoolId, 'first_name' => 'First'.$schoolId, 'last_name' => 'Last'.$schoolId, 'birth_date' => '2005-01-01',
            'college_id' => $collegeId, 'program' => $program, 'year_level' => '2nd Year', 'record_type' => StudentRegistryEntry::STUDENT,
            ...$overrides,
        ]);
    }

    /** @return array{0: User, 1: User} a dean with three students not signed up in the college, and an SAO */
    private function registryWorld(): array
    {
        $college = $this->makeCollege('CCS');
        $other = $this->makeCollege('CBA');
        $this->makeCollegeHome($college);
        $this->makeCollegeHome($other);
        $dean = $this->makeCollegeHead($college);

        $this->record(2001, $college->id, 'BSIT');
        $this->record(2002, $college->id, 'BSIT');
        $this->record(2003, $college->id, 'BSCS');
        $this->record(2004, $college->id, 'BSIT', ['claimed_at' => now()]);
        $this->record(2005, $college->id, 'BSCS');
        User::factory()->student()->create(['school_id' => 2004, 'organization_id' => $this->org(['college_id' => $college->id])->id]);
        User::factory()->student()->create(['school_id' => 2005, 'organization_id' => $this->org(['college_id' => $college->id])->id]);
        $this->record(2007, $college->id, 'Registrar', ['record_type' => StudentRegistryEntry::EMPLOYEE]);
        $this->record(2006, $other->id, 'BSBA');

        return [$dean, $this->sao()];
    }

    // -------------------------------------------------------------------------
    // SD-01: the dean and the SAO asking who has not signed up
    // -------------------------------------------------------------------------

    public function test_the_dean_asking_who_has_not_signed_up_gets_the_count_and_the_people_page(): void
    {
        [$dean] = $this->registryWorld();

        $answer = $this->ask($dean, 'Which students have not signed up yet?');

        $this->assertSame('unclaimed_students', $answer['intent']);
        $this->assertSame('Students Who Have Not Signed Up', $answer['title']);
        $this->assertStringContainsString('3 of the 5 student records in your college have not signed up yet', $answer['answer']);
        $this->assertStringContainsString('Not signed up', $answer['answer']);
        $this->assertStringNotContainsString('closest', $answer['text']);
        $rows = $this->rowTexts($answer);
        $this->assertStringContainsString('BSIT / 2', $rows);
        $this->assertStringContainsString('BSCS / 1', $rows);
        $this->assertStringNotContainsString('BSBA', $answer['text'], 'another college is never counted for a dean');
        $this->assertStringNotContainsString('First2001', $answer['text'], 'no student name is written into the answer');
        $this->assertSame(['/dashboard/department-head/people?status=not_signed_up'], array_values(array_unique($answer['hrefs'])));
        $this->assertHrefsOpenFor($answer, 'DEPARTMENT_HEAD');
    }

    public function test_the_sao_asking_the_same_gets_every_college_and_the_student_records_page(): void
    {
        $this->registryWorld();
        $sao = User::where('role', 'SUPER_ADMIN')->first();

        foreach (['Which students have not signed up yet?', 'How many students haven\'t created an account?'] as $question) {
            $answer = $this->ask($sao, $question);

            $this->assertSame('unclaimed_students', $answer['intent'], $question);
            $this->assertStringContainsString('4 of the 6 student records have not signed up yet', $answer['answer'], $question);
            $this->assertStringContainsString('Not yet', $answer['answer'], $question);
            $rows = $this->rowTexts($answer);
            $this->assertStringContainsString('College of CCS / 3', $rows, $question);
            $this->assertStringContainsString('College of CBA / 1', $rows, $question);
            $this->assertSame(['/dashboard/super-admin/student-records'], array_values(array_unique($answer['hrefs'])), $question);
            $this->assertHrefsOpenFor($answer, 'SUPER_ADMIN');
        }
    }

    public function test_a_college_with_everyone_signed_up_says_so_and_a_college_with_no_records_says_that(): void
    {
        $college = $this->makeCollege('CAS');
        $this->makeCollegeHome($college);
        $dean = $this->makeCollegeHead($college);

        $empty = $this->ask($dean, 'Which students have not signed up yet?');
        $this->assertSame('unclaimed_students', $empty['intent']);
        $this->assertStringContainsString('no student records', $empty['answer']);

        $record = $this->record(3001, $college->id, 'BSIT');
        $none = $this->ask($dean, 'Which students have not signed up yet?');
        $this->assertStringContainsString('None of the 1 student records in your college has signed up yet', $none['answer']);

        $record->update(['claimed_at' => now()]);
        $done = $this->ask($dean, 'Which students have not signed up yet?');
        $this->assertStringContainsString('Every student in your college\'s records has signed up', $done['answer']);
    }

    public function test_an_admin_and_a_student_asking_who_has_not_signed_up_are_never_given_the_registry(): void
    {
        $this->registryWorld();
        $org = $this->org();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $student = User::factory()->student()->create(['organization_id' => $org->id]);

        foreach ([$admin, $student] as $user) {
            $answer = $this->ask($user, 'Which students have not signed up yet?');

            $this->assertNotSame('unclaimed_students', $answer['intent'], $user->role);
            $this->assertStringStartsWith(self::NO_ANSWER, $answer['answer'], $user->role);
            $this->assertStringNotContainsString('3 of the 5', $answer['text'], $user->role);
            $this->assertStringNotContainsString('BSIT', $answer['text'], $user->role);
            $this->assertHrefsOpenFor($answer, $user->role);
            $this->assertNotContains('/dashboard/department-head/people', $answer['hrefs'], $user->role);
        }
    }

    // -------------------------------------------------------------------------
    // SD-01 and ST-01: an unmatched question is not answered with a list of unrelated records
    // -------------------------------------------------------------------------

    public function test_an_unmatched_question_says_it_has_no_answer_and_offers_what_it_can_answer(): void
    {
        $org = $this->org();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id, 'first_name' => 'Angela', 'last_name' => 'Santos', 'position_title' => 'Vice President']);
        $student = User::factory()->student()->create(['organization_id' => $org->id]);
        $dean = $this->makeCollegeHead($this->makeCollege('CCS'));
        $service = $this->app->make(AskAiService::class);

        $cases = [
            [$student, 'do you have a cash advance of the treasurer'],
            [$student, 'will it rain at the foundation week'],
            [$admin, 'what is the weather like in manila'],
            [$dean, 'recommend a good laptop for my office'],
            [$this->sao(), 'sing me a song about registration'],
            [User::factory()->officer()->create(['organization_id' => $org->id]), 'is there a surplus left over'],
        ];
        foreach ($cases as [$user, $question]) {
            $answer = $this->ask($user, $question);

            $this->assertStringStartsWith(self::NO_ANSWER, $answer['answer'], "{$user->role}: {$question}");
            $this->assertSame(self::NO_ANSWER, $answer['title'], "{$user->role}: {$question}");
            $this->assertStringNotContainsString('Found', $answer['answer'], $question);
            $this->assertStringNotContainsString('closest:', $answer['answer'], $question);
            $this->assertStringNotContainsString('Angela', $answer['text'], "{$question}: no officer list is shown as an answer");
            $this->assertSame(1, preg_match_all('/[.!?](?:\s|$)/', $answer['answer']), "{$question}: one plain sentence");

            $offers = collect($answer['rows'])->filter(fn (array $row) => isset($row['ask_question']));
            $this->assertGreaterThanOrEqual(1, $offers->count(), $question);
            $this->assertLessThanOrEqual(3, $offers->count(), $question);
            foreach ($answer['payload']['follow_ups'] as $followUp) {
                $this->assertTrue($service->canAsk($user, $followUp['topic']), "{$question}: {$followUp['topic']} is not for {$user->role}");
            }
            $this->assertLessThanOrEqual(3, count($answer['payload']['follow_ups']), $question);
            $this->assertSame([], $answer['payload']['charts'], $question);
            $this->assertHrefsOpenFor($answer, $user->role);
        }
    }

    public function test_the_offers_are_the_ones_nearest_to_the_words_that_were_used(): void
    {
        $org = $this->org();
        $officer = User::factory()->officer()->create(['organization_id' => $org->id]);

        $answer = $this->ask($officer, 'is there a surplus left over');

        $this->assertStringStartsWith(self::NO_ANSWER, $answer['answer']);
        $offers = collect($answer['rows'])->filter(fn (array $row) => isset($row['ask_question']))->values();
        $this->assertSame('Our budget, read only', $offers[0]['primary'], 'the budget offer shares the word left');
    }

    public function test_a_question_that_clearly_fits_one_page_links_to_it_only_when_the_role_can_open_it(): void
    {
        $college = $this->makeCollege('CCS');
        $this->makeCollegeHome($college);
        $dean = $this->makeCollegeHead($college);
        $org = $this->org();
        $student = User::factory()->student()->create(['organization_id' => $org->id]);

        $deanAnswer = $this->ask($dean, 'show me the full roster of every student in the college');
        $this->assertStringStartsWith(self::NO_ANSWER, $deanAnswer['answer']);
        $this->assertSame(['/dashboard/department-head/people'], array_values(array_unique($deanAnswer['hrefs'])));

        $studentAnswer = $this->ask($student, 'show me the full roster of every student in the college');
        $this->assertStringStartsWith(self::NO_ANSWER, $studentAnswer['answer']);
        $this->assertSame([], $studentAnswer['hrefs'], 'a student has no page for the roster');
        $this->assertHrefsOpenFor($studentAnswer, 'STUDENT');
    }

    public function test_a_question_that_names_a_record_still_finds_it(): void
    {
        $org = $this->org();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        Event::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->school_id, 'title' => 'Zorbfest', 'status' => 'approved', 'start_time' => now()->addDays(3), 'end_time' => now()->addDays(3)->addHours(2)]);

        $answer = $this->ask($admin, 'Zorbfest');

        $this->assertStringNotContainsString(self::NO_ANSWER, $answer['answer']);
        $this->assertStringContainsString('Zorbfest', $this->rowTexts($answer));
    }

    // -------------------------------------------------------------------------
    // ST-01: the student questions that were answered with unrelated records
    // -------------------------------------------------------------------------

    public function test_a_student_asking_how_much_the_organization_spent_is_sent_to_the_approved_reports(): void
    {
        $org = $this->org(['name' => 'Engineering Society']);
        $student = User::factory()->student()->create(['organization_id' => $org->id]);

        foreach (['how much did the organization spend on events', 'how much has our org spent', 'what did the organization spend the money on'] as $question) {
            $answer = $this->ask($student, $question);

            $this->assertSame('fee_usage', $answer['intent'], $question);
            $this->assertSame('Where Your Fees Go', $answer['title'], $question);
            $this->assertStringContainsString('No financial report of Engineering Society has been approved yet', $answer['answer'], $question);
            $this->assertStringNotContainsString('You owe', $answer['answer'], $question);
            $this->assertContains('/dashboard/finance/where-fees-go', $answer['hrefs'], $question);
            $this->assertHrefsOpenFor($answer, 'STUDENT');
        }
    }

    public function test_tagalog_words_for_what_i_owe_reach_the_students_own_account(): void
    {
        $org = $this->org();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $student = User::factory()->student()->create(['organization_id' => $org->id]);
        Invoice::create(['organization_id' => $org->id, 'reference' => 'INV-Q-1', 'student_id' => $student->school_id, 'description' => 'Membership Fee', 'amount_due' => 250, 'status' => 'unpaid', 'due_date' => now()->addWeek()->toDateString()]);

        foreach (['ano ang utang ko', 'magkano ang babayaran ko', 'may bayad pa ba ako'] as $question) {
            $answer = $this->ask($student, $question);

            $this->assertSame('finance_health', $answer['intent'], $question);
            $this->assertSame('Your Fees & Account Balance', $answer['title'], $question);
            $this->assertStringContainsString('You owe your organization ₱250.00 across 1 open invoice', $answer['answer'], $question);
            $this->assertStringNotContainsString('Angela', $answer['text'], $question);
        }

        $own = $this->ask($admin, 'ano ang utang ko');
        $this->assertSame('own_balance', $own['intent'], 'an admin asking about their own debt is not shown the organization budget');
    }

    public function test_a_student_asking_about_attendance_gets_their_own_count_and_rate(): void
    {
        $org = $this->org();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $student = User::factory()->student()->create(['organization_id' => $org->id]);
        $classmate = User::factory()->student()->create(['organization_id' => $org->id]);
        $event = fn (string $title, string $status = 'completed') => Event::factory()->create(['organization_id' => $org->id, 'created_by' => $admin->school_id, 'title' => $title, 'status' => $status, 'start_time' => now()->subDays(5), 'end_time' => now()->subDays(5)->addHours(2)]);
        foreach ([['General Assembly', 'present'], ['Foundation Day', 'late'], ['Outreach', 'present'], ['Workshop', 'absent']] as [$title, $status]) {
            Attendance::create(['event_id' => $event($title)->id, 'user_id' => $student->school_id, 'status' => $status, 'check_in_time' => now()->subDays(5), 'method' => 'manual']);
        }
        Attendance::create(['event_id' => $event('Classmates Only Meetup')->id, 'user_id' => $classmate->school_id, 'status' => 'absent', 'check_in_time' => now()->subDays(5), 'method' => 'manual']);
        Attendance::create(['event_id' => $event('Hidden Draft', 'planning')->id, 'user_id' => $student->school_id, 'status' => 'absent', 'check_in_time' => now()->subDays(5), 'method' => 'manual']);

        foreach (['what is my attendance', 'How many events did I attend?', 'did I miss any events'] as $question) {
            $answer = $this->ask($student, $question);

            $this->assertSame('my_attendance', $answer['intent'], $question);
            $this->assertSame('Your Attendance', $answer['title'], $question);
            $this->assertStringContainsString('You attended 3 events and missed 1, an attendance rate of 75%', $answer['answer'], $question);
            $rows = $this->rowTexts($answer);
            $this->assertStringContainsString('General Assembly', $rows, $question);
            $this->assertStringContainsString('Workshop', $rows, $question);
            $this->assertStringNotContainsString('Classmates Only Meetup', $rows.$answer['answer'], $question);
            $this->assertStringNotContainsString('Hidden Draft', $answer['text'], $question);
            $this->assertContains('/dashboard/events/activity-calendar', $answer['hrefs'], $question);
            $this->assertHrefsOpenFor($answer, 'STUDENT');
        }

        $none = User::factory()->student()->create(['organization_id' => $org->id]);
        $this->assertStringContainsString('No attendance has been recorded for you yet', $this->ask($none, 'what is my attendance')['answer']);
    }

    public function test_a_student_asking_where_the_claim_token_is_is_pointed_to_it_and_never_shown_anyone_elses(): void
    {
        $org = $this->org();
        $student = User::factory()->student()->create(['organization_id' => $org->id]);
        $classmate = User::factory()->student()->create(['organization_id' => $org->id]);
        $shirt = Merchandise::factory()->create(['organization_id' => $org->id, 'name' => 'Org Shirt']);
        $order = fn (User $buyer, string $status, string $token, ?Merchandise $item = null) => Order::factory()->create([
            'organization_id' => $org->id, 'student_id' => $buyer->school_id, 'merchandise_id' => ($item ?? $shirt)->id, 'status' => $status,
            'claim_token' => $token, 'total_price' => 350, 'quantity' => 1, 'processed_by' => null, 'approved_by' => null, 'claimed_at' => null,
        ]);
        $mine = $order($student, 'paid', 'MINETOKEN0001');
        $order($classmate, 'paid', 'THEIRTOKEN0002');
        $order($student, 'pending', 'PENDINGTOKEN03');

        foreach (['where is my claim token', 'what is my claim code', 'what is my claim token for the shirt'] as $question) {
            $answer = $this->ask($student, $question);

            $this->assertSame('claim_token', $answer['intent'], $question);
            $this->assertSame('Your Claim Token', $answer['title'], $question);
            $this->assertStringContainsString('1 of your orders is paid and ready to claim', $answer['answer'], $question);
            $this->assertStringContainsString('Claim tokens page', $answer['answer'], $question);
            $this->assertStringContainsString("ORD-{$mine->id}", $this->rowTexts($answer), $question);
            $this->assertStringContainsString('Org Shirt', $this->rowTexts($answer), $question);
            $this->assertSame(['/dashboard/merchandise/claim-tokens'], array_values(array_unique($answer['hrefs'])), $question);
            foreach (['MINETOKEN0001', 'THEIRTOKEN0002', 'PENDINGTOKEN03'] as $token) {
                $this->assertStringNotContainsString($token, $answer['text'], "{$question}: a token is shown on its own page and never written into a chat answer");
            }
            $this->assertHrefsOpenFor($answer, 'STUDENT');
        }

        $nobody = User::factory()->student()->create(['organization_id' => $org->id]);
        $empty = $this->ask($nobody, 'where is my claim token');
        $this->assertStringContainsString('You have no orders yet', $empty['answer']);
        $this->assertContains('/dashboard/merchandise/order-merchandise', $empty['hrefs']);
    }

    public function test_what_is_a_term_is_answered_from_the_glossary_for_every_role(): void
    {
        $org = $this->org();
        $student = User::factory()->student()->create(['organization_id' => $org->id]);
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);

        $sao = $this->ask($student, 'what is the SAO');
        $this->assertSame('glossary', $sao['intent']);
        $this->assertSame('SAO', $sao['title']);
        $this->assertStringContainsString('Student Affairs Office', $sao['answer']);
        $this->assertStringNotContainsString('Found', $sao['answer']);
        $this->assertHrefsOpenFor($sao, 'STUDENT');

        $clearance = $this->ask($student, 'What does clearance mean?');
        $this->assertSame('glossary', $clearance['intent']);
        $this->assertSame('Clearance', $clearance['title']);
        $this->assertContains('/dashboard/my-clearance', $clearance['hrefs']);

        $this->assertSame('Claim token', $this->ask($admin, 'what is a claim token?')['title']);
        $this->assertSame('SAO', $this->ask($this->sao(), 'what does SAO stand for')['title']);

        $notATerm = $this->ask($student, 'what is the SAO approval status of my clearance');
        $this->assertNotSame('glossary', $notATerm['intent'], 'a longer question about a record is not a glossary lookup');
    }

    // -------------------------------------------------------------------------
    // ST-02: a guide is only ever handed to a role it was written for
    // -------------------------------------------------------------------------

    public function test_every_step_of_every_guide_links_only_to_pages_its_roles_can_open(): void
    {
        $library = $this->app->make(HowToGuideLibrary::class);
        $access = $this->app->make(ClientRouteAccess::class);
        $checked = 0;

        foreach (['SUPER_ADMIN', 'DEPARTMENT_HEAD', 'ADMIN', 'SBO_OFFICER', 'STUDENT'] as $role) {
            foreach ($library->forRole($role) as $guide) {
                foreach ($guide['steps'] as $number => $step) {
                    $paths = $library->stepPaths($step, $role);
                    if ($paths === []) {
                        continue;
                    }
                    $open = array_filter($paths, fn (string $path) => $access->hrefFor($role, $path) !== null);
                    $this->assertNotEmpty($open, "{$role} / {$guide['id']} step ".($number + 1).' sends to '.implode(' or ', $paths).', which the role cannot open');
                    $checked++;
                }
                if (isset($guide['open_path'])) {
                    $this->assertNotNull($access->hrefFor($role, $guide['open_path']), "{$role} / {$guide['id']} open_path {$guide['open_path']}");
                }
            }
        }
        $this->assertGreaterThan(100, $checked);
    }

    public function test_a_student_and_an_officer_are_never_handed_a_guide_written_for_another_role(): void
    {
        $library = $this->app->make(HowToGuideLibrary::class);
        $org = $this->org();
        $users = [
            'STUDENT' => User::factory()->student()->create(['organization_id' => $org->id]),
            'SBO_OFFICER' => User::factory()->officer()->create(['organization_id' => $org->id]),
        ];
        $byTitle = [];
        foreach ($library->all() as $guide) {
            $byTitle['How to: '.$guide['title']] = $guide;
            $byTitle[$guide['title']] = $guide;
        }
        $foreign = 0;

        foreach ($users as $role => $user) {
            foreach ($library->all() as $guide) {
                foreach ([$guide['question'], 'I want to '.($guide['action'] ?? lcfirst($guide['title']))] as $question) {
                    $answer = $this->ask($user, $question);
                    $stepRows = collect($answer['payload']['sections'])->where('layout', 'steps');

                    // A guide is handed over when its steps are listed; the sentence for another role has none.
                    $returned = $byTitle[$answer['title']] ?? null;
                    if ($stepRows->isNotEmpty()) {
                        $this->assertNotNull($returned, "{$role} was shown steps of no known guide for: {$question}");
                        $this->assertContains($role, $returned['roles'], "{$role} was handed the guide written for ".implode(', ', $returned['roles'])." ({$answer['title']}) by: {$question}");
                    }
                    if (! in_array($role, $guide['roles'], true)) {
                        $foreign++;
                    }
                    $this->assertHrefsOpenFor($answer, $role);
                }
            }
        }
        $this->assertGreaterThan(40, $foreign);
    }

    public function test_a_student_asking_for_the_budget_approval_steps_is_told_in_one_sentence_and_sent_somewhere_real(): void
    {
        $org = $this->org();
        $student = User::factory()->student()->create(['organization_id' => $org->id]);

        $answer = $this->ask($student, 'how do I approve the budget of an organization');

        $this->assertTrue(collect($answer['payload']['sections'])->where('layout', 'steps')->isEmpty());
        $this->assertStringNotContainsString('Reviews', $answer['text']);
        $this->assertStringNotContainsString('Open Approvals in the sidebar', $answer['text']);
        $this->assertHrefsOpenFor($answer, 'STUDENT');
    }

    public function test_the_apply_guide_does_not_say_allowed_to_a_student_the_dean_has_not_allowed(): void
    {
        $college = $this->makeCollege('CCS');
        $this->makeCollegeHome($college);
        $org = $this->makeCollegeStudentOrganization($college, ['lifecycle_status' => 'active', 'is_active' => true]);
        $student = User::factory()->student()->create(['organization_id' => $org->id]);

        $answer = $this->ask($student, 'how do I join another organization');

        $this->assertSame('how_to_guide', $answer['intent']);
        $access = collect($answer['payload']['highlights'])->firstWhere('label', 'Your access');
        $this->assertSame('Not yet', $access['value']);
        $this->assertStringStartsWith('You cannot apply yet', $answer['answer']);
        $this->assertStringContainsString('Department Head', $answer['answer']);
    }

    // -------------------------------------------------------------------------
    // wow-5: every answer says where its facts came from, and no key is not a failure
    // -------------------------------------------------------------------------

    public function test_every_answer_carries_a_sources_line_in_plain_words_for_each_role(): void
    {
        $college = $this->makeCollege('CCS');
        $this->makeCollegeHome($college);
        $org = $this->makeCollegeStudentOrganization($college, ['lifecycle_status' => 'active', 'is_active' => true]);
        $users = [
            'SUPER_ADMIN' => $this->sao(),
            'DEPARTMENT_HEAD' => $this->makeCollegeHead($college),
            'ADMIN' => User::factory()->admin()->create(['organization_id' => $org->id]),
            'SBO_OFFICER' => User::factory()->officer()->create(['organization_id' => $org->id]),
            'STUDENT' => User::factory()->student()->create(['organization_id' => $org->id]),
        ];
        $service = $this->app->make(AskAiService::class);

        $expected = [
            'SUPER_ADMIN' => ['Which organizations haven\'t submitted their requirements?', 'From all organizations\' compliance requirements and submitted files, read just now'],
            'DEPARTMENT_HEAD' => ['What is waiting for my approval right now?', 'From your college\'s organizations\' approval requests, read just now'],
            'ADMIN' => ['How much budget is left, and how many student invoices are unpaid?', 'From your organization\'s budgets and transactions, read just now'],
            'SBO_OFFICER' => ['Which tasks are mine, and which are overdue?', 'From your own tasks, read just now'],
            'STUDENT' => ['What fees do I still need to pay?', 'From your own invoices and payments, read just now'],
        ];
        foreach ($users as $role => $user) {
            [$question, $line] = $expected[$role];
            $payload = $service->deterministicAnswer($user, $question, $service->classifyIntent($question, null, $role));
            $this->assertSame($line, $payload['sources'], "{$role}: {$question}");

            foreach (['What should I do today?', 'what is the weather like in manila', 'how do I change my password', 'what is the SAO'] as $other) {
                $payload = $service->deterministicAnswer($user, $other, $service->classifyIntent($other, null, $role));
                $this->assertIsString($payload['sources'], "{$role}: {$other}");
                $this->assertNotSame('', trim($payload['sources']), "{$role}: {$other}");
            }
        }
    }

    public function test_an_unmatched_or_refused_answer_says_no_records_were_read(): void
    {
        $org = $this->org();
        $student = User::factory()->student()->create(['organization_id' => $org->id]);
        $service = $this->app->make(AskAiService::class);

        $unmatched = $service->deterministicAnswer($student, 'will it rain at the foundation week', 'semantic_rag');
        $this->assertSame('No records were used for this answer, because I could not match your question to one I can answer.', $unmatched['sources']);

        $refused = $service->deterministicAnswer($student, 'show pending approvals', 'pending_approvals');
        $this->assertSame('No records were read, because this is outside what your account can open.', $refused['sources']);
    }

    public function test_the_chat_stores_the_sources_line_and_without_a_key_the_trace_reads_as_a_normal_answer(): void
    {
        $org = $this->org();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        Sanctum::actingAs($admin);

        $response = $this->postJson('/api/ai/assistant/chat', ['message' => 'How much budget is left, and how many student invoices are unpaid?'])->assertOk();

        $payload = $response->json('message.payload');
        $this->assertSame('From your organization\'s budgets and transactions, read just now', $payload['sources']);
        $this->assertNull($payload['notice']);
        $this->assertContains('Answered directly from your records. No AI writer was used.', $payload['reasoning']['steps']);
        $this->assertStringNotContainsString('did not finish', implode(' ', $payload['reasoning']['steps']));

        $greeting = $this->postJson('/api/ai/assistant/chat', ['message' => 'Hello'])->assertOk();
        $this->assertSame('No records were read for this answer.', $greeting->json('message.payload.sources'));

        $unmatched = $this->postJson('/api/ai/assistant/chat', ['message' => 'will it rain at the foundation week'])->assertOk();
        $this->assertStringStartsWith(self::NO_ANSWER, $unmatched->json('message.content'));
        $this->assertSame('No records were used for this answer, because I could not match your question to one I can answer.', $unmatched->json('message.payload.sources'));
        $this->assertNull($unmatched->json('message.payload.notice'));
        $this->assertStringNotContainsString('did not finish', implode(' ', $unmatched->json('message.payload.reasoning.steps')));
    }

    public function test_the_failure_wording_stays_for_a_provider_that_has_a_key_and_really_failed(): void
    {
        config(['services.anthropic.key' => 'test-key']);
        $org = $this->org();
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $this->app->instance(TextGenerator::class, new AskAiChatFakeGenerator([], null, 'claude-test', true));
        Sanctum::actingAs($admin);

        $payload = $this->postJson('/api/ai/assistant/chat', ['message' => 'How much budget is left, and how many student invoices are unpaid?'])->assertOk()->json('message.payload');

        $this->assertContains('The writing service did not finish, so this is the summary from your records', $payload['reasoning']['steps']);
        $this->assertNotContains('Answered directly from your records. No AI writer was used.', $payload['reasoning']['steps']);
    }
}
