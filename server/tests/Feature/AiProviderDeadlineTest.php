<?php

namespace Tests\Feature;

use App\Services\Ai\ClaudeMessagesService;
use App\Services\Ai\FallbackTextGenerator;
use App\Services\GroqResponsesService;
use GuzzleHttp\Client;
use GuzzleHttp\Exception\ConnectException;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Psr7\Request;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Tests\TestCase;

class AiProviderDeadlineTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        config()->set('services.ai.cooldown_seconds', 60);
        config()->set('services.groq', ['key' => 'g', 'url' => 'https://groq.test/v1/responses', 'model' => 'm', 'timeout' => 12, 'connect_timeout' => 5]);
        config()->set('services.anthropic', ['key' => 'a', 'model' => 'claude-opus-5-5', 'timeout' => 25, 'connect_timeout' => 3, 'chat_timeout' => 60]);
    }

    public function test_configured_timeouts_above_the_cap_are_clamped_groq_to_twelve_and_claude_to_thirty_seconds(): void
    {
        config()->set('services.groq.timeout', 90);
        config()->set('services.anthropic.timeout', 90);

        $this->assertEquals(12, $this->seconds(new GroqResponsesService));
        $this->assertSame(30.0, $this->seconds(new ClaudeMessagesService));

        config()->set('services.anthropic.timeout', 0);
        $this->assertSame(25.0, $this->seconds(new ClaudeMessagesService), 'unset means the 25 second default');
    }

    public function test_the_shipped_defaults_state_what_the_code_enforces(): void
    {
        $config = (string) file_get_contents(base_path('config/services.php'));

        $this->assertStringContainsString("env('GROQ_TIMEOUT', 12)", $config);
        $this->assertStringContainsString("env('ANTHROPIC_TIMEOUT', 25)", $config);
        $this->assertStringContainsString('caps this at 12', $config);
        $this->assertStringContainsString('capped at 30', $config);
        $this->assertStringContainsString('GROQ_TIMEOUT=12', (string) file_get_contents(base_path('.env.example')));
        $this->assertStringContainsString('ANTHROPIC_TIMEOUT=25', (string) file_get_contents(base_path('.env.example')));
    }

    public function test_a_time_budget_shortens_the_timeout_and_never_lengthens_it(): void
    {
        foreach ([[new GroqResponsesService, 12], [new ClaudeMessagesService, 25]] as [$service, $cap]) {
            $service->withTimeBudget(4.5);
            $this->assertSame(4.5, $this->seconds($service));
            $service->withTimeBudget(0.2);
            $this->assertSame(1.0, $this->seconds($service));
            $service->withTimeBudget(40);
            $this->assertEquals($cap, $this->seconds($service));
        }
    }

    public function test_the_two_attempts_share_one_deadline(): void
    {
        $primary = new ClaudeProbe(null, 1_100_000);
        $secondary = new GroqProbe(['text' => 'ok', 'model' => 'g', 'response_id' => null]);

        (new FallbackTextGenerator($primary, $secondary))->generate('i', 'x');

        // Claude may use 25 of the 30 seconds, so a hung Claude still leaves Groq a turn; Groq's own 12 second cap
        // then bounds that turn.
        $this->assertEqualsWithDelta(25.0, $primary->budget, 0.05);
        $this->assertGreaterThanOrEqual(1.0, $secondary->budget);
        $this->assertLessThan(30.0, $secondary->budget);
        $this->assertGreaterThan(27.0, $secondary->budget);
    }

    public function test_the_event_plan_gets_the_longer_shared_deadline_and_every_other_call_keeps_the_thirty_second_one(): void
    {
        $primary = new ClaudeProbe(null, 1_100_000);
        $secondary = new GroqProbe(['data' => [], 'text' => '{}', 'model' => 'g', 'response_id' => null]);
        (new FallbackTextGenerator($primary, $secondary))->generateStructured('i', [], FallbackTextGenerator::EVENT_PLAN_SCHEMA, []);

        // Claude gets three quarters of the 30 second default, and its HTTP timeout is lifted to the whole deadline.
        $this->assertEqualsWithDelta(22.5, $primary->budget, 0.05);
        $this->assertSame(30.0, $primary->ceiling);
        // Groq gets what is left of the deadline (Claude spent 1.1 seconds), with the same lifted ceiling.
        $this->assertGreaterThan(28.0, $secondary->budget);
        $this->assertLessThan(29.0, $secondary->budget);
        $this->assertSame(30.0, $secondary->ceiling);

        foreach (['generate', 'other schema'] as $kind) {
            $primary = new ClaudeProbe(null, 1_100_000);
            $secondary = new GroqProbe(['text' => 'ok', 'data' => [], 'model' => 'g', 'response_id' => null]);
            $chain = new FallbackTextGenerator($primary, $secondary);
            $kind === 'generate' ? $chain->generate('i', 'x') : $chain->generateStructured('i', [], 'hiusa_task_recommendation_explanations', []);

            $this->assertLessThanOrEqual(25.0, $primary->budget, $kind);
            $this->assertNull($primary->ceiling, $kind);
            $this->assertNull($secondary->ceiling, $kind);
            $this->assertLessThan(30.0, $secondary->budget, $kind);
        }
    }

    public function test_the_plan_deadline_is_configurable_and_never_shorter_than_the_ordinary_one(): void
    {
        $this->assertSame(30, config('services.ai.plan_deadline_seconds'));

        config()->set('services.ai.plan_deadline_seconds', 40);
        $primary = new ClaudeProbe(['data' => [], 'text' => '{}', 'model' => 'c', 'response_id' => null]);
        (new FallbackTextGenerator($primary, new GroqProbe(null)))->generateStructured('i', [], FallbackTextGenerator::EVENT_PLAN_SCHEMA, []);
        $this->assertEqualsWithDelta(30.0, $primary->budget, 0.05);
        $this->assertSame(40.0, $primary->ceiling);

        config()->set('services.ai.plan_deadline_seconds', 5);
        $primary = new ClaudeProbe(['data' => [], 'text' => '{}', 'model' => 'c', 'response_id' => null]);
        (new FallbackTextGenerator($primary, new GroqProbe(null)))->generateStructured('i', [], FallbackTextGenerator::EVENT_PLAN_SCHEMA, []);
        $this->assertEqualsWithDelta(22.5, $primary->budget, 0.05);
        $this->assertSame(30.0, $primary->ceiling);
    }

    public function test_a_lifted_ceiling_lets_the_http_timeout_follow_the_plan_deadline(): void
    {
        foreach ([new GroqResponsesService, new ClaudeMessagesService] as $service) {
            $service->withTimeBudget(22.5, 30.0);
            $this->assertSame(22.5, (float) $this->seconds($service));
            $service->withTimeBudget(50.0, 30.0);
            $this->assertSame(30.0, (float) $this->seconds($service));
            // Clearing the budget clears the ceiling too, so the next ordinary call is back to its own cap.
            $service->withTimeBudget(null);
            $this->assertEquals($service instanceof ClaudeMessagesService ? 25 : 12, $this->seconds($service));
            $service->withTimeBudget(40);
            $this->assertEquals($service instanceof ClaudeMessagesService ? 25 : 12, $this->seconds($service));
        }
    }

    public function test_a_provider_that_timed_out_is_skipped_for_the_cooling_off_period(): void
    {
        $down = new ClaudeProbe(null, 0, true);
        $secondary = new GroqProbe(['text' => 'ok', 'model' => 'g', 'response_id' => null]);
        $chain = new FallbackTextGenerator($down, $secondary);

        $chain->generate('i', 'x');
        $chain->generateStructured('i', [], 'n', []);
        $chain->converse('i', [['role' => 'user', 'content' => 'q']]);

        $this->assertSame(1, $down->calls);
        $this->assertSame(3, $secondary->calls);
    }

    public function test_a_refusal_does_not_start_the_cooling_off(): void
    {
        $refusing = new ClaudeProbe(null);
        $secondary = new GroqProbe(['text' => 'ok', 'model' => 'g', 'response_id' => null]);
        $chain = new FallbackTextGenerator($refusing, $secondary);

        $chain->generate('i', 'x');
        $chain->generate('i', 'x');

        $this->assertSame(2, $refusing->calls);
    }

    public function test_the_cooling_off_ends_and_can_be_switched_off(): void
    {
        $down = new ClaudeProbe(null, 0, true);
        $secondary = new GroqProbe(['text' => 'ok', 'model' => 'g', 'response_id' => null]);
        $chain = new FallbackTextGenerator($down, $secondary);

        $chain->generate('i', 'x');
        Cache::forget('ai:provider-cooldown:anthropic');
        $chain->generate('i', 'x');
        $this->assertSame(2, $down->calls);

        config()->set('services.ai.cooldown_seconds', 0);
        $chain->generate('i', 'x');
        $chain->generate('i', 'x');
        $this->assertSame(4, $down->calls);
    }

    public function test_a_real_claude_connection_failure_rests_claude_and_groq_answers(): void
    {
        $claudeCalls = 0;
        $mock = new MockHandler([
            function () use (&$claudeCalls) {
                $claudeCalls++;

                return new ConnectException('cURL error 7: Failed to connect to api.anthropic.com', new Request('POST', 'https://api.anthropic.com/v1/messages'));
            },
        ]);
        $claude = new ClaudeMessagesService(new Client(['handler' => HandlerStack::create($mock)]));
        Http::fake(['groq.test/*' => Http::response(['id' => 'r', 'model' => 'm', 'output_text' => 'From Groq.'])]);
        $chain = new FallbackTextGenerator($claude, new GroqResponsesService);

        $this->assertSame('From Groq.', $chain->generate('i', 'x')['text']);
        $this->assertSame('From Groq.', $chain->generate('i', 'x')['text']);
        $this->assertSame(1, $claudeCalls, 'the second request skips Claude');
        $this->assertTrue(Cache::has('ai:provider-cooldown:anthropic'));
    }

    public function test_a_real_claude_timeout_under_the_shared_deadline_does_not_rest_claude(): void
    {
        $claudeCalls = 0;
        $mock = new MockHandler([
            function () use (&$claudeCalls) {
                $claudeCalls++;

                return new ConnectException('cURL error 28: Operation timed out', new Request('POST', 'https://api.anthropic.com/v1/messages'));
            },
            function () use (&$claudeCalls) {
                $claudeCalls++;

                return new ConnectException('cURL error 28: Operation timed out', new Request('POST', 'https://api.anthropic.com/v1/messages'));
            },
        ]);
        $claude = new ClaudeMessagesService(new Client(['handler' => HandlerStack::create($mock)]));
        Http::fake(['groq.test/*' => Http::response(['id' => 'r', 'model' => 'm', 'output_text' => 'From Groq.'])]);
        $chain = new FallbackTextGenerator($claude, new GroqResponsesService);

        $chain->generate('i', 'x');
        $chain->generate('i', 'x');

        $this->assertSame(2, $claudeCalls, 'a slow answer under the shortened budget must not switch Claude off for everyone');
        $this->assertFalse(Cache::has('ai:provider-cooldown:anthropic'));
    }

    public function test_groq_rests_for_a_timeout_only_at_its_full_timeout(): void
    {
        $message = 'cURL error 28: Operation timed out';
        Http::fake(['groq.test/*' => function () use (&$message) {
            throw new ConnectionException($message);
        }]);

        $groq = new GroqResponsesService;
        $groq->withTimeBudget(4.0);
        $this->assertNull($groq->generate('i', 'x'));
        $this->assertFalse($groq->lastCallUnreachable());

        $groq->withTimeBudget(null);
        $this->assertNull($groq->generate('i', 'x'));
        $this->assertTrue($groq->lastCallUnreachable());

        $message = 'cURL error 7: Failed to connect';
        $groq->withTimeBudget(4.0);
        $this->assertNull($groq->generate('i', 'x'));
        $this->assertTrue($groq->lastCallUnreachable());
    }

    public function test_a_real_groq_http_error_does_not_rest_groq_but_a_connection_failure_does(): void
    {
        $groq = new GroqResponsesService;
        Http::fake(['groq.test/*' => Http::response('boom', 500)]);
        $this->assertNull($groq->generate('i', 'x'));
        $this->assertFalse($groq->lastCallUnreachable());

        Http::fake(['groq.test/*' => fn () => throw new ConnectionException('cURL error 28')]);
        $this->assertNull($groq->generate('i', 'x'));
        $this->assertTrue($groq->lastCallUnreachable());
    }

    public function test_the_log_never_carries_what_the_user_typed(): void
    {
        Log::spy();
        $down = new ClaudeProbe(null, 0, true);
        $secondary = new GroqProbe(null);
        $chain = new FallbackTextGenerator($down, $secondary);

        $chain->generate('private instructions', 'Maria Santos owes PHP 5,000');
        $chain->generate('private instructions', 'Maria Santos owes PHP 5,000');

        Log::shouldHaveReceived('info')->withArgs(fn (string $message, array $context) => $message === 'AI provider skipped while cooling off.'
            && ! str_contains(json_encode($context), 'Maria'))->once();
    }

    private function seconds(object $service): int|float
    {
        $method = new \ReflectionMethod($service, 'requestSeconds');

        return $method->invoke($service);
    }
}

