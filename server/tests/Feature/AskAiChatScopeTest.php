<?php

namespace Tests\Feature;

use App\Contracts\TextGenerator;
use App\Models\AiConversation;
use App\Models\AiMemory;
use App\Models\AiMessage;
use App\Models\AiOutput;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\Support\AskAiChatFakeGenerator;
use Tests\TestCase;

class AskAiChatScopeTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['performance.api_cache.enabled' => false, 'services.groq.key' => '', 'services.anthropic.key' => '']);
    }

    private function fake(): AskAiChatFakeGenerator
    {
        $fake = new AskAiChatFakeGenerator(['Fine.']);
        $this->app->instance(TextGenerator::class, $fake);

        return $fake;
    }

    private function adminIn(Organization $org): User
    {
        return User::factory()->admin()->create(['organization_id' => $org->id]);
    }

    public function test_another_users_conversation_and_memory_answer_404_and_never_list(): void
    {
        $org = Organization::factory()->create();
        $owner = $this->adminIn($org);
        $intruder = $this->adminIn($org);
        $conversation = AiConversation::factory()->forUser($owner)->create();
        $message = AiMessage::factory()->assistant()->create(['conversation_id' => $conversation->id]);
        $memory = AiMemory::factory()->forUser($owner)->create(['content' => 'owner secret']);
        $this->fake();

        Sanctum::actingAs($intruder);

        $this->getJson("/api/ai/assistant/conversations/{$conversation->id}")->assertStatus(404);
        $this->patchJson("/api/ai/assistant/conversations/{$conversation->id}", ['title' => 'Mine now'])->assertStatus(404);
        $this->deleteJson("/api/ai/assistant/conversations/{$conversation->id}")->assertStatus(404);
        $this->postJson('/api/ai/assistant/chat', ['conversation_id' => $conversation->id, 'message' => 'hello again'])->assertStatus(404);
        $this->postJson('/api/ai/assistant/chat', ['conversation_id' => $conversation->id, 'regenerate' => true])->assertStatus(404);
        $this->postJson("/api/ai/assistant/messages/{$message->id}/feedback", ['rating' => 'up'])->assertStatus(404);
        $this->deleteJson("/api/ai/assistant/memories/{$memory->id}")->assertStatus(404);
        $this->assertSame([], $this->getJson('/api/ai/assistant/conversations')->json('data'));
        $this->assertSame([], $this->getJson('/api/ai/assistant/memories')->json('data'));

        $this->deleteJson('/api/ai/assistant/conversations')->assertOk();
        $this->deleteJson('/api/ai/assistant/memories')->assertOk();
        $this->assertSame(1, AiConversation::count());
        $this->assertSame(1, AiMemory::count());
    }

    public function test_a_role_change_hides_the_old_conversations_and_memories(): void
    {
        $org = Organization::factory()->create();
        $user = $this->adminIn($org);
        $conversation = AiConversation::factory()->forUser($user)->create();
        $memory = AiMemory::factory()->forUser($user)->create(['content' => 'from my admin days']);

        Sanctum::actingAs($user);
        $this->getJson("/api/ai/assistant/conversations/{$conversation->id}")->assertOk();

        $user->update(['role' => 'SBO_OFFICER']);
        Sanctum::actingAs($user->fresh());
        $fake = $this->fake();

        $this->getJson("/api/ai/assistant/conversations/{$conversation->id}")->assertStatus(404);
        $this->postJson('/api/ai/assistant/chat', ['conversation_id' => $conversation->id, 'message' => 'hello again'])->assertStatus(404);
        $this->assertSame([], $this->getJson('/api/ai/assistant/conversations')->json('data'));
        $this->assertSame([], $this->getJson('/api/ai/assistant/memories')->json('data'));
        $this->deleteJson("/api/ai/assistant/memories/{$memory->id}")->assertStatus(404);
        $this->getJson('/api/ai/assistant')->assertOk()->assertJsonPath('memory_count', 0);

        $this->postJson('/api/ai/assistant/chat', ['message' => 'What should I do today?'])->assertOk();
        $this->assertStringNotContainsString('from my admin days', $fake->lastUserTurn());

        $this->deleteJson('/api/ai/assistant/conversations')->assertOk();
        $this->assertTrue(AiConversation::whereKey($conversation->id)->exists(), 'delete all must leave the old-role row alone');

        $user->update(['role' => 'ADMIN']);
        Sanctum::actingAs($user->fresh());
        $this->getJson("/api/ai/assistant/conversations/{$conversation->id}")->assertOk();
        $this->assertCount(1, $this->getJson('/api/ai/assistant/memories')->json('data'));
    }

    public function test_an_organization_change_hides_the_old_conversations_and_memories(): void
    {
        $orgA = Organization::factory()->create();
        $orgB = Organization::factory()->create();
        $user = $this->adminIn($orgA);
        $conversation = AiConversation::factory()->forUser($user)->create();
        AiMemory::factory()->forUser($user)->create(['content' => 'about organization A']);

        $user->update(['organization_id' => $orgB->id]);
        Sanctum::actingAs($user->fresh());
        $fake = $this->fake();

        $this->getJson("/api/ai/assistant/conversations/{$conversation->id}")->assertStatus(404);
        $this->assertSame([], $this->getJson('/api/ai/assistant/conversations')->json('data'));
        $this->assertSame([], $this->getJson('/api/ai/assistant/memories')->json('data'));

        $this->postJson('/api/ai/assistant/chat', ['message' => 'What should I do today?'])->assertOk();
        $this->assertStringNotContainsString('about organization A', $fake->lastUserTurn());
        $this->assertSame(1, AiConversation::ownedBy($user->fresh())->count());
    }

    public function test_the_scope_is_null_safe_for_a_user_without_an_organization(): void
    {
        $org = Organization::factory()->create();
        $user = $this->adminIn($org);
        $bound = AiConversation::factory()->forUser($user)->create();

        $user->organization_id = null;
        $unbound = AiConversation::factory()->forUser($user)->create();

        $this->assertSame([$unbound->id], AiConversation::ownedBy($user)->pluck('id')->all());
        $this->assertSame([$unbound->id], AiConversation::ownedBy($user)->pluck('id')->all());
        $this->assertNotContains($bound->id, AiConversation::ownedBy($user)->pluck('id')->all());

        $user->organization_id = $org->id;
        $this->assertSame([$bound->id], AiConversation::ownedBy($user)->pluck('id')->all());
    }

    public function test_a_new_conversation_and_memory_are_stamped_with_the_current_scope(): void
    {
        $org = Organization::factory()->create();
        $user = $this->adminIn($org);
        Sanctum::actingAs($user);
        $this->fake();

        $this->postJson('/api/ai/assistant/chat', ['message' => 'What should I do today?'])->assertOk();
        $this->postJson('/api/ai/assistant/memories', ['content' => 'Keep it short'])->assertStatus(201);

        $this->assertDatabaseHas('ai_conversations', ['user_id' => $user->school_id, 'organization_id' => $org->id, 'role' => 'ADMIN']);
        $this->assertDatabaseHas('ai_memories', ['user_id' => $user->school_id, 'organization_id' => $org->id, 'role' => 'ADMIN']);
    }

    public function test_deleting_a_user_removes_their_conversations_messages_and_memories(): void
    {
        $user = $this->adminIn(Organization::factory()->create());
        $conversation = AiConversation::factory()->forUser($user)->create();
        AiMessage::factory()->create(['conversation_id' => $conversation->id]);
        AiMemory::factory()->forUser($user)->create();

        $user->delete();

        $this->assertSame(0, AiConversation::count());
        $this->assertSame(0, AiMessage::count());
        $this->assertSame(0, AiMemory::count());
    }

    public function test_the_chat_route_uses_the_ai_generation_limit(): void
    {
        Sanctum::actingAs($this->adminIn(Organization::factory()->create()));
        $this->fake();

        for ($sent = 0; $sent < 5; $sent++) {
            $this->postJson('/api/ai/assistant/chat', ['message' => 'What should I do today?'])->assertOk();
        }

        $this->postJson('/api/ai/assistant/chat', ['message' => 'What should I do today?'], ['Accept' => 'text/event-stream'])
            ->assertStatus(429)
            ->assertJsonStructure(['message']);
    }

    public function test_deleting_an_account_deletes_its_ask_ai_text_from_ai_outputs(): void
    {
        $sao = User::factory()->superAdmin()->create();
        $student = User::factory()->student()->create(['organization_id' => Organization::factory()->create()->id]);
        $other = User::factory()->student()->create(['organization_id' => $student->organization_id]);
        $this->fake();

        Sanctum::actingAs($student);
        $this->postJson('/api/ai/assistant/chat', ['message' => 'my secret question zebra-42'])->assertOk();
        Sanctum::actingAs($other);
        $this->postJson('/api/ai/assistant/chat', ['message' => 'someone else question'])->assertOk();
        $this->assertSame(2, AiOutput::count());

        Sanctum::actingAs($sao);
        $this->deleteJson('/api/system/users/'.$student->school_id, ['school_id' => $student->school_id])->assertOk();

        $this->assertSame(['someone else question'], AiOutput::pluck('prompt_text')->all());
    }
}
