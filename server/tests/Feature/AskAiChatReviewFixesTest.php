<?php

namespace Tests\Feature;

use App\Contracts\TextGenerator;
use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\AiConversation;
use App\Models\AiMemory;
use App\Models\AiMessage;
use App\Models\AiOutput;
use App\Models\Organization;
use App\Models\User;
use App\Services\Ai\AskAiChatService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Support\AskAiChatFakeGenerator;
use Tests\TestCase;

/** The cases that go wrong in the Ask AI chat server: numbers, short messages, commands, stopping, limits and the audit trail. */
class AskAiChatReviewFixesTest extends TestCase
{
    use RefreshDatabase;

    private const GUARD_NOTICE = 'The written answer was replaced with the verified summary.';

    protected function setUp(): void
    {
        parent::setUp();
        config(['performance.api_cache.enabled' => false, 'services.groq.key' => '', 'services.anthropic.key' => '']);
    }

    private function admin(): User
    {
        return User::factory()->admin()->create(['organization_id' => Organization::factory()->create()->id]);
    }

    private function fake(array $chunks = ['Fine.'], ?string $reasoning = null): AskAiChatFakeGenerator
    {
        $fake = new AskAiChatFakeGenerator($chunks, $reasoning, 'claude-test');
        $this->app->instance(TextGenerator::class, $fake);

        return $fake;
    }

    /** @param  array<int, array{0: string, 1: string}>  $turns  [role, content] oldest first */
    private function conversationWith(User $user, array $turns): AiConversation
    {
        $conversation = AiConversation::factory()->forUser($user)->create();
        foreach ($turns as [$role, $content]) {
            AiMessage::create(['conversation_id' => $conversation->id, 'role' => $role, 'content' => $content, 'status' => 'completed', 'created_at' => now()]);
        }

        return $conversation;
    }

    private function say(array $body, array $headers = [])
    {
        return $this->postJson('/api/ai/assistant/chat', $body, $headers)->assertOk();
    }

    /** @return array<int, array{event: string, data: array}> */
    private function events(string $body): array
    {
        $events = [];
        foreach (preg_split("/\n\n/", trim($body)) as $block) {
            if (! str_starts_with($block, 'event: ')) {
                continue;
            }
            [$name, $data] = explode("\ndata: ", substr($block, 7), 2);
            $events[] = ['event' => $name, 'data' => json_decode($data, true)];
        }

        return $events;
    }

    // srv-01: the number check holds the facts for this question only

    public function test_a_number_that_only_an_earlier_assistant_turn_carried_is_not_shown_as_checked(): void
    {
        $admin = $this->admin();
        Sanctum::actingAs($admin);
        $this->fake(['Exactly 7777 members owe fees.']);
        $conversation = $this->conversationWith($admin, [['user', 'Which members owe fees?'], ['assistant', 'These 7777 members owe fees.']]);

        $answer = $this->say(['conversation_id' => $conversation->id, 'message' => 'What should I do today?']);

        $answer->assertJsonPath('message.payload.model_written', false)->assertJsonPath('message.payload.notice', self::GUARD_NOTICE);
        $this->assertStringNotContainsString('7777', $answer->json('message.content'));
    }

    public function test_a_number_that_only_an_earlier_user_turn_carried_is_not_shown_as_checked(): void
    {
        $admin = $this->admin();
        Sanctum::actingAs($admin);
        $this->fake(['Exactly 8888 pesos are left.']);
        $conversation = $this->conversationWith($admin, [['user', 'I think we collected 8888 pesos.'], ['assistant', 'Noted.']]);

        $this->say(['conversation_id' => $conversation->id, 'message' => 'What should I do today?'])
            ->assertJsonPath('message.payload.model_written', false)
            ->assertJsonPath('message.payload.notice', self::GUARD_NOTICE);
    }

    public function test_a_number_that_only_a_memory_carried_is_not_shown_as_checked(): void
    {
        $admin = $this->admin();
        Sanctum::actingAs($admin);
        $this->fake(['Your balance is PHP 55,555.55.']);
        AiMemory::remember($admin, 'the old treasurer mentioned 55,555.55');

        $this->say(['message' => 'What should I do today?'])
            ->assertJsonPath('message.payload.model_written', false)
            ->assertJsonPath('message.payload.notice', self::GUARD_NOTICE);
    }

