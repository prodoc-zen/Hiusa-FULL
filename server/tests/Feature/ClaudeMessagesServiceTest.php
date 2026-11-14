<?php

namespace Tests\Feature;

use App\Services\Ai\ClaudeMessagesService;
use GuzzleHttp\Client;
use GuzzleHttp\Exception\ConnectException;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Middleware;
use GuzzleHttp\Psr7\FnStream;
use GuzzleHttp\Psr7\Request;
use GuzzleHttp\Psr7\Response;
use Illuminate\Support\Facades\Log;
use Psr\Http\Message\RequestInterface;
use Tests\TestCase;

class ClaudeMessagesServiceTest extends TestCase
{
    /** @var array<int, array{request: RequestInterface}> */
    private array $history = [];

    protected function setUp(): void
    {
        parent::setUp();
        config()->set('services.anthropic', [
            'key' => 'test-anthropic-key',
            'model' => 'claude-sonnet-5-5',
            'effort' => 'low',
            'timeout' => 8,
            'connect_timeout' => 3,
        ]);
        $this->history = [];
    }

    public function test_it_returns_text_model_and_response_id_and_sends_the_supported_request_shape(): void
    {
        $service = $this->service([$this->message('The treasury is stable.')]);

        $result = $service->generate('Use only supplied figures.', 'Income: 1000.', 220, 0.2);

        $this->assertSame(['text' => 'The treasury is stable.', 'model' => 'claude-sonnet-5-5', 'response_id' => 'msg_test_1'], $result);
        $this->assertSame('end_turn', $service->lastStopReason());

        $this->assertCount(1, $this->history);
        $request = $this->history[0]['request'];
        $body = json_decode((string) $request->getBody(), true);
        $this->assertSame('Bearer test-anthropic-key', $request->getHeaderLine('Authorization'));
        $this->assertSame('claude-sonnet-5-5', $body['model']);
        $this->assertSame('Use only supplied figures.', $body['system']);
        $this->assertSame([['role' => 'user', 'content' => 'Income: 1000.']], $body['messages']);
        $this->assertSame(330, $body['max_tokens']);
        $this->assertSame(['type' => 'between_tools'], $body['thinking']);
        $this->assertSame('low', $body['output_config']['effort']);
        // Sonnet 5.5 answers 400 to any sampling parameter.
        foreach (['temperature', 'top_p', 'top_k'] as $rejected) {
            $this->assertArrayNotHasKey($rejected, $body);
        }
    }

    public function test_it_joins_text_blocks_and_skips_other_blocks(): void
    {
        $service = $this->service([$this->message(null, content: [
            ['type' => 'thinking', 'thinking' => 'private notes', 'signature' => 'sig'],
            ['type' => 'text', 'text' => 'First.'],
            ['type' => 'text', 'text' => 'Second.'],
        ])]);

        $this->assertSame('First.'."\n".'Second.', $service->generate('i', 'x')['text']);
    }

    public function test_it_does_nothing_without_a_key(): void
    {
        config()->set('services.anthropic.key', '');
        $service = $this->service([$this->message('never used')]);

        $this->assertNull($service->generate('i', 'x'));
        $this->assertCount(0, $this->history);
    }

    public function test_a_refusal_is_null_and_its_text_is_not_returned(): void
    {
        Log::spy();
        $service = $this->service([$this->message('I cannot help with that.', stopReason: 'refusal')]);

        $this->assertNull($service->generate('i', 'x'));
        $this->assertSame('refusal', $service->lastStopReason());
        Log::shouldHaveReceived('warning')->withArgs(fn (string $message, array $context) => $message === 'Claude did not finish an answer.' && $context['stop_reason'] === 'refusal')->once();
    }

    public function test_a_cut_off_answer_is_null(): void
    {
        $service = $this->service([$this->message('The treasury is sta', stopReason: 'max_tokens')]);

        $this->assertNull($service->generate('i', 'x'));
        $this->assertSame('max_tokens', $service->lastStopReason());
    }

    public function test_an_empty_answer_is_null(): void
    {
        $service = $this->service([$this->message('   ')]);

        $this->assertNull($service->generate('i', 'x'));
    }

