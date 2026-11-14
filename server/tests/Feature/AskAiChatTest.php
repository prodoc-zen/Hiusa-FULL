<?php

namespace Tests\Feature;

use App\Contracts\TextGenerator;
use App\Models\AiConversation;
use App\Models\AiMemory;
use App\Models\AiMessage;
use App\Models\AiOutput;
use App\Models\Organization;
use App\Models\User;
use App\Services\Ai\AskAiChatService;
use App\Services\Dashboard\ClientRouteAccess;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\Support\AskAiChatFakeGenerator;
use Tests\TestCase;

class AskAiChatTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['performance.api_cache.enabled' => false, 'services.groq.key' => '', 'services.anthropic.key' => '']);
    }

    private function admin(?Organization $org = null): User
    {
        $org ??= Organization::factory()->create();

        return User::factory()->admin()->create(['organization_id' => $org->id]);
    }

    private function fake(array $chunks = [], ?string $reasoning = null, bool $fails = false): AskAiChatFakeGenerator
    {
        $fake = new AskAiChatFakeGenerator($chunks, $reasoning, 'claude-test', $fails);
        $this->app->instance(TextGenerator::class, $fake);

        return $fake;
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

    private function stream(array $body): array
    {
        $response = $this->postJson('/api/ai/assistant/chat', $body, ['Accept' => 'text/event-stream']);
        $response->assertOk();

        return [$response, $this->events($response->streamedContent())];
    }

    public function test_every_route_needs_a_signed_in_user_with_an_allowed_role(): void
    {
        foreach ([
            ['getJson', '/api/ai/assistant/conversations'],
            ['postJson', '/api/ai/assistant/chat'],
            ['getJson', '/api/ai/assistant/conversations/1'],
            ['patchJson', '/api/ai/assistant/conversations/1'],
            ['deleteJson', '/api/ai/assistant/conversations/1'],
            ['deleteJson', '/api/ai/assistant/conversations'],
            ['postJson', '/api/ai/assistant/messages/1/feedback'],
            ['getJson', '/api/ai/assistant/memories'],
            ['postJson', '/api/ai/assistant/memories'],
            ['deleteJson', '/api/ai/assistant/memories/1'],
            ['deleteJson', '/api/ai/assistant/memories'],
        ] as [$method, $path]) {
            $this->{$method}($path)->assertStatus(401);
        }

        Sanctum::actingAs(User::factory()->adviser()->create(['role' => 'ADVISER']));
        $this->getJson('/api/ai/assistant/conversations')->assertStatus(403);
        $this->postJson('/api/ai/assistant/chat', ['message' => 'hello there'])->assertStatus(403);
    }

    public function test_chat_validates_the_message_and_regenerate_rules(): void
    {
        $admin = $this->admin();
        Sanctum::actingAs($admin);
        $this->fake();

        $this->postJson('/api/ai/assistant/chat', [])->assertStatus(422)->assertJsonValidationErrors(['message']);
        $this->postJson('/api/ai/assistant/chat', ['message' => '   '])->assertStatus(422)->assertJsonValidationErrors(['message']);
        $this->postJson('/api/ai/assistant/chat', ['message' => str_repeat('a', 2001)])->assertStatus(422)->assertJsonValidationErrors(['message']);
        $this->postJson('/api/ai/assistant/chat', ['message' => 'hi', 'topic' => str_repeat('t', 61)])->assertStatus(422)->assertJsonValidationErrors(['topic']);
        $this->postJson('/api/ai/assistant/chat', ['regenerate' => true])->assertStatus(422)->assertJsonValidationErrors(['conversation_id']);
        $this->postJson('/api/ai/assistant/chat', ['message' => 'hello', 'conversation_id' => 999999])->assertStatus(404);

        $empty = AiConversation::factory()->forUser($admin)->create();
        $this->postJson('/api/ai/assistant/chat', ['conversation_id' => $empty->id, 'regenerate' => true])->assertStatus(422)->assertJsonValidationErrors(['regenerate']);
    }

    public function test_the_first_message_creates_a_titled_conversation_and_answers_in_json(): void
    {
        $admin = $this->admin();
        Sanctum::actingAs($admin);
        $fake = $this->fake(["You have nothing urgent today.\n", 'Open Ask AI when you are ready.']);

        $response = $this->postJson('/api/ai/assistant/chat', ['message' => 'What should I do today?'])->assertOk();

        $response->assertJsonStructure([
            'conversation' => ['id', 'title', 'last_message_at', 'preview', 'message_count'],
            'user_message' => ['id', 'conversation_id', 'role', 'content', 'status', 'feedback', 'created_at', 'payload'],
            'message' => ['id', 'conversation_id', 'role', 'content', 'status', 'feedback', 'created_at', 'payload' => ['title', 'intent', 'engine', 'model_written', 'highlights', 'sections', 'charts', 'recommended_action', 'follow_ups', 'reasoning' => ['seconds', 'steps', 'summary'], 'notice']],
        ]);
        $response->assertJsonPath('conversation.title', 'What should I do today');
        $response->assertJsonPath('conversation.message_count', 2);
        $response->assertJsonPath('user_message.role', 'user');
        $response->assertJsonPath('user_message.payload', null);
        $response->assertJsonPath('message.role', 'assistant');
        $response->assertJsonPath('message.payload.engine', 'claude');
        $response->assertJsonPath('message.payload.model_written', true);
        $response->assertJsonPath('message.content', "You have nothing urgent today.\nOpen Ask AI when you are ready.");
        $this->assertCount(1, $fake->calls);
        $this->assertDatabaseHas('ai_outputs', ['requested_by' => $admin->school_id, 'feature_type' => 'ASK_AI_ASSISTANT', 'context_version' => 'ask-ai-chat-v1']);
        $this->assertSame(AiOutput::where('feature_type', 'ASK_AI_ASSISTANT')->value('id'), AiMessage::where('role', 'assistant')->value('ai_output_id'));
    }

    public function test_a_long_first_message_gets_a_title_cut_on_a_word_boundary(): void
    {
        Sanctum::actingAs($this->admin());
        $this->fake(['Fine.']);

        $message = 'Please walk me through every requirement our organization still has to submit before the accreditation deadline arrives';
        $title = $this->postJson('/api/ai/assistant/chat', ['message' => $message])->assertOk()->json('conversation.title');

        $this->assertLessThanOrEqual(80, mb_strlen($title));
        $this->assertStringStartsWith('Please walk me through every requirement', $title);
        $this->assertStringNotContainsString('accreditation deadline arrives', $title);
        $this->assertSame($title, rtrim($title, ' .,;:!?'));
        $this->assertTrue(str_contains($message, $title));
    }

    public function test_the_stream_emits_meta_status_delta_and_done_and_the_deltas_equal_the_stored_text(): void
    {
        $admin = $this->admin();
        Sanctum::actingAs($admin);
        $this->fake(["First line of the answer.\n", "\n", "- A bullet point\n", 'Last line [Ask AI](/dashboard/ask-ai).'], 'Looking at the records.');

        [$response, $events] = $this->stream(['message' => 'What should I do today?']);

        $response->assertHeader('X-Accel-Buffering', 'no');
        $response->assertHeader('Connection', 'keep-alive');
        $this->assertStringContainsString('no-cache', (string) $response->headers->get('Cache-Control'));
        $this->assertStringContainsString('no-transform', (string) $response->headers->get('Cache-Control'));
        $this->assertStringStartsWith('text/event-stream', (string) $response->headers->get('Content-Type'));

        $names = array_column($events, 'event');
        $this->assertSame('meta', $names[0]);
        $this->assertSame('done', $names[array_key_last($names)]);
        $this->assertSame(['reading', 'thinking', 'writing'], array_values(array_map(fn ($e) => $e['data']['stage'], array_filter($events, fn ($e) => $e['event'] === 'status'))));
        $this->assertLessThan(array_search('delta', $names, true), array_search('status', $names, true));
        $this->assertContains('reasoning', $names);
        $this->assertNotContains('replace', $names);
        $this->assertNotContains('error', $names);

        $joined = implode('', array_map(fn ($e) => $e['data']['text'], array_filter($events, fn ($e) => $e['event'] === 'delta')));
        $done = $events[array_key_last($events)]['data'];
        $this->assertSame($joined, $done['message']['content']);
        $this->assertSame("First line of the answer.\n\n- A bullet point\nLast line [Ask AI](/dashboard/ask-ai).", $joined);
        $this->assertSame('Looking at the records.', $done['message']['payload']['reasoning']['summary']);
        $this->assertSame($events[0]['data']['conversation']['id'], $done['conversation']['id']);
        $this->assertSame('What should I do today?', $events[0]['data']['user_message']['content']);
        $this->assertSame(AiMessage::where('role', 'assistant')->value('content'), $done['message']['content']);
    }

    public function test_a_follow_up_reuses_the_previous_intent_and_history_is_sent_oldest_first(): void
    {
        $admin = $this->admin();
        Sanctum::actingAs($admin);
        $fake = $this->fake(['Answer one.']);

        $first = $this->postJson('/api/ai/assistant/chat', ['message' => "Who hasn't submitted compliance requirements?"])->assertOk();
        $first->assertJsonPath('message.payload.intent', 'missing_submissions');

        $second = $this->postJson('/api/ai/assistant/chat', ['conversation_id' => $first->json('conversation.id'), 'message' => 'tell me more about that'])->assertOk();
        $second->assertJsonPath('message.payload.intent', 'missing_submissions');
        $second->assertJsonPath('conversation.message_count', 4);

        $messages = $fake->calls[1]['messages'];
        $this->assertSame(['user', 'assistant', 'user'], array_column($messages, 'role'));
        $this->assertSame("Who hasn't submitted compliance requirements?", $messages[0]['content']);
        $this->assertSame('Answer one.', $messages[1]['content']);
        $this->assertStringContainsString('Question: tell me more about that', $messages[2]['content']);
        $this->assertStringContainsString('"deterministic_answer"', $messages[2]['content']);
    }

    public function test_a_new_subject_is_not_forced_onto_the_previous_intent(): void
    {
        Sanctum::actingAs($this->admin());
        $this->fake(['Fine.']);

        $first = $this->postJson('/api/ai/assistant/chat', ['message' => "Who hasn't submitted compliance requirements?"])->assertOk();
        $this->postJson('/api/ai/assistant/chat', ['conversation_id' => $first->json('conversation.id'), 'message' => 'How is our budget doing this semester'])
            ->assertOk()->assertJsonPath('message.payload.intent', 'finance_health');
    }

    public function test_history_is_capped_at_eight_messages_and_each_is_cut(): void
    {
        $admin = $this->admin();
        Sanctum::actingAs($admin);
        $fake = $this->fake(['Fine.']);
        $conversation = AiConversation::factory()->forUser($admin)->create();
        for ($i = 1; $i <= 12; $i++) {
            AiMessage::factory()->assistant()->create(['conversation_id' => $conversation->id, 'role' => $i % 2 === 1 ? 'user' : 'assistant', 'content' => ($i === 11 ? str_repeat('x', 3000) : "turn {$i}")]);
        }

        $this->postJson('/api/ai/assistant/chat', ['conversation_id' => $conversation->id, 'message' => 'and finance?'])->assertOk();

        $messages = $fake->calls[0]['messages'];
        $this->assertSame('user', $messages[0]['role']);
        $this->assertLessThanOrEqual(9, count($messages));
        $this->assertSame('turn 5', $messages[0]['content']);
        $this->assertSame(1500, mb_strlen($messages[count($messages) - 3]['content']));
        $this->assertSame('user', $messages[array_key_last($messages)]['role']);
    }

    public function test_a_line_with_an_invented_number_replaces_the_answer_with_the_verified_text(): void
    {
        Sanctum::actingAs($this->admin());
        $this->fake(["Everything looks fine.\n", "Exactly 98765 members owe fees.\n", 'Done.']);

        [, $events] = $this->stream(['message' => 'What should I do today?']);

        $names = array_column($events, 'event');
        $this->assertContains('replace', $names);
        $replace = $events[array_search('replace', $names, true)]['data'];
        $this->assertNotSame('', $replace['text']);
        $this->assertSame('The written answer was replaced with the verified summary.', $replace['notice']);
        $done = $events[array_key_last($events)]['data']['message'];
        $this->assertSame($replace['text'], $done['content']);
        $this->assertFalse($done['payload']['model_written']);
        $this->assertSame('records', $done['payload']['engine']);
        $this->assertSame('The written answer was replaced with the verified summary.', $done['payload']['notice']);
        $this->assertStringNotContainsString('98765', $done['content']);
        $this->assertStringNotContainsString('98765', implode('', array_map(fn ($e) => $e['data']['text'] ?? '', array_filter($events, fn ($e) => $e['event'] === 'delta'))));
    }

    public function test_a_disallowed_link_is_flattened_and_hostile_html_is_stripped(): void
    {
        $student = User::factory()->student()->create(['organization_id' => Organization::factory()->create()->id]);
        Sanctum::actingAs($student);
        $this->fake([
            "Open [compliance](/dashboard/compliance) now.\n",
            "<script>alert('x')</script><img src=x onerror=alert('x')>Plain [site](https://evil.example/x) text.\n",
            '<div class="callout callout-info" style="x:y" onclick="z">Note</div> [Ask AI](/dashboard/ask-ai)',
        ]);

        $content = $this->postJson('/api/ai/assistant/chat', ['message' => 'What should I do today?'])->assertOk()->json('message.content');

        $this->assertStringContainsString('Open compliance now.', $content);
        $this->assertStringNotContainsString('/dashboard/compliance', $content);
        $this->assertStringNotContainsString('<script', $content);
        $this->assertStringNotContainsString('<img', $content);
        $this->assertStringNotContainsString('onerror', $content);
        $this->assertStringNotContainsString('evil.example', $content);
        $this->assertStringContainsString('Plain site text.', $content);
        $this->assertStringContainsString('<div class="callout callout-info">Note</div>', $content);
        $this->assertStringNotContainsString('onclick', $content);
        $this->assertStringContainsString('[Ask AI](/dashboard/ask-ai)', $content);
    }

    public function test_every_href_in_the_payload_passes_the_role_allowlist(): void
    {
        $this->seedStudentRecords();
        $student = User::factory()->student()->create(['organization_id' => Organization::first()->id]);
        Sanctum::actingAs($student);
        $this->fake(['Fine.']);

        $payload = $this->postJson('/api/ai/assistant/chat', ['message' => 'What should I do today?'])->assertOk()->json('message.payload');

        $hrefs = collect($payload['sections'])->flatMap(fn ($s) => collect($s['rows'])->pluck('href'))->filter()->push($payload['recommended_action']['href'] ?? null)->filter();
        foreach ($hrefs as $href) {
            $this->assertNotNull(app(ClientRouteAccess::class)->hrefFor('STUDENT', $href), $href);
        }
    }

    private function seedStudentRecords(): void
    {
        Organization::factory()->create();
    }

    public function test_without_a_provider_every_path_answers_from_records(): void
    {
        $admin = $this->admin();
        Sanctum::actingAs($admin);
        $this->fake([], null, true);

        [, $events] = $this->stream(['message' => 'What should I do today?']);

        $names = array_column($events, 'event');
        $this->assertSame('meta', $names[0]);
        $this->assertSame('done', $names[array_key_last($names)]);
        $this->assertNotContains('error', $names);
        $done = $events[array_key_last($events)]['data']['message'];
        $joined = implode('', array_map(fn ($e) => $e['data']['text'], array_filter($events, fn ($e) => $e['event'] === 'delta')));
        $this->assertSame($done['content'], $joined);
        $this->assertNotSame('', $done['content']);
        $this->assertSame('records', $done['payload']['engine']);
        $this->assertFalse($done['payload']['model_written']);
        $this->assertNull($done['payload']['notice']);

        $this->postJson('/api/ai/assistant/chat', ['message' => 'How do I create an event?'])->assertOk()->assertJsonPath('message.payload.engine', 'records');
        $this->postJson('/api/ai/assistant/chat', ['message' => 'Hello'])->assertOk()->assertJsonPath('message.payload.intent', 'greeting');
    }

    public function test_the_real_fallback_generator_with_no_keys_still_answers(): void
    {
        Sanctum::actingAs($this->admin());

        $this->postJson('/api/ai/assistant/chat', ['message' => 'What should I do today?'])
            ->assertOk()
            ->assertJsonPath('message.payload.engine', 'records');
    }

    public function test_how_to_questions_go_through_the_model_with_the_guide_steps(): void
    {
        Sanctum::actingAs($this->admin());
        $fake = $this->fake(['Start from the Events page.']);

        $this->postJson('/api/ai/assistant/chat', ['message' => 'How do I create an event?'])
            ->assertOk()
            ->assertJsonPath('message.payload.intent', 'how_to_guide')
            ->assertJsonPath('message.payload.model_written', true);

        $this->assertStringContainsString('"guide_steps"', $fake->lastUserTurn());
    }

    public function test_greetings_capabilities_and_thanks_need_no_model(): void
    {
        Sanctum::actingAs($this->admin());
        $fake = $this->fake(['should not be used']);

        $this->postJson('/api/ai/assistant/chat', ['message' => 'Hi!'])->assertOk()->assertJsonPath('message.payload.intent', 'greeting')->assertJsonPath('message.payload.model_written', false);
        $this->postJson('/api/ai/assistant/chat', ['message' => 'thanks'])->assertOk()->assertJsonPath('message.payload.intent', 'greeting');
        $capabilities = $this->postJson('/api/ai/assistant/chat', ['message' => 'What can you do?'])->assertOk();
        $capabilities->assertJsonPath('message.payload.intent', 'capabilities');
        $this->assertStringContainsString('I never approve', $capabilities->json('message.content'));
        $this->assertCount(0, $fake->calls);
    }

    public function test_regenerate_replaces_the_last_answer_from_the_last_question(): void
    {
        $admin = $this->admin();
        Sanctum::actingAs($admin);
        $fake = $this->fake(['First answer.']);
        $first = $this->postJson('/api/ai/assistant/chat', ['message' => 'What should I do today?'])->assertOk();
        $conversationId = $first->json('conversation.id');
        $fake->chunks = ['Second answer.'];

        $second = $this->postJson('/api/ai/assistant/chat', ['conversation_id' => $conversationId, 'regenerate' => true])->assertOk();

        $second->assertJsonPath('message.content', 'Second answer.');
        $second->assertJsonPath('user_message.id', $first->json('user_message.id'));
        $this->assertSame(2, AiMessage::where('conversation_id', $conversationId)->count());
        $this->assertSame(1, AiMessage::where('conversation_id', $conversationId)->where('role', 'user')->count());
        $this->assertNotSame($first->json('message.id'), $second->json('message.id'));
        $this->assertSame(['user'], array_column($fake->calls[1]['messages'], 'role'));
    }

    public function test_stopping_stores_the_verified_text_and_nothing_when_none_was_verified(): void
    {
        $admin = $this->admin();
        $fake = $this->fake(["Verified first line.\n", "Second line.\n", "Third line.\n"]);
        $gone = false;
        $fake->afterChunk = function (int $index) use (&$gone): void {
            $gone = $index >= 1;
        };

        $result = app(AskAiChatService::class)->respond($admin, null, 'What should I do today?', null, false, static function (): void {}, function () use (&$gone): bool {
            return $gone;
        });

        $this->assertNotNull($result['message']);
        $this->assertSame('stopped', $result['message']['status']);
        $this->assertStringStartsWith('Verified first line.', $result['message']['content']);
        $this->assertStringNotContainsString('Third line', $result['message']['content']);

        $immediate = app(AskAiChatService::class)->respond($admin, null, 'What should I do today again?', null, false, static function (): void {}, static fn (): bool => true);
        $this->assertNull($immediate['message']);
        $this->assertSame(1, AiMessage::where('role', 'assistant')->count());
        $this->assertSame(2, AiMessage::where('role', 'user')->count());
    }

    public function test_feedback_is_only_for_the_users_own_assistant_messages(): void
    {
        $admin = $this->admin();
        $other = $this->admin();
        $this->fake(['Fine.']);
        Sanctum::actingAs($admin);
        $chat = $this->postJson('/api/ai/assistant/chat', ['message' => 'What should I do today?'])->assertOk();
        $assistantId = $chat->json('message.id');
        $userId = $chat->json('user_message.id');

        $this->postJson("/api/ai/assistant/messages/{$assistantId}/feedback", ['rating' => 'up'])->assertOk()->assertJsonPath('message.feedback', 'up');
        $this->postJson("/api/ai/assistant/messages/{$assistantId}/feedback", ['rating' => 'down'])->assertOk()->assertJsonPath('message.feedback', 'down');
        $this->postJson("/api/ai/assistant/messages/{$assistantId}/feedback", ['rating' => null])->assertOk()->assertJsonPath('message.feedback', null);
        $this->postJson("/api/ai/assistant/messages/{$assistantId}/feedback", ['rating' => 'meh'])->assertStatus(422);
        $this->postJson("/api/ai/assistant/messages/{$assistantId}/feedback", [])->assertStatus(422);
        $this->postJson("/api/ai/assistant/messages/{$userId}/feedback", ['rating' => 'up'])->assertStatus(422);

        Sanctum::actingAs($other);
        $this->postJson("/api/ai/assistant/messages/{$assistantId}/feedback", ['rating' => 'up'])->assertStatus(404);
    }

    public function test_conversations_list_show_rename_search_and_delete(): void
    {
        $admin = $this->admin();
        Sanctum::actingAs($admin);
        $fake = $this->fake(['Three organizations still owe files.']);
        $a = $this->postJson('/api/ai/assistant/chat', ['message' => 'Who has not submitted requirements?'])->assertOk()->json('conversation.id');
        $fake->chunks = ['The budget is on track.'];
        $b = $this->postJson('/api/ai/assistant/chat', ['message' => 'Show me the budget'])->assertOk()->json('conversation.id');

        $list = $this->getJson('/api/ai/assistant/conversations')->assertOk();
        $this->assertSame([$b, $a], array_column($list->json('data'), 'id'));
        $this->assertSame('Three organizations still owe files.', $list->json('data.1.preview'));
        $this->assertSame(2, $list->json('data.0.message_count'));

        $this->assertSame([$a], array_column($this->getJson('/api/ai/assistant/conversations?search=submitted')->json('data'), 'id'));
        $this->assertSame([$a], array_column($this->getJson('/api/ai/assistant/conversations?search=owe+files')->json('data'), 'id'));
        $this->assertSame([], $this->getJson('/api/ai/assistant/conversations?search=%25')->json('data'));

        $show = $this->getJson("/api/ai/assistant/conversations/{$a}")->assertOk();
        $this->assertSame(['user', 'assistant'], array_column($show->json('messages'), 'role'));
        $show->assertJsonPath('conversation.id', $a);

        $this->patchJson("/api/ai/assistant/conversations/{$a}", ['title' => 'Renamed'])->assertOk()->assertJsonPath('conversation.title', 'Renamed');
        $this->patchJson("/api/ai/assistant/conversations/{$a}", ['title' => ''])->assertStatus(422);
        $this->patchJson("/api/ai/assistant/conversations/{$a}", ['title' => str_repeat('a', 161)])->assertStatus(422);

        $this->deleteJson("/api/ai/assistant/conversations/{$a}")->assertOk();
        $this->getJson("/api/ai/assistant/conversations/{$a}")->assertStatus(404);
        $this->assertSame(0, AiMessage::where('conversation_id', $a)->count());

        $this->deleteJson('/api/ai/assistant/conversations')->assertOk();
        $this->assertSame(0, AiConversation::count());
        $this->assertSame(0, AiMessage::count());
    }

    public function test_the_list_is_capped_at_fifty(): void
    {
        $admin = $this->admin();
        AiConversation::factory()->forUser($admin)->count(55)->create();
        Sanctum::actingAs($admin);

        $this->assertCount(50, $this->getJson('/api/ai/assistant/conversations')->json('data'));
    }

    public function test_the_recommended_next_step_reaches_the_facts_the_model_receives(): void
    {
        Sanctum::actingAs($this->admin());
        $fake = $this->fake(['Open the page below.']);

        $recommended = $this->postJson('/api/ai/assistant/chat', ['message' => 'How do I create an event?'])
            ->assertOk()
            ->json('message.payload.recommended_action');

        $this->assertNotEmpty($recommended['href'] ?? null, 'the seeded question must produce a recommended action');
        $turn = $fake->lastUserTurn();
        $facts = json_decode(substr($turn, strpos($turn, '```json') + 8, strrpos($turn, '```') - strpos($turn, '```json') - 8), true);
        $this->assertSame($recommended['href'], $facts['next_step']['href']);
        $this->assertNotEmpty($facts['next_step']['label']);
    }

    public function test_memory_is_saved_by_phrase_listed_and_reaches_the_facts(): void
    {
        $admin = $this->admin();
        Sanctum::actingAs($admin);
        $fake = $this->fake(['Short answer.']);

        $saved = $this->postJson('/api/ai/assistant/chat', ['message' => 'remember that I am the treasurer and want short answers'])->assertOk();
        $saved->assertJsonPath('message.content', 'Saved to memory: I am the treasurer and want short answers');
        $this->assertSame(1, AiMemory::ownedBy($admin)->count());
        $this->assertCount(0, $fake->calls);

        $this->postJson('/api/ai/assistant/chat', ['message' => 'Please remember: my deadline is Friday'])->assertOk();
        $this->assertSame(2, AiMemory::ownedBy($admin)->count());

        $list = $this->postJson('/api/ai/assistant/chat', ['message' => 'What do you remember?'])->assertOk();
        $this->assertStringContainsString('- I am the treasurer and want short answers', $list->json('message.content'));
        $this->assertStringContainsString('- my deadline is Friday', $list->json('message.content'));

        $this->postJson('/api/ai/assistant/chat', ['message' => 'What should I do today?'])->assertOk();
        $this->assertStringContainsString('I am the treasurer and want short answers', $fake->lastUserTurn());
        $this->assertStringContainsString('my deadline is Friday', $fake->lastUserTurn());

        $this->getJson('/api/ai/assistant')->assertOk()->assertJsonPath('memory_count', 2);

        $this->postJson('/api/ai/assistant/chat', ['message' => 'forget everything'])->assertOk()->assertJsonPath('message.payload.intent', 'memory');
        $this->assertSame(0, AiMemory::ownedBy($admin)->count());
    }

    public function test_a_memory_phrase_is_trimmed_to_300_characters(): void
    {
        $admin = $this->admin();
        Sanctum::actingAs($admin);
        $this->fake();

        $this->postJson('/api/ai/assistant/chat', ['message' => 'remember '.str_repeat('abcde ', 80)])->assertOk();

        $this->assertLessThanOrEqual(300, mb_strlen(AiMemory::first()->content));
    }

    public function test_memory_routes_enforce_the_limit_and_validation(): void
    {
        $admin = $this->admin();
        Sanctum::actingAs($admin);

        $this->postJson('/api/ai/assistant/memories', ['content' => 'ab'])->assertStatus(422);
        $this->postJson('/api/ai/assistant/memories', ['content' => str_repeat('a', 301)])->assertStatus(422);

        for ($i = 1; $i <= 30; $i++) {
            $this->postJson('/api/ai/assistant/memories', ['content' => "Memory number {$i}"])->assertStatus(201)->assertJsonStructure(['memory' => ['id', 'content', 'created_at']]);
        }
        $this->postJson('/api/ai/assistant/memories', ['content' => 'One too many'])->assertStatus(422)->assertJsonValidationErrors(['content']);

        $this->fake(['x']);
        $full = $this->postJson('/api/ai/assistant/chat', ['message' => 'remember that this is the thirty first'])->assertOk();
        $this->assertStringContainsString('Delete one', $full->json('message.content'));
        $this->assertSame(30, AiMemory::ownedBy($admin)->count());

        $list = $this->getJson('/api/ai/assistant/memories')->assertOk();
        $this->assertCount(30, $list->json('data'));
        $first = $list->json('data.0.id');

        $this->deleteJson("/api/ai/assistant/memories/{$first}")->assertOk();
        $this->assertSame(29, AiMemory::ownedBy($admin)->count());
        $this->deleteJson('/api/ai/assistant/memories')->assertOk();
        $this->assertSame(0, AiMemory::count());
    }

    public function test_the_overview_gains_the_chat_keys_and_keeps_the_old_ones(): void
    {
        $admin = $this->admin();
        $admin->update(['first_name' => 'Jade']);
        Sanctum::actingAs($admin);
        AiMemory::factory()->forUser($admin)->count(2)->create();

        $overview = $this->getJson('/api/ai/assistant')->assertOk();

        $overview->assertJsonPath('user_first_name', 'Jade');
        $overview->assertJsonPath('model_enabled', false);
        $overview->assertJsonPath('memory_count', 2);
        $this->assertNotEmpty($overview->json('suggested_questions'));
        $this->assertNotEmpty($overview->json('daily_briefing'));
        $this->assertArrayHasKey('recent_queries', $overview->json());
        $starters = $overview->json('starter_prompts');
        $this->assertLessThanOrEqual(6, count($starters));
        $this->assertNotEmpty($starters);
        $this->assertSame(['id', 'label', 'question', 'topic'], array_keys($starters[0]));

        config(['services.anthropic.key' => 'sk-test']);
        $this->getJson('/api/ai/assistant')->assertJsonPath('model_enabled', true);
    }

    public function test_the_legacy_ask_endpoint_still_answers(): void
    {
        Sanctum::actingAs($this->admin());

        $this->postJson('/api/ai/assistant/ask', ['question' => 'What should I do today?'])
            ->assertOk()
            ->assertJsonStructure(['id', 'question', 'intent', 'title', 'answer', 'highlights', 'formatted_blocks', 'charts', 'sections', 'follow_ups', 'engine']);
    }

    public function test_the_error_event_never_leaks_an_exception_message(): void
    {
        Sanctum::actingAs($this->admin());
        $this->fake(['Fine.']);
        $this->app->bind(AskAiChatService::class, fn () => new class extends AskAiChatService
        {
            public function __construct() {}

            public function respond($user, $conversation, $text, $topic, $regenerate, $emit, $aborted = null, $source = 'typed'): array
            {
                $emit('meta', ['conversation' => [], 'user_message' => []]);
                throw new \RuntimeException('database password is hunter2');
            }
        });

        $response = $this->postJson('/api/ai/assistant/chat', ['message' => 'hello again'], ['Accept' => 'text/event-stream']);
        $body = $response->streamedContent();

        $this->assertStringContainsString('event: error', $body);
        $this->assertStringContainsString('Could not answer that right now. Try again.', $body);
        $this->assertStringNotContainsString('hunter2', $body);
    }
}