    public function test_a_figure_typed_in_this_question_can_still_be_repeated(): void
    {
        $admin = $this->admin();
        Sanctum::actingAs($admin);
        $this->fake(['You mentioned 4242 pesos.']);

        $this->say(['message' => 'What should I do today with 4242 pesos?'])
            ->assertJsonPath('message.payload.model_written', true)
            ->assertJsonPath('message.payload.notice', null);
    }

    // srv-02: shortness alone does not reuse the previous answer's records

    public function test_a_short_question_on_a_new_subject_is_not_answered_with_the_previous_records(): void
    {
        $admin = $this->admin();
        Sanctum::actingAs($admin);
        $this->fake();

        $id = $this->say(['message' => 'How is our budget doing this semester'])->assertJsonPath('message.payload.intent', 'finance_health')->json('conversation.id');

        foreach (['who is the adviser?', 'list all officers'] as $question) {
            $intent = $this->say(['conversation_id' => $id, 'message' => $question])->json('message.payload.intent');
            $this->assertNotSame('finance_health', $intent, $question);
        }
    }

    public function test_an_acknowledgement_is_answered_locally_and_a_thanks_in_between_keeps_the_subject(): void
    {
        $admin = $this->admin();
        Sanctum::actingAs($admin);
        $fake = $this->fake();

        $id = $this->say(['message' => 'How is our budget doing this semester'])->json('conversation.id');
        $calls = count($fake->calls);

        $this->say(['conversation_id' => $id, 'message' => 'ok thanks'])->assertJsonPath('message.payload.intent', 'greeting');
        $this->say(['conversation_id' => $id, 'message' => 'thanks'])->assertJsonPath('message.payload.intent', 'greeting');
        $this->assertCount($calls, $fake->calls);

        $this->say(['conversation_id' => $id, 'message' => 'why?'])->assertJsonPath('message.payload.intent', 'finance_health');
    }

    // srv-03: memory and capabilities commands are whole messages, not words inside a question

    public function test_ordinary_questions_never_wipe_save_or_list_memory_or_list_capabilities(): void
    {
        $admin = $this->admin();
        Sanctum::actingAs($admin);
        $this->fake();
        AiMemory::remember($admin, 'I am the treasurer');

        $id = null;
        foreach ([
            'How do I make officers not forget all their tasks?',
            'remember that event last week?',
            'Remember when the fee was due?',
            'what can you do about unpaid fees?',
            'What do you do when a member has not paid?',
            'who are you voting for?',
            'what do you remember about the budget hearing?',
        ] as $question) {
            $response = $this->say(['conversation_id' => $id, 'message' => $question]);
            $id = $response->json('conversation.id');
            $this->assertNotContains($response->json('message.payload.intent'), ['memory', 'capabilities'], $question);
        }

        $this->assertSame(['I am the treasurer'], AiMemory::ownedBy($admin)->pluck('content')->all());
    }

    public function test_the_whole_message_commands_still_work(): void
    {
        $admin = $this->admin();
        Sanctum::actingAs($admin);
        $this->fake();

        $this->say(['message' => 'remember that I am the treasurer'])->assertJsonPath('message.payload.intent', 'memory');
        $this->assertSame(1, AiMemory::ownedBy($admin)->count());
        $this->say(['message' => 'What can you do?'])->assertJsonPath('message.payload.intent', 'capabilities');
        $this->say(['message' => 'forget everything'])->assertJsonPath('message.payload.intent', 'memory');
        $this->assertSame(0, AiMemory::ownedBy($admin)->count());
    }

    // srv-04: a stop is noticed while the model is thinking or inside a long chunk

    public function test_a_stop_during_a_long_chunk_ends_before_the_rest_of_it_is_released(): void
    {
        $admin = $this->admin();
        $this->fake(["First line.\nSecond line.\nThird line.\n"]);
        $probes = 0;
        $emitted = [];

        $result = app(AskAiChatService::class)->respond(
            $admin, null, 'What should I do today?', null, false,
            function (string $event, array $data) use (&$emitted): void {
                $emitted[] = [$event, $data];
            },
            function () use (&$probes): bool {
                return ++$probes >= 3;
            },
        );

        $deltas = implode('', array_map(fn ($e) => $e[1]['text'], array_filter($emitted, fn ($e) => $e[0] === 'delta')));
        $this->assertSame('First line.', $deltas);
        $this->assertSame('First line.', $result['message']['content']);
        $this->assertSame('stopped', $result['message']['status']);
        $this->assertContains('Writing stopped before the end; kept the checked part', $result['message']['payload']['reasoning']['steps']);
    }

