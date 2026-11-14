<?php

namespace Tests\Feature;

use App\Contracts\TextGenerator;
use App\Services\Ai\ClaudeMessagesService;
use App\Services\Ai\Concerns\GuardsGeneratedText;
use App\Services\Ai\FallbackTextGenerator;
use App\Services\GroqResponsesService;
use Illuminate\Support\Facades\Log;
use Tests\TestCase;

class FallbackTextGeneratorTest extends TestCase
{
    public function test_the_primary_answer_is_used_and_the_secondary_is_never_asked(): void
    {
        $primary = new ScriptedGenerator(['text' => 'From primary.', 'model' => 'claude-sonnet-5-5', 'response_id' => 'a']);
        $secondary = new ScriptedGenerator(['text' => 'From secondary.', 'model' => 'groq-model', 'response_id' => 'b']);

        $result = (new FallbackTextGenerator($primary, $secondary))->generate('i', 'x', 100, 0.3);

        $this->assertSame('From primary.', $result['text']);
        $this->assertSame(1, $primary->calls);
        $this->assertSame(0, $secondary->calls);
        $this->assertSame(['i', 'x', 100, 0.3], $primary->lastArguments);
    }

    public function test_the_secondary_answers_when_the_primary_returns_nothing(): void
    {
        $primary = new ScriptedGenerator(null);
        $secondary = new ScriptedGenerator(['text' => 'From secondary.', 'model' => 'groq-model', 'response_id' => 'b']);

        $result = (new FallbackTextGenerator($primary, $secondary))->generate('i', 'x');

        $this->assertSame('groq-model', $result['model']);
        $this->assertSame([1, 1], [$primary->calls, $secondary->calls]);
    }

    public function test_it_is_null_only_when_both_fail(): void
    {
        $primary = new ScriptedGenerator(null);
        $secondary = new ScriptedGenerator(null);

        $this->assertNull((new FallbackTextGenerator($primary, $secondary))->generate('i', 'x'));
        $this->assertSame([1, 1], [$primary->calls, $secondary->calls]);
    }

    public function test_structured_requests_fall_back_with_every_argument_intact(): void
    {
        $primary = new ScriptedGenerator(null);
        $secondary = new ScriptedGenerator(['data' => ['a' => 1], 'text' => '{"a":1}', 'model' => 'groq-model', 'response_id' => null]);
        $schema = ['type' => 'object', 'required' => ['a']];

        $result = (new FallbackTextGenerator($primary, $secondary))->generateStructured('i', ['x' => 1], 'name', $schema, 500, 0.25);

        $this->assertSame(['a' => 1], $result['data']);
        $this->assertSame(['i', ['x' => 1], 'name', $schema, 500, 0.25], $secondary->lastArguments);
    }

    public function test_it_logs_which_provider_served_without_the_prompt_or_the_data(): void
    {
        Log::spy();
        config()->set('services.anthropic.key', '');
        $claude = new ClaudeMessagesService; // no key, so it answers null
        $secondary = new ScriptedGenerator(['text' => 'Reply to Maria Santos.', 'model' => 'groq-model', 'response_id' => 'b']);

        (new FallbackTextGenerator($claude, $secondary))->generate('private instructions', 'student Maria Santos owes PHP 5,000');

        Log::shouldHaveReceived('info')->withArgs(function (string $message, array $context) {
            return $message === 'AI provider gave no answer.'
                && $context['provider'] === 'anthropic'
                && $context['position'] === 'primary'
                && array_key_exists('latency_ms', $context)
                && array_key_exists('stop_reason', $context);
        })->once();
        Log::shouldHaveReceived('info')->withArgs(function (string $message, array $context) {
            return $message === 'AI text served.'
                && $context['provider'] === 'ScriptedGenerator'
                && $context['model'] === 'groq-model'
                && $context['position'] === 'secondary'
                && array_key_exists('latency_ms', $context)
                && ! str_contains(json_encode($context), 'Maria');
        })->once();
    }

    public function test_the_helpers_behave_like_the_underlying_guards(): void
    {
        $generator = new FallbackTextGenerator(new ScriptedGenerator(null), new ScriptedGenerator(null));

        $this->assertTrue($generator->preservesNumericFacts('PHP 1,200.00', ['x' => 1200]));
        $this->assertFalse($generator->preservesNumericFacts('PHP 1,300.00', ['x' => 1200]));
        $this->assertSame('Heading', $generator->plainText('## Heading'));
    }