    public function test_a_timeout_or_unreachable_api_is_null_without_retrying(): void
    {
        Log::spy();
        $service = $this->service([
            new ConnectException('cURL error 28: Operation timed out', new Request('POST', 'https://api.anthropic.com/v1/messages')),
            $this->message('would be a retry'),
        ]);

        $this->assertNull($service->generate('i', 'x'));
        $this->assertCount(1, $this->history, 'a second Claude attempt would push the page past its time cap');
        Log::shouldHaveReceived('warning')->withArgs(fn (string $message, array $context) => $message === 'Claude is unavailable.' && str_contains($context['exception'], 'APIConnectionException'))->once();
    }

    public function test_http_errors_are_null_and_never_log_the_prompt(): void
    {
        foreach ([401 => 'authentication_error', 429 => 'rate_limit_error', 400 => 'invalid_request_error', 529 => 'overloaded_error', 500 => 'api_error'] as $status => $type) {
            Log::spy();
            $this->history = [];
            $service = $this->service([new Response($status, ['content-type' => 'application/json'], json_encode(['type' => 'error', 'error' => ['type' => $type, 'message' => 'boom student-secret-text']]))]);

            $this->assertNull($service->generate('instructions', 'student-secret-text'), "status {$status}");
            Log::shouldHaveReceived('warning')->withArgs(function (string $message, array $context) use ($status) {
                return $message === 'Claude is unavailable.'
                    && $context['status'] === $status
                    && ! str_contains(json_encode($context), 'student-secret-text');
            })->once();
        }
    }

    public function test_structured_output_is_decoded_validated_and_sent_as_a_json_schema_format(): void
    {
        $schema = $this->schema();
        $service = $this->service([$this->message(json_encode(['explanations' => [['task_id' => 4, 'explanation' => 'Best fit.']]]))]);

        $result = $service->generateStructured('Explain.', ['event_id' => 1], 'hiusa_test', $schema, 300, 0.2);

        $this->assertSame([['task_id' => 4, 'explanation' => 'Best fit.']], $result['data']['explanations']);
        $this->assertSame('claude-sonnet-5-5', $result['model']);
        $body = json_decode((string) $this->history[0]['request']->getBody(), true);
        $this->assertSame('{"event_id":1}', $body['messages'][0]['content']);
        $this->assertSame('json_schema', $body['output_config']['format']['type']);
        $this->assertSame('low', $body['output_config']['effort']);
        $this->assertArrayNotHasKey('temperature', $body);
        $this->assertArrayNotHasKey('tools', $body);
        $this->assertArrayNotHasKey('tool_choice', $body);
    }

    public function test_the_schema_sent_drops_bounds_the_api_rejects_but_keeps_the_rest(): void
    {
        $schema = [
            'type' => 'object',
            'additionalProperties' => false,
            'required' => ['items', 'note'],
            'properties' => [
                'items' => ['type' => 'array', 'minItems' => 3, 'maxItems' => 30, 'items' => ['type' => 'string', 'maxLength' => 40]],
                'note' => ['type' => ['string', 'null']],
                'maxItems' => ['type' => 'string'],
            ],
        ];
        $service = $this->service([$this->message(json_encode(['items' => ['a', 'b', 'c'], 'note' => null]))]);

        $this->assertNotNull($service->generateStructured('i', ['x' => 1], 'n', $schema));

        $sent = json_decode((string) $this->history[0]['request']->getBody(), true)['output_config']['format']['schema'];
        $this->assertSame(1, $sent['properties']['items']['minItems']);
        $this->assertArrayNotHasKey('maxItems', $sent['properties']['items']);
        $this->assertArrayNotHasKey('maxLength', $sent['properties']['items']['items']);
        $this->assertSame([['type' => 'string'], ['type' => 'null']], $sent['properties']['note']['anyOf']);
        $this->assertArrayHasKey('maxItems', $sent['properties'], 'a property that happens to be named like a keyword is kept');
        $this->assertSame(['items', 'note'], $sent['required']);
    }

    public function test_malformed_structured_output_is_null(): void
    {
        $cases = [
            'not json' => 'Here is your plan: it is great.',
            'a list' => '[1,2,3]',
            'missing a required key' => json_encode(['other' => []]),
            'wrong type' => json_encode(['explanations' => 'none']),
            'nested required key missing' => json_encode(['explanations' => [['task_id' => 4]]]),
            'wrong nested type' => json_encode(['explanations' => [['task_id' => 'four', 'explanation' => 'x']]]),
        ];

        foreach ($cases as $label => $text) {
            $this->history = [];
            $service = $this->service([$this->message($text)]);

            $this->assertNull($service->generateStructured('i', ['x' => 1], 'n', $this->schema()), $label);
        }
    }