    public function test_a_stop_while_the_model_only_thinks_stores_nothing_and_releases_no_text(): void
    {
        $admin = $this->admin();
        $this->fake(["Answer line.\n"], 'Still thinking about the records without ending a line');
        $probes = 0;
        $emitted = [];

        $result = app(AskAiChatService::class)->respond(
            $admin, null, 'What should I do today?', null, false,
            function (string $event, array $data) use (&$emitted): void {
                $emitted[] = $event;
            },
            function () use (&$probes): bool {
                return ++$probes >= 2;
            },
        );

        $this->assertNull($result['message']);
        $this->assertNotContains('delta', $emitted);
        $this->assertSame(0, AiMessage::where('role', 'assistant')->count());
    }

    public function test_a_quiet_stream_sends_a_keep_alive_comment_so_a_proxy_and_a_gone_client_are_noticed(): void
    {
        $admin = $this->admin();
        Sanctum::actingAs($admin);
        $fake = $this->fake(["One.\n", "Two.\n"]);
        $fake->afterChunk = function (int $index): void {
            if ($index === 0) {
                usleep(3_300_000);
            }
        };

        $body = $this->postJson('/api/ai/assistant/chat', ['message' => 'What should I do today?'], ['Accept' => 'text/event-stream'])->assertOk()->streamedContent();

        $this->assertStringContainsString(": keep-alive\n\n", $body);
        $this->assertSame('done', last($this->events($body))['event']);
    }

    // srv-05: chat has its own limit, and the generation routes keep theirs

    public function test_more_than_five_chat_messages_a_minute_are_answered_and_generation_keeps_its_own_allowance(): void
    {
        $admin = $this->admin();
        Sanctum::actingAs($admin);
        $this->fake();

        $id = null;
        for ($i = 0; $i < 6; $i++) {
            $id = $this->say(['conversation_id' => $id, 'message' => 'hello'])->json('conversation.id');
        }

        for ($i = 0; $i < 5; $i++) {
            $this->assertNotSame(429, $this->postJson('/api/announcements/generate-draft', [])->status());
        }
        $this->postJson('/api/announcements/generate-draft', [])->assertStatus(429);
    }

    public function test_the_chat_limit_answers_with_a_json_message(): void
    {
        Sanctum::actingAs($this->admin());
        $this->fake();
        config(['performance.rate_limits.ai_chat_per_minute' => 2]);

        $this->say(['message' => 'hello']);
        $this->say(['message' => 'hello']);
        $this->postJson('/api/ai/assistant/chat', ['message' => 'hello'])->assertStatus(429)->assertJsonStructure(['message']);
    }

    // srv-06: the model is told the period the records were read for