    public function test_a_conversation_is_served_by_the_primary_without_a_reset(): void
    {
        $primary = new ScriptedGenerator(['text' => 'Hello there', 'reasoning' => null, 'model' => 'm', 'response_id' => 'a'], [['text', 'Hello '], ['text', 'there']]);
        $secondary = new ScriptedGenerator(['text' => 'Other', 'reasoning' => null, 'model' => 'g', 'response_id' => 'b'], [['text', 'Other']]);
        $events = [];

        $result = (new FallbackTextGenerator($primary, $secondary))->converse('i', [['role' => 'user', 'content' => 'hi']], 900, function (string $type, string $delta) use (&$events) {
            $events[] = [$type, $delta];
        });

        $this->assertSame('Hello there', $result['text']);
        $this->assertSame([['text', 'Hello '], ['text', 'there']], $events);
        $this->assertSame(0, $secondary->calls);
        $this->assertSame(['i', [['role' => 'user', 'content' => 'hi']], 900], array_slice($primary->lastArguments, 0, 3));
    }

    public function test_a_conversation_resets_before_the_secondary_when_the_primary_already_streamed(): void
    {
        $primary = new ScriptedGenerator(null, [['reasoning', 'Thinking'], ['text', 'Half an ans']]);
        $secondary = new ScriptedGenerator(['text' => 'Full answer', 'reasoning' => null, 'model' => 'g', 'response_id' => 'b'], [['text', 'Full answer']]);
        $events = [];

        $result = (new FallbackTextGenerator($primary, $secondary))->converse('i', [['role' => 'user', 'content' => 'hi']], 900, function (string $type, string $delta) use (&$events) {
            $events[] = [$type, $delta];
        });

        $this->assertSame('Full answer', $result['text']);
        $this->assertSame([['reasoning', 'Thinking'], ['text', 'Half an ans'], ['reset', ''], ['text', 'Full answer']], $events);
    }

    public function test_a_conversation_sends_no_reset_when_the_primary_failed_before_emitting(): void
    {
        $primary = new ScriptedGenerator(null);
        $secondary = new ScriptedGenerator(['text' => 'Full answer', 'reasoning' => null, 'model' => 'g', 'response_id' => 'b'], [['text', 'Full answer']]);
        $events = [];

        (new FallbackTextGenerator($primary, $secondary))->converse('i', [['role' => 'user', 'content' => 'hi']], 900, function (string $type, string $delta) use (&$events) {
            $events[] = [$type, $delta];
        });

        $this->assertSame([['text', 'Full answer']], $events);
    }

    public function test_a_conversation_is_null_only_when_both_fail(): void
    {
        $this->assertNull((new FallbackTextGenerator(new ScriptedGenerator(null), new ScriptedGenerator(null)))->converse('i', [['role' => 'user', 'content' => 'hi']]));
    }

    public function test_the_groq_service_is_the_documented_secondary_type(): void
    {
        $this->assertInstanceOf(TextGenerator::class, new GroqResponsesService);
        $this->assertInstanceOf(TextGenerator::class, new ClaudeMessagesService);
    }
}

/** A generator that answers a fixed value and records how it was called. */
class ScriptedGenerator implements TextGenerator
{
    use GuardsGeneratedText;

    public int $calls = 0;

    public array $lastArguments = [];

    /** @param  array<int, array{0: string, 1: string}>  $events  emitted by converse() before it answers */
    public function __construct(private readonly ?array $answer, private readonly array $events = []) {}

    public function converse(string $instructions, array $messages, int $maxOutputTokens = 1400, ?callable $onEvent = null): ?array
    {
        $this->calls++;
        $this->lastArguments = [$instructions, $messages, $maxOutputTokens];
        foreach ($this->events as [$type, $delta]) {
            if ($onEvent !== null) {
                $onEvent($type, $delta);
            }
        }

        return $this->answer;
    }

    public function generate(string $instructions, string $input, int $maxOutputTokens = 400, float $temperature = 0.2): ?array
    {
        $this->calls++;
        $this->lastArguments = [$instructions, $input, $maxOutputTokens, $temperature];

        return $this->answer;
    }

    public function generateStructured(string $instructions, array $input, string $schemaName, array $schema, int $maxOutputTokens = 1800, float $temperature = 0.2): ?array
    {
        $this->calls++;
        $this->lastArguments = [$instructions, $input, $schemaName, $schema, $maxOutputTokens, $temperature];

        return $this->answer;
    }
}
