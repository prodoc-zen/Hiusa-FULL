<?php

namespace Tests\Feature;

use App\Contracts\TextGenerator;
use App\Models\AccountProfile;
use App\Models\AiMessage;
use App\Models\Announcement;
use App\Models\ApprovalRequest;
use App\Models\Budget;
use App\Models\College;
use App\Models\DepartmentHeadInvitation;
use App\Models\Event;
use App\Models\Grievance;
use App\Models\Organization;
use App\Models\OrganizationApplicantGrant;
use App\Models\SboPosition;
use App\Models\Task;
use App\Models\User;
use App\Services\Ai\AskAiActions;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\RateLimiter;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\Support\AskAiChatFakeGenerator;
use Tests\TestCase;

class AskAiActionsTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['performance.api_cache.enabled' => false, 'services.groq.key' => '', 'services.anthropic.key' => '', 'services.hiusa_ai.enabled' => false]);
        RateLimiter::for('ai-generation', fn () => Limit::none());
    }

    private function model(array $structured): ActionFieldsFakeGenerator
    {
        config(['services.anthropic.key' => 'test-key']);
        $fake = new ActionFieldsFakeGenerator($structured);
        $this->app->instance(TextGenerator::class, $fake);

        return $fake;
    }

    private function admin(?Organization $org = null): User
    {
        return User::factory()->admin()->create(['organization_id' => ($org ?? Organization::factory()->create())->id]);
    }

    /** Sends a typed message and answers the assistant message's payload action. */
    private function ask(string $text, string $source = 'typed', ?int $conversationId = null): array
    {
        $body = ['message' => $text, 'source' => $source];
        if ($conversationId !== null) {
            $body['conversation_id'] = $conversationId;
        }

        return $this->postJson('/api/ai/assistant/chat', $body)->assertOk()->json('message');
    }

    private function values(array $message): array
    {
        return collect($message['payload']['action']['fields'])->mapWithKeys(fn (array $field) => [$field['name'] => $field['value']])->all();
    }

    private function confirm(int $messageId, array $fields = [])
    {
        return $this->postJson("/api/ai/assistant/messages/{$messageId}/action/confirm", ['fields' => $fields]);
    }

    // -------------------------------------------------------------------------
    // Proposals
    // -------------------------------------------------------------------------

    public function test_a_proposal_fills_only_what_the_message_says_and_changes_no_record(): void
    {
        $admin = $this->admin();
        Sanctum::actingAs($admin);

        $message = $this->ask('create an event called "General Assembly" please');

        $action = $message['payload']['action'];
        $this->assertSame('create_event', $action['key']);
        $this->assertSame('awaiting_confirmation', $action['status']);
        $this->assertSame('Create event', $action['submit_label']);
        $this->assertSame([], $action['errors']);
        $this->assertNull($action['result']);
        $this->assertSame(['title', 'description', 'start_time', 'end_time', 'location'], array_column($action['fields'], 'name'));
        $this->assertSame(['title' => 'General Assembly', 'description' => null, 'start_time' => null, 'end_time' => null, 'location' => null], $this->values($message));
        $this->assertStringContainsString('press Create event', $message['content']);
        $this->assertEqualsWithDelta(now()->addMinutes(30)->timestamp, strtotime($action['expires_at']), 5);

        $this->assertSame(0, Event::count());
        $this->assertSame(0, ApprovalRequest::count());
    }

    public function test_called_and_named_work_without_quotes_and_a_question_is_not_a_request(): void
    {
        Sanctum::actingAs($this->admin());

        $this->assertSame(['title' => 'Foundation Day'], array_filter($this->values($this->ask('i wanna make an event named Foundation Day on friday'))));

        foreach (['how do i create an event?', 'What is an event?', 'can i create an event?', 'paano mag create ng event', 'show me my events'] as $question) {
            $this->assertArrayNotHasKey('action', $this->ask($question)['payload'] ?? [], $question);
        }
        $this->assertSame(0, Event::count());
    }

    public function test_everyday_phrasing_is_recognised_for_each_role(): void
    {
        $actions = app(AskAiActions::class);
        $cases = [
            'ADMIN' => ['i wanna create an event pls' => 'create_event', 'can u make a task for the treasurer' => 'create_task', 'pls propose a budget for the fun run' => 'propose_budget', 'could you draft an announcement about enrollment' => 'draft_announcement'],
            'SBO_OFFICER' => ['gusto ko mag draft ng announcement' => 'draft_announcement', 'write an announcement for students' => 'draft_announcement'],
            'STUDENT' => ['gusto ko mag file ng grievance' => 'file_grievance', 'i want to file a complaint about the canteen' => 'file_grievance'],
            'DEPARTMENT_HEAD' => ['i want to start a new student organization' => 'allow_applicant', 'let maria apply for a new organization' => 'allow_applicant'],
            'SUPER_ADMIN' => ['add a college called College of Law' => 'add_college', 'invite a department head to the College of Law' => 'invite_department_head', 'add a dean for the college of arts' => 'invite_department_head'],
        ];

        foreach ($cases as $role => $messages) {
            $user = new User(['role' => $role]);
            foreach ($messages as $text => $key) {
                $this->assertSame($key, $actions->recognise($user, $text), "{$role}: {$text}");
            }
        }

        $this->assertNull($actions->recognise(new User(['role' => 'DEPARTMENT_HEAD']), 'add a student to my organization'));
        $this->assertNull($actions->recognise(new User(['role' => 'ADMIN']), 'the event was created yesterday'));
    }

    public function test_a_link_or_prompt_button_message_never_proposes(): void
    {
        Sanctum::actingAs($this->admin());

        $message = $this->ask('create an event called "General Assembly"', 'link');

        $this->assertArrayNotHasKey('action', $message['payload']);
        $this->assertSame(0, AiMessage::query()->whereNotNull('payload->action')->count());
    }

    public function test_a_role_without_the_action_never_gets_it(): void
    {
        $org = Organization::factory()->create();
        $cases = [
            [User::factory()->student()->create(['organization_id' => $org->id]), 'create an event called Fun Run'],
            [User::factory()->officer()->create(['organization_id' => $org->id]), 'create a task called Tarpaulin'],
            [$this->admin($org), 'file a grievance about the canteen'],
            [$this->admin($org), 'add a college called College of Law'],
        ];

        foreach ($cases as [$user, $text]) {
            Sanctum::actingAs($user);
            $this->assertArrayNotHasKey('action', $this->ask($text)['payload'], $user->role.': '.$text);
        }
    }

    public function test_the_chat_stream_for_a_proposal_is_meta_one_delta_then_done(): void
    {
        Sanctum::actingAs($this->admin());

        $response = $this->postJson('/api/ai/assistant/chat', ['message' => 'create an event called "Fun Run"'], ['Accept' => 'text/event-stream']);
        $response->assertOk();
        preg_match_all('/^event: (\w+)$/m', $response->streamedContent(), $names);

        $this->assertSame(['meta', 'delta', 'done'], $names[1]);
    }

    public function test_capabilities_titles_follow_the_role(): void
    {
        $actions = app(AskAiActions::class);

        $this->assertSame(['Create an event', 'Create a task', 'Propose a budget', 'Draft an announcement'], $actions->titlesFor(new User(['role' => 'ADMIN'])));
        $this->assertSame(['Draft an announcement'], $actions->titlesFor(new User(['role' => 'SBO_OFFICER'])));
        $this->assertSame(['File a grievance'], $actions->titlesFor(new User(['role' => 'STUDENT'])));
        $this->assertSame(['Let a student apply for a new organization'], $actions->titlesFor(new User(['role' => 'DEPARTMENT_HEAD'])));
        $this->assertSame(['Add a college', 'Invite a Department Head'], $actions->titlesFor(new User(['role' => 'SUPER_ADMIN'])));
    }

    // -------------------------------------------------------------------------
    // The model only pre-fills, and only with what fits
    // -------------------------------------------------------------------------

    public function test_model_values_fill_the_card_and_the_model_is_told_the_date_and_zone_and_to_leave_unknowns_null(): void
    {
        $fake = $this->model(['title' => 'General Assembly', 'description' => null, 'start_time' => '2026-12-05T15:00', 'end_time' => null, 'location' => 'Gym']);
        Sanctum::actingAs($this->admin());

        $message = $this->ask('make an event General Assembly this Saturday at 3pm in the gym');

        $this->assertSame(['title' => 'General Assembly', 'description' => null, 'start_time' => '2026-12-05T15:00', 'end_time' => null, 'location' => 'Gym'], $this->values($message));
        $this->assertCount(1, $fake->structuredCalls);
        $call = $fake->structuredCalls[0];
        $this->assertStringContainsString('null', $call['instructions']);
        $this->assertStringContainsString('never guess', $call['instructions']);
        $this->assertSame('Asia/Manila', $call['input']['time_zone']);
        $this->assertSame(now('Asia/Manila')->format('l, Y-m-d'), $call['input']['today']);
        $this->assertSame(['title', 'description', 'start_time', 'end_time', 'location'], $call['schema']['required']);
        foreach ($call['schema']['properties'] as $property) {
            $this->assertContains('null', $property['type']);
        }
        $this->assertSame(0, Event::count());
    }

    public function test_model_values_that_do_not_fit_a_field_are_dropped(): void
    {
        $org = Organization::factory()->create();
        SboPosition::create(['organization_id' => $org->id, 'role' => 'SBO_OFFICER', 'title' => 'Secretary', 'is_active' => true]);
        User::factory()->officer()->create(['organization_id' => $org->id, 'position_title' => 'Secretary', 'account_status' => 'active']);
        $this->model(['title' => str_repeat('x', 300), 'description' => ['not', 'text'], 'deadline' => 'next friday', 'assigned_to' => '999999']);
        Sanctum::actingAs($this->admin($org));

        $message = $this->ask('create a task for next friday');

        $this->assertSame(['title' => null, 'description' => null, 'deadline' => null, 'assigned_to' => null], $this->values($message));

    }

    public function test_model_numbers_and_options_that_do_not_fit_are_dropped_and_the_rest_kept(): void
    {
        $this->model(['allocated_amount' => 'a lot', 'warning_threshold' => -5, 'title' => 'Fun Run Budget']);
        Sanctum::actingAs($this->admin());

        $budget = $this->ask('propose a budget for the fun run');

        $this->assertSame(['title' => 'Fun Run Budget', 'allocated_amount' => null, 'warning_threshold' => null], $this->values($budget));
    }

    public function test_a_model_audience_outside_the_listed_options_is_dropped(): void
    {
        $this->model(['title' => 'Notice', 'body' => 'Hello.', 'target_role' => 'EVERYBODY', 'category' => 'general']);
        Sanctum::actingAs($this->admin());

        $announcement = $this->ask('draft an announcement');

        $this->assertSame(['title' => 'Notice', 'body' => 'Hello.', 'target_role' => null, 'category' => 'general'], $this->values($announcement));
    }

    public function test_without_a_model_a_phrase_amount_email_and_option_are_still_read_honestly(): void
    {
        $this->admin();
        $sao = $this->sao();
        College::create(['name' => 'College of Law', 'code' => 'LAW', 'is_active' => true]);
        Sanctum::actingAs($sao);

        $values = $this->values($this->ask('invite a dean for the College of Law, send it to dean@example.edu'));

        $this->assertSame(['college_id' => (string) College::where('code', 'LAW')->value('id'), 'email' => 'dean@example.edu'], $values);

        Sanctum::actingAs($this->admin());
        $budget = $this->values($this->ask('propose a budget called Fun Run Budget of ₱5,000'));
        $this->assertSame(['title' => 'Fun Run Budget', 'allocated_amount' => '5000', 'warning_threshold' => null], $budget);
    }

    // -------------------------------------------------------------------------
    // Every action, end to end
    // -------------------------------------------------------------------------

    public function test_admin_creates_an_event_with_the_same_status_and_approval_request_as_the_form(): void
    {
        $this->model(['title' => 'General Assembly', 'description' => null, 'start_time' => '2026-12-05T15:00', 'end_time' => '2026-12-05T17:00', 'location' => 'Gym']);
        $admin = $this->admin();
        Sanctum::actingAs($admin);
        $message = $this->ask('create an event General Assembly on Dec 5 3pm to 5pm at the gym');
        $this->assertSame(0, Event::count());

        $response = $this->confirm($message['id'], $this->values($message))->assertOk();

        $event = Event::sole();
        $this->assertSame('General Assembly', $event->title);
        $this->assertSame('planning', $event->status);
        $this->assertSame('Gym', $event->location);
        $this->assertSame('2026-12-05 15:00', $event->start_time->format('Y-m-d H:i'));
        $this->assertSame($admin->organization_id, $event->organization_id);
        $this->assertSame($admin->school_id, (int) $event->created_by);
        $approval = ApprovalRequest::where('entity_type', 'event')->where('entity_id', $event->id)->sole();
        $this->assertSame('DEPARTMENT_HEAD', $approval->required_role);

        $action = $response->json('message.payload.action');
        $this->assertSame('done', $action['status']);
        $this->assertSame('Event created. It is waiting for approval.', $action['result']['message']);
        $this->assertSame('/dashboard/events/manage-events', $action['result']['href']);
        $this->assertSame('Open events', $action['result']['action_label']);
        $this->assertSame('Event created. It is waiting for approval.', $response->json('message.content'));
        $this->assertSame('Event created. It is waiting for approval.', AiMessage::find($message['id'])->content);
    }

    public function test_admin_creates_a_task_for_an_eligible_officer(): void
    {
        $org = Organization::factory()->create();
        SboPosition::create(['organization_id' => $org->id, 'role' => 'SBO_OFFICER', 'title' => 'Secretary', 'is_active' => true]);
        $officer = User::factory()->officer()->create(['organization_id' => $org->id, 'first_name' => 'Ana', 'last_name' => 'Cruz', 'position_title' => 'Secretary', 'account_status' => 'active']);
        User::factory()->officer()->create(['organization_id' => $org->id, 'position_title' => 'Secretary', 'account_status' => 'disabled']);
        $due = now()->addWeek()->format('Y-m-d');
        $this->model(['title' => 'Prepare minutes', 'description' => null, 'deadline' => $due, 'assigned_to' => (string) $officer->school_id]);
        $admin = $this->admin($org);
        Sanctum::actingAs($admin);

        $message = $this->ask('create a task Prepare minutes for Ana Cruz');

        $assignee = collect($message['payload']['action']['fields'])->firstWhere('name', 'assigned_to');
        $this->assertSame([['value' => (string) $officer->school_id, 'label' => 'Ana Cruz, Secretary']], $assignee['options']);
        $this->assertSame((string) $officer->school_id, $assignee['value']);
        $this->assertSame(0, Task::count());

        $response = $this->confirm($message['id'], $this->values($message))->assertOk();

        $task = Task::sole();
        $this->assertSame('Prepare minutes', $task->title);
        $this->assertSame('pending', $task->status);
        $this->assertSame($officer->school_id, (int) $task->assigned_to);
        $this->assertSame($org->id, $task->organization_id);
        $this->assertSame($admin->school_id, (int) $task->created_by);
        $this->assertSame('Task created and assigned to Ana Cruz.', $response->json('message.payload.action.result.message'));
        $this->assertSame('/dashboard/tasks/task-board', $response->json('message.payload.action.result.href'));
    }

    public function test_an_assignee_outside_the_options_is_refused_on_the_assignee_field(): void
    {
        $org = Organization::factory()->create();
        $stranger = User::factory()->officer()->create(['organization_id' => Organization::factory()->create()->id, 'position_title' => 'Secretary']);
        Sanctum::actingAs($this->admin($org));
        $message = $this->ask('create a task called Prepare minutes');

        $this->confirm($message['id'], ['title' => 'Prepare minutes', 'deadline' => now()->addWeek()->format('Y-m-d'), 'assigned_to' => (string) $stranger->school_id])
            ->assertUnprocessable()->assertJsonPath('errors.assigned_to.0', 'Choose one of the listed options.');
        $this->assertSame(0, Task::count());
    }

    public function test_admin_proposes_a_budget_that_waits_for_approval(): void
    {
        $admin = $this->admin();
        Sanctum::actingAs($admin);
        $message = $this->ask('propose a budget called Fun Run Budget for 5000 pesos');

        $response = $this->confirm($message['id'], [...$this->values($message), 'warning_threshold' => '4000'])->assertOk();

        $budget = Budget::sole();
        $this->assertSame('Fun Run Budget', $budget->title);
        $this->assertEquals(5000, $budget->allocated_amount);
        $this->assertEquals(5000, $budget->remaining_amount);
        $this->assertEquals(4000, $budget->warning_threshold);
        $this->assertSame('pending_department_head', $budget->submission_status);
        $this->assertSame($admin->organization_id, $budget->organization_id);
        $this->assertSame('DEPARTMENT_HEAD', ApprovalRequest::where('entity_type', 'budget')->where('entity_id', $budget->id)->sole()->required_role);
        $this->assertSame('Budget proposed. It is waiting for approval.', $response->json('message.payload.action.result.message'));
        $this->assertSame('/dashboard/finance/budget-allocation', $response->json('message.payload.action.result.href'));
    }

    public function test_the_route_validation_errors_come_back_on_the_right_fields_and_keep_the_values(): void
    {
        Sanctum::actingAs($this->admin());
        $budget = $this->ask('propose a budget called Fun Run Budget');

        $response = $this->confirm($budget['id'], ['title' => 'Fun Run Budget', 'allocated_amount' => '1000', 'warning_threshold' => '5000'])->assertUnprocessable();

        $this->assertArrayHasKey('warning_threshold', $response->json('errors'));
        $this->assertArrayNotHasKey('allocated_amount', $response->json('errors'));
        $action = $response->json('assistant_message.payload.action');
        $this->assertSame('awaiting_confirmation', $action['status']);
        $this->assertSame($response->json('errors'), $action['errors']);
        $this->assertSame(['title' => 'Fun Run Budget', 'allocated_amount' => '1000', 'warning_threshold' => '5000'], $this->values($response->json('assistant_message')));
        $this->assertSame(0, Budget::count());

        $event = $this->ask('create an event called Fun Run');
        $response = $this->confirm($event['id'], ['title' => 'Fun Run', 'start_time' => '2026-12-05T17:00', 'end_time' => '2026-12-05T15:00'])->assertUnprocessable();
        $this->assertArrayHasKey('end_time', $response->json('errors'));
        $this->assertSame('2026-12-05T15:00', $this->values($response->json('assistant_message'))['end_time']);

        $this->confirm($event['id'], ['title' => 'Fun Run', 'start_time' => '2026-12-05T15:00', 'end_time' => '2026-12-05T17:00'])->assertOk();
        $this->assertSame(1, Event::count());
    }

    public function test_an_error_that_belongs_to_no_field_is_kept_under_the_underscore_key(): void
    {
        $actions = app(AskAiActions::class);
        $definition = $actions->definitionFor(new User(['role' => 'ADMIN']), 'create_event');
        $method = new \ReflectionMethod($actions, 'fieldErrors');

        $this->assertSame(['_' => ['Event dates must fall within the academic semester.']], $method->invoke($actions, $definition, ['message' => 'Event dates must fall within the academic semester.']));
        $this->assertSame(['end_time' => ['Bad.'], '_' => ['Other.']], $method->invoke($actions, $definition, ['errors' => ['end_time' => ['Bad.'], 'planning_details.venue_id' => ['Other.']]]));
    }

    public function test_admin_drafts_an_announcement_that_is_never_published(): void
    {
        $admin = $this->admin();
        Sanctum::actingAs($admin);
        $message = $this->ask('draft an announcement called "Enrollment Reminder" for students');

        $this->assertStringContainsString('draft', $message['content']);
        $response = $this->confirm($message['id'], ['title' => 'Enrollment Reminder', 'body' => 'Enrollment closes Friday.', 'target_role' => 'STUDENT', 'category' => 'general'])->assertOk();

        $announcement = Announcement::sole();
        $this->assertFalse((bool) $announcement->is_published);
        $this->assertSame('draft', $announcement->approval_status);
        $this->assertSame('STUDENT', $announcement->target_role);
        $this->assertNull($announcement->published_at);
        $this->assertSame($admin->organization_id, $announcement->organization_id);
        $this->assertSame(0, ApprovalRequest::count());
        $this->assertStringContainsString('not published', $response->json('message.payload.action.result.message'));
        $this->assertSame('/dashboard/announcements/manage-announcements', $response->json('message.payload.action.result.href'));
    }

    public function test_officer_announcement_goes_through_the_officers_approval_flow(): void
    {
        $org = Organization::factory()->create();
        $officer = User::factory()->officer()->create(['organization_id' => $org->id]);
        Sanctum::actingAs($officer);
        $message = $this->ask('pls write an announcement about the meeting');

        $this->assertStringContainsString('approval', $message['content']);
        $response = $this->confirm($message['id'], ['title' => 'Meeting', 'body' => 'We meet Monday.', 'target_role' => 'all'])->assertOk();

        $announcement = Announcement::sole();
        $this->assertFalse((bool) $announcement->is_published);
        $this->assertSame('pending', $announcement->approval_status);
        $approval = ApprovalRequest::where('entity_type', 'announcement')->where('entity_id', $announcement->id)->sole();
        $this->assertSame('ADMIN', $approval->required_role);
        $this->assertSame($officer->school_id, (int) $approval->requested_by);
        $this->assertStringContainsString('approval', $response->json('message.payload.action.result.message'));
    }

    public function test_student_files_a_grievance_and_keeps_the_confidentiality_choice(): void
    {
        $org = Organization::factory()->create();
        $student = User::factory()->student()->create(['organization_id' => $org->id]);
        Sanctum::actingAs($student);
        $message = $this->ask('gusto ko mag file ng grievance called "Broken lights"');

        $this->assertSame('file_grievance', $message['payload']['action']['key']);
        $anonymous = collect($message['payload']['action']['fields'])->firstWhere('name', 'is_anonymous');
        $this->assertSame('checkbox', $anonymous['type']);
        $this->assertFalse($anonymous['value']);
        $this->assertSame(0, Grievance::count());

        $response = $this->confirm($message['id'], ['title' => 'Broken lights', 'description' => 'The hallway lights have been off for a week.', 'addressed_to' => 'organization', 'is_anonymous' => true])->assertOk();

        $grievance = Grievance::sole();
        $this->assertSame('Broken lights', $grievance->title);
        $this->assertSame($org->id, $grievance->organization_id);
        $this->assertSame($student->school_id, (int) $grievance->submitted_by);
        $this->assertTrue((bool) $grievance->is_anonymous);
        $this->assertSame('submitted', $grievance->status);
        $this->assertStringContainsString('will not see your name', $response->json('message.payload.action.result.message'));
        $this->assertSame('/dashboard/my-grievances', $response->json('message.payload.action.result.href'));

        $sao = $this->ask('file a complaint called "Late refund"');
        $this->confirm($sao['id'], ['title' => 'Late refund', 'description' => 'The refund took months.', 'addressed_to' => 'sao', 'is_anonymous' => true])->assertOk();
        $filed = Grievance::where('title', 'Late refund')->sole();
        $this->assertNull($filed->organization_id);
        $this->assertFalse((bool) $filed->is_anonymous);
    }

    public function test_dean_lets_a_student_of_the_college_apply_and_is_told_the_sao_decides(): void
    {
        $college = $this->makeCollege('CCS');
        $dean = $this->makeCollegeHead($college);
        $home = Organization::where('organization_type', 'COLLEGE')->where('college_id', $college->id)->firstOrFail();
        $maria = User::factory()->student()->create(['organization_id' => $home->id, 'first_name' => 'Maria', 'last_name' => 'Santos']);
        $other = User::factory()->student()->create(['organization_id' => $home->id, 'first_name' => 'Jose', 'last_name' => 'Reyes']);
        $member = User::factory()->student()->create(['organization_id' => $home->id, 'first_name' => 'Pedro', 'last_name' => 'Cruz']);
        $club = $this->makeCollegeStudentOrganization($college);
        AccountProfile::create(['user_school_id' => $member->school_id, 'organization_id' => $club->id, 'role' => 'STUDENT', 'account_status' => 'active']);
        $outsider = User::factory()->student()->create(['organization_id' => $this->makeCollegeHome($this->makeCollege('CAS'))->id, 'first_name' => 'Maria', 'last_name' => 'Lopez']);
        Sanctum::actingAs($dean);

        $message = $this->ask('i want to start a new student organization, let Maria Santos apply');

        $this->assertSame('allow_applicant', $message['payload']['action']['key']);
        $field = $message['payload']['action']['fields'][0];
        $this->assertSame((string) $maria->school_id, $field['value']);
        $values = array_column($field['options'], 'value');
        $this->assertContains((string) $maria->school_id, $values);
        $this->assertContains((string) $other->school_id, $values);
        $this->assertNotContains((string) $member->school_id, $values, 'a student already in an organization cannot apply again');
        $this->assertNotContains((string) $outsider->school_id, $values, 'another college is never offered');
        $this->assertSame(0, OrganizationApplicantGrant::count());

        $response = $this->confirm($message['id'], ['school_id' => (string) $maria->school_id])->assertOk();

        $grant = OrganizationApplicantGrant::sole();
        $this->assertSame($maria->school_id, (int) $grant->user_school_id);
        $this->assertSame($college->id, $grant->college_id);
        $this->assertSame($dean->school_id, (int) $grant->granted_by);
        $this->assertDatabaseHas('notifications', ['user_id' => $maria->school_id, 'title' => 'You can apply for an organization']);
        $text = $response->json('message.payload.action.result.message');
        $this->assertStringContainsString('Maria Santos', $text);
        $this->assertStringContainsString('SAO decides', $text);
        $this->assertSame('/dashboard/department-head/organizations', $response->json('message.payload.action.result.href'));

        $again = $this->ask('let Maria Santos apply for a new organization');
        $this->assertNotContains((string) $maria->school_id, array_column($again['payload']['action']['fields'][0]['options'], 'value'));
        $this->confirm($again['id'], ['school_id' => (string) $maria->school_id])->assertUnprocessable()->assertJsonPath('errors.school_id.0', 'Choose one of the listed options.');
        $this->assertSame(1, OrganizationApplicantGrant::count());
    }

    public function test_the_sao_adds_a_college_and_invites_its_department_head(): void
    {
        $sao = $this->sao();
        Sanctum::actingAs($sao);
        $message = $this->ask('add a college called College of Law');

        $response = $this->confirm($message['id'], ['name' => 'College of Law', 'code' => 'LAW'])->assertOk();

        $college = College::where('code', 'LAW')->sole();
        $this->assertTrue((bool) $college->is_active);
        $home = Organization::where('college_id', $college->id)->where('organization_type', 'COLLEGE')->sole();
        $this->assertStringContainsString('College of Law', $response->json('message.payload.action.result.message'));
        $this->assertSame('/dashboard/super-admin/colleges', $response->json('message.payload.action.result.href'));
        $this->assertDatabaseHas('audit_logs', ['module' => 'colleges', 'action' => 'created', 'record_id' => $college->id]);
        $this->assertNotNull($home);

        $duplicate = $this->ask('add a college called Another');
        $this->confirm($duplicate['id'], ['name' => 'College of Law', 'code' => 'NEW'])->assertUnprocessable()->assertJsonPath('errors.name.0', fn ($error) => is_string($error));

        $invite = $this->ask('invite a department head to the College of Law');
        $this->assertSame((string) $college->id, $this->values($invite)['college_id']);
        $this->assertSame(0, DepartmentHeadInvitation::count());

        $done = $this->confirm($invite['id'], ['college_id' => (string) $college->id])->assertOk();

        $invitation = DepartmentHeadInvitation::sole();
        $this->assertSame($college->id, $invitation->college_id);
        $this->assertSame('DEPARTMENT_HEAD', $invitation->role);
        $this->assertSame($sao->school_id, (int) $invitation->invited_by);
        $this->assertStringContainsString('accept-invitation', $done->json('message.payload.action.result.message'));
        $this->assertStringContainsString('expires in 48 hours', $done->json('message.payload.action.result.message'));
    }

    // -------------------------------------------------------------------------
    // Confirm and cancel: owner, once, before expiry
    // -------------------------------------------------------------------------

    public function test_confirm_and_cancel_work_only_for_the_owner(): void
    {
        $org = Organization::factory()->create();
        Sanctum::actingAs($this->admin($org));
        $message = $this->ask('create an event called Fun Run');

        Sanctum::actingAs($this->admin($org));
        $this->confirm($message['id'], ['title' => 'Fun Run', 'start_time' => '2026-12-05T15:00', 'end_time' => '2026-12-05T17:00'])->assertNotFound();
        $this->postJson("/api/ai/assistant/messages/{$message['id']}/action/cancel")->assertNotFound();
        $this->assertSame(0, Event::count());
        $this->assertSame('awaiting_confirmation', AiMessage::find($message['id'])->payload['action']['status']);
    }

    public function test_a_message_without_an_action_is_not_found_and_a_user_message_cannot_be_confirmed(): void
    {
        Sanctum::actingAs($this->admin());
        $plain = $this->postJson('/api/ai/assistant/chat', ['message' => 'hello'])->assertOk();

        $this->confirm($plain->json('message.id'))->assertNotFound();
        $this->confirm($plain->json('user_message.id'))->assertNotFound();
    }

    public function test_confirm_runs_only_once(): void
    {
        Sanctum::actingAs($this->admin());
        $message = $this->ask('create an event called Fun Run');
        $fields = ['title' => 'Fun Run', 'start_time' => '2026-12-05T15:00', 'end_time' => '2026-12-05T17:00'];

        $this->confirm($message['id'], $fields)->assertOk();
        $this->confirm($message['id'], $fields)->assertStatus(409);
        $this->postJson("/api/ai/assistant/messages/{$message['id']}/action/cancel")->assertStatus(409);

        $this->assertSame(1, Event::count());
        $this->assertSame(1, ApprovalRequest::where('entity_type', 'event')->count());
        $this->assertSame('done', AiMessage::find($message['id'])->payload['action']['status']);
    }

    public function test_a_press_while_another_is_running_is_refused_and_runs_nothing(): void
    {
        Sanctum::actingAs($this->admin());
        $message = $this->ask('create an event called Fun Run');
        $row = AiMessage::find($message['id']);
        $payload = $row->payload;
        $payload['action']['status'] = 'confirming';
        $row->update(['payload' => $payload]);

        $this->confirm($message['id'], ['title' => 'Fun Run', 'start_time' => '2026-12-05T15:00', 'end_time' => '2026-12-05T17:00'])->assertStatus(409);

        $this->assertSame(0, Event::count());
    }

    public function test_an_expired_action_is_refused_and_marked_expired(): void
    {
        Sanctum::actingAs($this->admin());
        $message = $this->ask('create an event called Fun Run');

        $this->travel(31)->minutes();
        $this->confirm($message['id'], ['title' => 'Fun Run', 'start_time' => '2026-12-05T15:00', 'end_time' => '2026-12-05T17:00'])->assertStatus(409);

        $this->assertSame(0, Event::count());
        $this->assertSame('expired', AiMessage::find($message['id'])->payload['action']['status']);
    }

    public function test_cancel_marks_the_card_cancelled_and_it_can_no_longer_be_confirmed(): void
    {
        Sanctum::actingAs($this->admin());
        $message = $this->ask('create an event called Fun Run');

        $cancelled = $this->postJson("/api/ai/assistant/messages/{$message['id']}/action/cancel")->assertOk();

        $this->assertSame('cancelled', $cancelled->json('message.payload.action.status'));
        $this->confirm($message['id'], ['title' => 'Fun Run', 'start_time' => '2026-12-05T15:00', 'end_time' => '2026-12-05T17:00'])->assertStatus(409);
        $this->assertSame(0, Event::count());
    }

    public function test_only_the_actions_own_field_names_are_read(): void
    {
        $admin = $this->admin();
        Sanctum::actingAs($admin);
        $message = $this->ask('create an event called Fun Run');

        $this->confirm($message['id'], ['title' => 'Fun Run', 'start_time' => '2026-12-05T15:00', 'end_time' => '2026-12-05T17:00', 'status' => 'approved', 'organization_id' => 999, 'created_by' => 1, 'requires_budget' => true])->assertOk();

        $event = Event::sole();
        $this->assertSame('planning', $event->status);
        $this->assertSame($admin->organization_id, $event->organization_id);
        $this->assertFalse((bool) $event->requires_budget);
    }

    // -------------------------------------------------------------------------
    // The internal request really runs the route's middleware
    // -------------------------------------------------------------------------

    public function test_an_officer_the_route_refuses_gets_the_routes_403_as_a_failed_action(): void
    {
        $org = Organization::factory()->create();
        $officer = User::factory()->officer()->create(['organization_id' => $org->id]);
        $officer->accountProfiles()->update(['modules' => ['events']]);
        Sanctum::actingAs($officer);
        $message = $this->ask('draft an announcement called Notice');
        $this->assertSame('draft_announcement', $message['payload']['action']['key']);

        $response = $this->confirm($message['id'], ['title' => 'Notice', 'body' => 'Hello.', 'target_role' => 'all'])->assertOk();

        $action = $response->json('message.payload.action');
        $this->assertSame('failed', $action['status']);
        $this->assertNull($action['result']);
        $this->assertSame('I could not do that. You do not have access to this part of the organization.', $response->json('message.content'));
        $this->assertSame(0, Announcement::count());
        $this->assertSame(0, ApprovalRequest::count());
    }

    public function test_the_deans_staff_are_refused_by_the_dean_only_gate(): void
    {
        $college = $this->makeCollege('CCS');
        $home = $this->makeCollegeHome($college);
        $this->makeCollegeHead($college);
        $staff = User::factory()->admin()->create(['organization_id' => $home->id, 'position_title' => 'College Secretary']);
        $student = User::factory()->student()->create(['organization_id' => $home->id, 'first_name' => 'Maria', 'last_name' => 'Santos']);
        Sanctum::actingAs($staff);
        $message = $this->ask('let Maria Santos apply for a new organization');
        $this->assertSame('allow_applicant', $message['payload']['action']['key']);

        $response = $this->confirm($message['id'], ['school_id' => (string) $student->school_id])->assertOk();

        $this->assertSame('failed', $response->json('message.payload.action.status'));
        $this->assertSame('I could not do that. Only the dean can do this.', $response->json('message.content'));
        $this->assertSame(0, OrganizationApplicantGrant::count());
    }

    public function test_a_college_archived_after_the_proposal_is_no_longer_a_listed_option_and_no_invitation_is_made(): void
    {
        $sao = $this->sao();
        $college = College::create(['name' => 'College of Law', 'code' => 'LAW', 'is_active' => true]);
        $this->makeCollegeHome($college);
        Sanctum::actingAs($sao);
        $message = $this->ask('invite a dean to the College of Law');
        $college->update(['is_active' => false]);

        $this->confirm($message['id'], ['college_id' => (string) $college->id])
            ->assertUnprocessable()->assertJsonPath('errors.college_id.0', 'Choose one of the listed options.');

        $this->assertSame(0, DepartmentHeadInvitation::count());
        $this->assertSame('awaiting_confirmation', AiMessage::find($message['id'])->payload['action']['status']);
    }

    public function test_an_organization_archived_after_the_proposal_is_refused_and_nothing_is_created(): void
    {
        $org = Organization::factory()->create();
        Sanctum::actingAs($this->admin($org));
        $message = $this->ask('create an event called Fun Run');

        $org->update(['lifecycle_status' => 'archived', 'is_active' => false]);
        $this->confirm($message['id'], ['title' => 'Fun Run', 'start_time' => '2026-12-05T15:00', 'end_time' => '2026-12-05T17:00'])->assertForbidden();

        $this->assertSame(0, Event::count());
    }

    public function test_a_server_error_never_leaks_its_message(): void
    {
        $actions = app(AskAiActions::class);
        $method = new \ReflectionMethod($actions, 'failureSentence');

        $this->assertSame('I could not do that. Nothing was confirmed, so check the page before trying again.', $method->invoke($actions, 500, ['message' => 'SQLSTATE[HY000]: secret table users']));
        $this->assertSame('I could not do that. This college is archived.', $method->invoke($actions, 409, ['message' => 'This college is archived.']));
    }

    // -------------------------------------------------------------------------
    // Privacy
    // -------------------------------------------------------------------------

    public function test_nothing_the_person_typed_is_logged(): void
    {
        $path = storage_path('logs/ask-ai-actions-test-'.uniqid().'.log');
        config(['logging.default' => 'single', 'logging.channels.single.path' => $path]);
        $this->model(['title' => 'Zq7Marker Gathering', 'description' => 'Zq7Marker secret detail', 'start_time' => '2026-12-05T15:00', 'end_time' => '2026-12-05T17:00', 'location' => 'Zq7Marker Hall']);
        Sanctum::actingAs($this->admin());

        $message = $this->ask('create an event called Zq7Marker Gathering about Zq7Marker secret detail');
        $this->confirm($message['id'], ['title' => 'Zq7Marker Gathering', 'start_time' => '2026-12-05T17:00', 'end_time' => '2026-12-05T15:00'])->assertUnprocessable();
        $this->confirm($message['id'], $this->values($message))->assertOk();

        $log = is_file($path) ? (string) file_get_contents($path) : '';
        @unlink($path);
        $this->assertStringContainsString('/api/ai/assistant/messages/', $log, 'the log channel under test is capturing');
        $this->assertStringNotContainsString('Zq7Marker', $log);
        $this->assertSame(1, Event::where('title', 'Zq7Marker Gathering')->count());
    }

    private function sao(): User
    {
        $org = Organization::firstOrCreate(
            ['slug' => 'student-affairs-office'],
            ['name' => 'Student Affairs Office', 'acronym' => 'SAO', 'organization_type' => 'UNIVERSITY', 'is_active' => true, 'lifecycle_status' => 'active'],
        );

        return User::factory()->superAdmin()->create(['organization_id' => $org->id]);
    }
}

/** A model that answers the field-extraction call with scripted values and records what it was asked. */
class ActionFieldsFakeGenerator extends AskAiChatFakeGenerator
{
    /** @var array<int, array{instructions: string, input: array, schema: array}> */
    public array $structuredCalls = [];

    public function __construct(public array $structured)
    {
        parent::__construct();
    }

    public function generateStructured(string $instructions, array $input, string $schemaName, array $schema, int $maxOutputTokens = 1800, float $temperature = 0.2): ?array
    {
        $this->structuredCalls[] = ['instructions' => $instructions, 'input' => $input, 'schema' => $schema];

        return ['data' => $this->structured, 'text' => json_encode($this->structured), 'model' => 'claude-test', 'response_id' => null];
    }
}