    public function test_the_facts_name_the_selected_semester_and_say_when_it_is_not_the_current_one(): void
    {
        $admin = $this->admin();
        Sanctum::actingAs($admin);
        $fake = $this->fake();
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-08-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 2, 'starts_on' => '2027-01-01', 'ends_on' => '2027-05-31', 'status' => 'active']);
        $closed = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'completed']);

        $this->say(['message' => 'What should I do today?']);
        $this->assertStringContainsString('"semester":"AY 2026-2027 · 2nd Semester"', $fake->lastUserTurn());

        $this->say(['message' => 'What should I do today?'], ['X-Academic-Semester' => (string) $closed->id]);
        $this->assertStringContainsString('"semester":"AY 2026-2027 · 1st Semester (not the current semester)"', $fake->lastUserTurn());
    }

    // srv-07: a request that was carried out is never offered again by a regenerate

    public function test_regenerate_refuses_an_action_card_that_was_carried_out_or_is_being_carried_out(): void
    {
        $admin = $this->admin();
        Sanctum::actingAs($admin);
        $fake = $this->fake();

        foreach (['done', 'confirming', 'awaiting_confirmation'] as $status) {
            $conversation = $this->conversationWith($admin, [['user', 'I want to create an event called General Assembly']]);
            $card = AiMessage::create([
                'conversation_id' => $conversation->id, 'role' => 'assistant', 'content' => 'Create the event General Assembly?', 'status' => 'completed',
                'payload' => ['intent' => 'create_event', 'action' => ['key' => 'create_event', 'status' => $status]], 'created_at' => now(),
            ]);

            foreach ([[], ['Accept' => 'text/event-stream']] as $headers) {
                $this->postJson('/api/ai/assistant/chat', ['conversation_id' => $conversation->id, 'regenerate' => true], $headers)
                    ->assertStatus(422)->assertJsonStructure(['message', 'errors' => ['regenerate']]);
            }

            $this->assertSame($status, $card->fresh()->payload['action']['status']);
            $this->assertSame(2, $conversation->messages()->count());
        }
        $this->assertCount(0, $fake->calls);
    }

    // srv-08: the thinking arrives as it is written, not after the answer

    public function test_thinking_without_a_newline_reaches_the_client_before_the_first_answer_text(): void
    {
        Sanctum::actingAs($this->admin());
        $this->fake(["The answer.\n", 'Done.'], 'Checking the records. Reading the open tasks');

        $body = $this->postJson('/api/ai/assistant/chat', ['message' => 'What should I do today?'], ['Accept' => 'text/event-stream'])->assertOk()->streamedContent();
        $events = $this->events($body);
        $names = array_column($events, 'event');

        $firstDelta = array_search('delta', $names, true);
        $thinking = array_keys(array_filter($names, fn ($name) => $name === 'reasoning'));
        $this->assertNotEmpty($thinking);
        $this->assertLessThan($firstDelta, max($thinking));
        $this->assertSame('Checking the records. Reading the open tasks', implode('', array_map(fn ($i) => $events[$i]['data']['delta'], $thinking)));
        $this->assertSame('Checking the records. Reading the open tasks', last($events)['data']['message']['payload']['reasoning']['summary']);
    }

    // srv-10: regenerate keeps the audit row, deleting the conversation takes it, an action is audited without its values

    public function test_regenerate_keeps_the_replaced_audit_row_until_the_conversation_is_deleted(): void
    {
        Sanctum::actingAs($this->admin());
        $this->fake();

        $id = $this->say(['message' => 'What should I do today?'])->json('conversation.id');
        $this->say(['conversation_id' => $id, 'regenerate' => true]);
        $this->assertSame(['accepted', 'superseded'], AiOutput::orderBy('id')->pluck('decision_status')->sort()->values()->all());

        $this->deleteJson('/api/ai/assistant/conversations/'.$id)->assertOk();
        $this->assertSame(0, AiOutput::where('feature_type', 'ASK_AI_ASSISTANT')->count());
    }

    public function test_a_carried_out_action_is_audited_by_key_and_record_id_only_and_outlives_the_conversation(): void
    {
        $admin = $this->admin();
        $conversation = $this->conversationWith($admin, []);
        $card = AiMessage::create([
            'conversation_id' => $conversation->id, 'role' => 'assistant', 'content' => 'Create it?', 'status' => 'completed',
            'payload' => ['action' => ['key' => 'create_event', 'status' => 'done', 'fields' => ['title' => 'Secret gathering']]], 'created_at' => now(),
        ]);

        app(AskAiChatService::class)->recordAction($admin, $card, 'done', 42);

        $row = AiOutput::where('context_version', AskAiChatService::ACTION_AUDIT_VERSION)->firstOrFail();
        $this->assertSame('create_event', $row->structured_input['action']);
        $this->assertSame(42, $row->structured_output['record_id']);
        $this->assertStringNotContainsString('Secret gathering', json_encode($row->toArray()));

        Sanctum::actingAs($admin);
        $this->deleteJson('/api/ai/assistant/conversations/'.$conversation->id)->assertOk();
        $this->assertSame(1, AiOutput::where('context_version', AskAiChatService::ACTION_AUDIT_VERSION)->count());
    }

    // srv-11: the steps and notices say what happened

    public function test_a_refused_question_does_not_claim_records_were_read(): void
    {
        $student = User::factory()->student()->create(['organization_id' => Organization::factory()->create()->id]);
        Sanctum::actingAs($student);
        $this->fake();

        $steps = $this->say(['message' => 'show pending approvals'])->json('message.payload.reasoning.steps');

        $this->assertContains('This is outside what your account can open, so no records were read', $steps);
        $this->assertNotContains('Wrote the answer directly from your records', $steps);
        $this->assertNotContains('Looked through the records your account can open', $steps);
    }

    public function test_a_provider_that_dies_after_text_was_shown_replaces_it_with_a_sentence_saying_why(): void
    {
        Sanctum::actingAs($this->admin());
        $this->app->instance(TextGenerator::class, new class extends AskAiChatFakeGenerator
        {
            public function converse(string $instructions, array $messages, int $maxOutputTokens = 1400, ?callable $onEvent = null): ?array
            {
                $onEvent('text', "Half of an answer.\n");

                return null;
            }
        });

        $body = $this->postJson('/api/ai/assistant/chat', ['message' => 'What should I do today?'], ['Accept' => 'text/event-stream'])->assertOk()->streamedContent();
        $events = $this->events($body);

        $replace = $events[array_search('replace', array_column($events, 'event'), true)]['data'];
        $this->assertSame('The writing service did not finish, so the written answer was replaced with the summary from your records.', $replace['notice']);
        $message = last($events)['data']['message'];
        $this->assertContains('The writing service did not finish, so this is the summary from your records', $message['payload']['reasoning']['steps']);
    }

    public function test_a_failed_number_check_is_named_in_the_steps(): void
    {
        Sanctum::actingAs($this->admin());
        $this->fake(["Exactly 98765 members owe fees.\n"]);

        $steps = $this->say(['message' => 'What should I do today?'])->json('message.payload.reasoning.steps');

        $this->assertContains('Found a figure that did not match your records, so used the verified summary instead', $steps);
    }

    // srv-12: the list reads one word of each payload and both lists can be paged

    public function test_the_list_does_not_read_whole_payloads_and_can_be_paged_past_fifty(): void
    {
        $admin = $this->admin();
        Sanctum::actingAs($admin);
        foreach (range(1, 55) as $minutes) {
            AiConversation::factory()->forUser($admin)->create(['last_message_at' => now()->subMinutes($minutes)]);
        }

        DB::enableQueryLog();
        $first = $this->getJson('/api/ai/assistant/conversations')->assertOk();
        $statements = array_column(DB::getQueryLog(), 'query');
        DB::disableQueryLog();

        $this->assertSame([], array_values(array_filter($statements, fn (string $sql) => preg_match('/select\s+[`"]?payload[`"]?\s+from/i', $sql) === 1)));
        $first->assertJsonCount(50, 'data')->assertJsonPath('has_more', true);

        $rest = $this->getJson('/api/ai/assistant/conversations?before='.$first->json('next_before'))->assertOk();
        $rest->assertJsonCount(5, 'data')->assertJsonPath('has_more', false)->assertJsonPath('next_before', null);
        $this->assertSame([], array_intersect(array_column($first->json('data'), 'id'), array_column($rest->json('data'), 'id')));
    }

    public function test_a_long_conversation_returns_its_latest_hundred_messages_and_older_ones_on_request(): void
    {
        $admin = $this->admin();
        Sanctum::actingAs($admin);
        $conversation = AiConversation::factory()->forUser($admin)->create();
        foreach (range(1, 105) as $number) {
            AiMessage::create(['conversation_id' => $conversation->id, 'role' => $number % 2 === 1 ? 'user' : 'assistant', 'content' => "message {$number}", 'status' => 'completed', 'created_at' => now()]);
        }

        $latest = $this->getJson('/api/ai/assistant/conversations/'.$conversation->id)->assertOk();
        $latest->assertJsonCount(100, 'messages')->assertJsonPath('has_more', true)->assertJsonPath('messages.0.content', 'message 6')->assertJsonPath('messages.99.content', 'message 105');

        $older = $this->getJson('/api/ai/assistant/conversations/'.$conversation->id.'?before='.$latest->json('messages.0.id'))->assertOk();
        $older->assertJsonCount(5, 'messages')->assertJsonPath('has_more', false)->assertJsonPath('messages.0.content', 'message 1');
    }

    // srv-13: regenerate answers the last question and keeps every earlier turn

    public function test_regenerate_keeps_earlier_answers_and_answers_only_the_last_question(): void
    {
        $admin = $this->admin();
        Sanctum::actingAs($admin);
        $this->fake();

        $id = $this->say(['message' => 'What should I do today?'])->json('conversation.id');
        $first = AiMessage::where('role', 'assistant')->first();
        $this->say(['conversation_id' => $id, 'message' => 'How is our budget doing this semester'])->assertJsonPath('conversation.message_count', 4);

        $last = AiMessage::where('role', 'assistant')->orderByDesc('id')->first();
        $response = $this->say(['conversation_id' => $id, 'regenerate' => true]);

        $response->assertJsonPath('user_message.content', 'How is our budget doing this semester')->assertJsonPath('conversation.message_count', 4);
        $this->assertNotNull(AiMessage::find($first->id));
        $this->assertNull(AiMessage::find($last->id));
        $this->assertSame(['user', 'assistant', 'user', 'assistant'], AiMessage::orderBy('id')->pluck('role')->all());
    }
}
