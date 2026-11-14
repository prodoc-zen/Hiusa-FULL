<?php

namespace Tests\Feature;

use App\Services\GroqResponsesService;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class GroqConverseTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        config(['services.groq.key' => 'test-groq-key', 'services.groq.url' => 'https://groq.test/v1/responses', 'services.groq.model' => 'groq-test-model']);
    }

    public function test_the_turns_go_out_as_the_input_array_and_the_whole_text_arrives_as_one_event(): void
    {
        Http::fake(['groq.test/*' => Http::response(['id' => 'resp_1', 'model' => 'groq-test-model', 'output_text' => 'The answer.'])]);
        $events = [];
        $messages = [
            ['role' => 'user', 'content' => 'First'],
            ['role' => 'assistant', 'content' => 'Reply'],
            ['role' => 'user', 'content' => 'Second'],
        ];

        $result = (new GroqResponsesService)->converse('Be brief.', $messages, 700, function (string $type, string $delta) use (&$events) {
            $events[] = [$type, $delta];
        });

        $this->assertSame(['text' => 'The answer.', 'reasoning' => null, 'model' => 'groq-test-model', 'response_id' => 'resp_1'], $result);
        $this->assertSame([['text', 'The answer.']], $events);
        Http::assertSent(function (Request $request) use ($messages) {
            $body = $request->data();

            return $body['instructions'] === 'Be brief.' && $body['input'] === $messages && $body['max_output_tokens'] === 700 && ! isset($body['stream']);
        });
    }

    public function test_a_failure_empty_text_or_no_messages_is_null_and_emits_nothing(): void
    {
        $events = [];
        $onEvent = function (string $type, string $delta) use (&$events) {
            $events[] = $type;
        };
        $turn = [['role' => 'user', 'content' => 'hi']];

        Http::fake(['groq.test/*' => Http::response(['error' => 'down'], 503)]);
        $this->assertNull((new GroqResponsesService)->converse('i', $turn, 400, $onEvent));

        Http::fake(['groq.test/*' => Http::response(['id' => 'r', 'output_text' => ''])]);
        $this->assertNull((new GroqResponsesService)->converse('i', $turn, 400, $onEvent));

        $this->assertNull((new GroqResponsesService)->converse('i', [], 400, $onEvent));
        $this->assertSame([], $events);
    }
}