    public function test_structured_array_sizes_from_the_original_schema_are_enforced_locally(): void
    {
        $schema = ['type' => 'object', 'required' => ['tasks'], 'properties' => ['tasks' => ['type' => 'array', 'minItems' => 3, 'maxItems' => 4, 'items' => ['type' => 'string']]]];

        foreach ([[['a', 'b']], [['a', 'b', 'c', 'd', 'e']]] as [$tasks]) {
            $service = $this->service([$this->message(json_encode(['tasks' => $tasks]))]);
            $this->assertNull($service->generateStructured('i', ['x' => 1], 'n', $schema), count($tasks).' tasks');
        }

        $service = $this->service([$this->message(json_encode(['tasks' => ['a', 'b', 'c']]))]);
        $this->assertSame(['tasks' => ['a', 'b', 'c']], $service->generateStructured('i', ['x' => 1], 'n', $schema)['data']);
    }

    public function test_a_structured_refusal_or_truncation_is_null_even_if_the_text_looks_like_json(): void
    {
        foreach (['refusal', 'max_tokens'] as $reason) {
            $service = $this->service([$this->message(json_encode(['explanations' => []]), stopReason: $reason)]);

            $this->assertNull($service->generateStructured('i', ['x' => 1], 'n', $this->schema()), $reason);
        }
    }

    public function test_a_conversation_streams_reasoning_then_text_and_returns_the_whole_answer(): void
    {
        config()->set('services.anthropic.chat_effort', 'medium');
        config()->set('services.anthropic.chat_timeout', 60);
        $service = $this->service([$this->stream([
            ['thinking', 'Looking at '], ['thinking', 'the records.'], ['text', 'Three organizations '], ['text', 'are missing files.'],
        ])]);
        $events = [];

        $result = $service->converse('Be brief.', [
            ['role' => 'user', 'content' => 'Earlier question'],
            ['role' => 'assistant', 'content' => 'Earlier answer'],
            ['role' => 'user', 'content' => 'And now?'],
        ], 1400, function (string $type, string $delta) use (&$events) {
            $events[] = [$type, $delta];
        });

        $this->assertSame([
            ['reasoning', 'Looking at '], ['reasoning', 'the records.'], ['text', 'Three organizations '], ['text', 'are missing files.'],
        ], $events);
        $this->assertSame([
            'text' => 'Three organizations are missing files.',
            'reasoning' => 'Looking at the records.',
            'model' => 'claude-sonnet-5-5',
            'response_id' => 'msg_stream_1',
        ], $result);
        $this->assertSame('end_turn', $service->lastStopReason());

        $body = json_decode((string) $this->history[0]['request']->getBody(), true);
        $this->assertTrue($body['stream']);
        $this->assertSame(['type' => 'adaptive', 'display' => 'summarized'], $body['thinking']);
        $this->assertSame('medium', $body['output_config']['effort']);
        $this->assertSame([['type' => 'text', 'text' => 'Be brief.', 'cache_control' => ['type' => 'ephemeral']]], $body['system']);
        $this->assertCount(3, $body['messages']);
        $this->assertSame('And now?', $body['messages'][2]['content']);
        foreach (['temperature', 'top_p', 'top_k'] as $rejected) {
            $this->assertArrayNotHasKey($rejected, $body);
        }
        $this->assertArrayNotHasKey('budget_tokens', $body['thinking']);
    }

    public function test_a_conversation_without_thinking_has_null_reasoning(): void
    {
        $result = $this->service([$this->stream([['text', 'Plain answer.']])])->converse('i', [['role' => 'user', 'content' => 'hi']]);

        $this->assertSame('Plain answer.', $result['text']);
        $this->assertNull($result['reasoning']);
    }

    public function test_a_conversation_refusal_or_cut_off_answer_is_null(): void
    {
        foreach (['refusal', 'max_tokens'] as $reason) {
            $result = $this->service([$this->stream([['text', 'Partial']], $reason)])->converse('i', [['role' => 'user', 'content' => 'hi']]);

            $this->assertNull($result, $reason);
        }
    }