trait ProbeBehavior
{
    public int $calls = 0;

    public ?float $budget = null;

    public ?float $ceiling = null;

    private ?float $pending = null;

    private ?float $pendingCeiling = null;

    public function __construct(private readonly ?array $answer, private readonly int $sleepMicroseconds = 0, private readonly bool $down = false) {}

    public function withTimeBudget(?float $seconds, ?float $ceiling = null): void
    {
        $this->pending = $seconds;
        $this->pendingCeiling = $ceiling;
    }

    public function lastCallUnreachable(): bool
    {
        return $this->down;
    }

    public function generate(string $instructions, string $input, int $maxOutputTokens = 400, float $temperature = 0.2): ?array
    {
        return $this->answer();
    }

    public function generateStructured(string $instructions, array $input, string $schemaName, array $schema, int $maxOutputTokens = 1800, float $temperature = 0.2): ?array
    {
        return $this->answer();
    }

    public function converse(string $instructions, array $messages, int $maxOutputTokens = 1400, ?callable $onEvent = null): ?array
    {
        return $this->answer();
    }

    private function answer(): ?array
    {
        $this->calls++;
        $this->budget = $this->pending;
        $this->ceiling = $this->pendingCeiling;
        usleep($this->sleepMicroseconds);

        return $this->answer;
    }
}

class ClaudeProbe extends ClaudeMessagesService
{
    use ProbeBehavior;
}

class GroqProbe extends GroqResponsesService
{
    use ProbeBehavior;
}
