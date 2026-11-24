<?php

namespace Tests\Feature;

use App\Contracts\TextGenerator;
use App\Models\Organization;
use App\Models\User;
use App\Services\Ai\AiInstructions;
use App\Services\Ai\AskAiService;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\RateLimiter;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\AskAiChatFakeGenerator;
use Tests\TestCase;

class AskAiPositionTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['performance.api_cache.enabled' => false, 'services.groq.key' => '', 'services.anthropic.key' => '']);
        RateLimiter::for('ai-generation', fn () => Limit::none());
    }

    private function officer(?string $title, string $orgName = 'Supreme Student Council'): User
    {
        $org = Organization::where('name', $orgName)->first() ?? Organization::factory()->create(['name' => $orgName]);

        return User::factory()->officer()->create(['organization_id' => $org->id, 'position_title' => $title]);
    }

    private function fake(array $chunks = []): AskAiChatFakeGenerator
    {
        $fake = new AskAiChatFakeGenerator($chunks, null, 'claude-test');
        $this->app->instance(TextGenerator::class, $fake);

        return $fake;
    }

    private function factsOf(AskAiChatFakeGenerator $fake): array
    {
        $turn = $fake->lastUserTurn();

        return json_decode(substr($turn, strpos($turn, '```json') + 8, strrpos($turn, '```') - strpos($turn, '```json') - 8), true);
    }

    public function test_the_chat_context_carries_the_position_title_and_null_when_there_is_none(): void
    {
        $service = app(AskAiService::class);

        $this->assertSame('Vice President', $service->chatContext($this->officer('Vice President'))['position']);

        $org = Organization::factory()->create();
        $student = User::factory()->student()->create(['organization_id' => $org->id, 'position_title' => null]);
        $this->assertArrayHasKey('position', $service->chatContext($student));
        $this->assertNull($service->chatContext($student)['position']);

        $this->assertNull($service->chatContext($this->officer('   '))['position']);
    }

    public function test_the_facts_the_model_receives_carry_the_position(): void
    {
        $officer = $this->officer('Business Manager');
        Sanctum::actingAs($officer);
        $fake = $this->fake(['You are the Business Manager of Supreme Student Council.']);

        $this->postJson('/api/ai/assistant/chat', ['message' => 'Which of my tasks fit my job here?'])->assertOk();

        $facts = $this->factsOf($fake);
        $this->assertSame('Business Manager', $facts['position']);
        $this->assertSame('Supreme Student Council', $facts['scope']);
    }

    public function test_a_student_without_a_title_sends_a_null_position_never_an_invented_one(): void
    {
        $org = Organization::factory()->create();
        Sanctum::actingAs(User::factory()->student()->create(['organization_id' => $org->id, 'position_title' => null]));
        $fake = $this->fake(['Here is what is on your plate.']);

        $this->postJson('/api/ai/assistant/chat', ['message' => 'What should I do today?'])->assertOk();

        $facts = $this->factsOf($fake);
        $this->assertArrayHasKey('position', $facts);
        $this->assertNull($facts['position']);
    }

    public function test_who_am_i_is_answered_locally_with_the_position_and_organization(): void
    {
        Sanctum::actingAs($this->officer('Vice President'));
        $fake = $this->fake(['should not be used']);

        foreach (['Who am I?', 'what is my position', "What's my role?", 'What position do I hold?', 'what is my role here', 'what is my title'] as $question) {
            $response = $this->postJson('/api/ai/assistant/chat', ['message' => $question])->assertOk();
            $response->assertJsonPath('message.payload.intent', 'identity');
            $content = $response->json('message.content');
            $this->assertStringContainsString('Vice President', $content, $question);
            $this->assertStringContainsString('Supreme Student Council', $content, $question);
            $this->assertStringContainsString('officer', $content, $question);
        }
        $this->assertCount(0, $fake->calls);
    }

    public function test_who_am_i_for_a_student_names_the_role_and_organization_without_inventing_a_position(): void
    {
        $org = Organization::factory()->create(['name' => 'College of Computing']);
        Sanctum::actingAs(User::factory()->student()->create(['organization_id' => $org->id, 'position_title' => null]));
        $this->fake();

        $content = $this->postJson('/api/ai/assistant/chat', ['message' => 'what is my position'])->assertOk()->json('message.content');

        $this->assertStringContainsString('student', $content);
        $this->assertStringContainsString('College of Computing', $content);
        $this->assertStringContainsString('no officer position', $content);
    }

    public function test_longer_questions_that_only_mention_a_role_still_go_to_the_model(): void
    {
        Sanctum::actingAs($this->officer('Secretary'));
        $fake = $this->fake(['The Secretary keeps the minutes.']);

        $response = $this->postJson('/api/ai/assistant/chat', ['message' => 'What is my role in approving a budget?'])->assertOk();

        $this->assertNotSame('identity', $response->json('message.payload.intent'));
        $this->assertCount(1, $fake->calls);
    }

    /** @return array<string, array{string}> */
    public static function digitTitles(): array
    {
        return ['a number after the word' => ['Vice President 2'], 'a number in the middle' => ['Year 3 Representative']];
    }

    #[DataProvider('digitTitles')]
    public function test_a_position_with_a_digit_repeated_by_the_model_passes_the_numeric_guard(string $title): void
    {
        Sanctum::actingAs($this->officer($title));
        $answer = "As {$title}, you help lead the council.";
        $fake = $this->fake([$answer]);

        $response = $this->postJson('/api/ai/assistant/chat', ['message' => 'Which of my tasks fit my job here?'])->assertOk();

        $this->assertSame($answer, $response->json('message.content'));
        $this->assertTrue($fake->preservesNumericFacts($answer, ['facts' => $this->factsOf($fake)]));
        $this->assertFalse($fake->preservesNumericFacts('As Vice President 9, you help lead the council.', ['facts' => $this->factsOf($fake)]));
    }

    public function test_the_brief_explains_the_position_fact(): void
    {
        $text = AiInstructions::askAiChat();

        $this->assertStringContainsString('position', $text);
        $this->assertStringContainsString('officer position', $text);
        $this->assertStringNotContainsString("\u{2014}", $text);
        $this->assertStringNotContainsString("\u{2013}", $text);
    }
}