    public function test_a_conversation_connection_failure_is_null_and_logs_no_user_text(): void
    {
        Log::spy();
        $service = $this->service([new ConnectException('cURL error 28: timed out', new Request('POST', 'https://api.anthropic.com/v1/messages'))]);

        $this->assertNull($service->converse('private instructions', [['role' => 'user', 'content' => 'Maria Santos owes PHP 5,000']]));

        Log::shouldHaveReceived('warning')->withArgs(fn (string $message, array $context = []) => ! str_contains($message.json_encode($context), 'Maria') && ! str_contains($message.json_encode($context), 'private'))->once();
    }

    public function test_a_mid_stream_error_event_is_null_and_is_not_an_outage(): void
    {
        $body = (string) $this->stream([['text', 'Half an answer ']])->getBody();
        $body = substr($body, 0, strpos($body, 'event: content_block_stop'))
            ."event: error\ndata: ".json_encode(['type' => 'error', 'error' => ['type' => 'overloaded_error', 'message' => 'x']])."\n\n";
        $service = $this->service([new Response(200, ['content-type' => 'text/event-stream'], $body)]);
        $events = [];

        $result = $service->converse('i', [['role' => 'user', 'content' => 'hi']], 1400, function (string $type, string $delta) use (&$events) {
            $events[] = $delta;
        });

        $this->assertNull($result);
        $this->assertSame(['Half an answer '], $events);
        $this->assertFalse($service->lastCallUnreachable());
    }

    public function test_a_stream_that_ends_without_a_stop_reason_is_null(): void
    {
        $body = (string) $this->stream([['text', 'Cut off']])->getBody();
        $body = substr($body, 0, strpos($body, 'event: content_block_stop'));
        $service = $this->service([new Response(200, ['content-type' => 'text/event-stream'], $body)]);

        $this->assertNull($service->converse('i', [['role' => 'user', 'content' => 'hi']]));
        $this->assertNull($service->lastStopReason());
    }

    public function test_a_stream_that_keeps_trickling_past_the_chat_deadline_is_stopped_and_rests_claude(): void
    {
        config()->set('services.anthropic.chat_timeout', 1);
        $deltas = array_fill(0, 40, ['text', 'word ']);
        $inner = $this->stream($deltas)->getBody();
        $slow = FnStream::decorate($inner, ['read' => function ($length) use ($inner) {
            usleep(150_000);

            return $inner->read(min((int) $length, 60));
        }]);
        $service = $this->service([new Response(200, ['content-type' => 'text/event-stream'], $slow)]);
        $received = '';
        $started = microtime(true);

        $result = $service->converse('i', [['role' => 'user', 'content' => 'hi']], 1400, function (string $type, string $delta) use (&$received) {
            $received .= $delta;
        });

        $this->assertNull($result);
        $this->assertLessThan(3.0, microtime(true) - $started, 'the whole turn is bounded by chat_timeout, not each read');
        $this->assertLessThan(200, strlen($received), 'the stream was cut before the whole answer arrived');
        $this->assertTrue($service->lastCallUnreachable());
    }

    public function test_a_timeout_under_a_shortened_deadline_is_not_an_outage_but_one_at_full_timeout_is(): void
    {
        $timeout = fn () => new ConnectException('cURL error 28: Operation timed out', new Request('POST', 'https://api.anthropic.com/v1/messages'));

        $budgeted = $this->service([$timeout()]);
        $budgeted->withTimeBudget(4.0);
        $this->assertNull($budgeted->generate('i', 'x'));
        $this->assertFalse($budgeted->lastCallUnreachable());

        $full = $this->service([$timeout()]);
        $this->assertNull($full->generate('i', 'x'));
        $this->assertTrue($full->lastCallUnreachable());

        $refused = $this->service([new ConnectException('cURL error 7: Failed to connect', new Request('POST', 'https://api.anthropic.com/v1/messages'))]);
        $refused->withTimeBudget(4.0);
        $this->assertNull($refused->generate('i', 'x'));
        $this->assertTrue($refused->lastCallUnreachable());
    }

    public function test_a_conversation_without_a_key_or_messages_is_null_and_makes_no_request(): void
    {
        $this->assertNull($this->service([])->converse('i', []));
        config()->set('services.anthropic.key', '');
        $this->assertNull($this->service([])->converse('i', [['role' => 'user', 'content' => 'hi']]));
        $this->assertCount(0, $this->history);
    }

    public function test_an_exception_from_the_event_callback_is_rethrown(): void
    {
        $service = $this->service([$this->stream([['text', 'One.'], ['text', 'Two.']])]);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('client went away');

        $service->converse('i', [['role' => 'user', 'content' => 'hi']], 1400, function () {
            throw new \RuntimeException('client went away');
        });
    }

    public function test_the_guards_work_the_same_as_the_groq_ones(): void
    {
        $service = $this->service([]);

        $this->assertTrue($service->preservesNumericFacts('Income is PHP 12,500.50 at 80%.', ['income' => 12500.5, 'ratio' => 0.8]));
        $this->assertFalse($service->preservesNumericFacts('Income is PHP 99,999.', ['income' => 12500.5]));
        $this->assertSame("- one\nplain", $service->plainText("* one\n**plain**"));
    }

    private function schema(): array
    {
        return [
            'type' => 'object',
            'additionalProperties' => false,
            'required' => ['explanations'],
            'properties' => [
                'explanations' => [
                    'type' => 'array',
                    'items' => [
                        'type' => 'object',
                        'additionalProperties' => false,
                        'required' => ['task_id', 'explanation'],
                        'properties' => ['task_id' => ['type' => 'integer'], 'explanation' => ['type' => 'string']],
                    ],
                ],
            ],
        ];
    }

    /** @param  array<int, Response|\Throwable>  $queue */
    private function service(array $queue): ClaudeMessagesService
    {
        $stack = HandlerStack::create(new MockHandler($queue));
        $stack->push(Middleware::history($this->history));

        return new ClaudeMessagesService(new Client(['handler' => $stack]));
    }

    /**
     * A recorded Messages SSE body.
     *
     * @param  array<int, array{0: 'thinking'|'text', 1: string}>  $deltas
     */
    private function stream(array $deltas, string $stopReason = 'end_turn'): Response
    {
        $event = fn (string $name, array $data) => "event: {$name}\ndata: ".json_encode(['type' => $name] + $data)."\n\n";
        $body = $event('message_start', ['message' => [
            'id' => 'msg_stream_1', 'type' => 'message', 'role' => 'assistant', 'model' => 'claude-sonnet-5-5', 'content' => [],
            'stop_reason' => null, 'stop_sequence' => null, 'usage' => ['input_tokens' => 12, 'output_tokens' => 1],
        ]]);
        $index = -1;
        $current = null;
        foreach ($deltas as [$kind, $value]) {
            if ($current !== $kind) {
                if ($current !== null) {
                    $body .= $event('content_block_stop', ['index' => $index]);
                }
                $index++;
                $current = $kind;
                $block = $kind === 'thinking' ? ['type' => 'thinking', 'thinking' => '', 'signature' => ''] : ['type' => 'text', 'text' => ''];
                $body .= $event('content_block_start', ['index' => $index, 'content_block' => $block]);
            }
            $delta = $kind === 'thinking' ? ['type' => 'thinking_delta', 'thinking' => $value] : ['type' => 'text_delta', 'text' => $value];
            $body .= $event('content_block_delta', ['index' => $index, 'delta' => $delta]);
        }
        if ($current !== null) {
            $body .= $event('content_block_stop', ['index' => $index]);
        }
        $body .= $event('message_delta', ['delta' => ['stop_reason' => $stopReason, 'stop_sequence' => null], 'usage' => ['output_tokens' => 34]]);
        $body .= $event('message_stop', []);

        return new Response(200, ['content-type' => 'text/event-stream'], $body);
    }

    private function message(?string $text, string $stopReason = 'end_turn', ?array $content = null): Response
    {
        return new Response(200, ['content-type' => 'application/json'], json_encode([
            'id' => 'msg_test_1',
            'type' => 'message',
            'role' => 'assistant',
            'model' => 'claude-sonnet-5-5',
            'content' => $content ?? [['type' => 'text', 'text' => $text]],
            'stop_reason' => $stopReason,
            'stop_sequence' => null,
            'usage' => ['input_tokens' => 12, 'output_tokens' => 34],
        ]));
    }
}
