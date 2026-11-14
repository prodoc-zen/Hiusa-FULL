<?php

namespace Tests\Feature;

use App\Services\Ai\FallbackTextGenerator;
use App\Services\GroqResponsesService;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class AskAiChatDeadlineTest extends TestCase
{
    public function test_the_primary_and_the_secondary_share_one_chat_deadline_and_the_primary_cannot_take_all_of_it(): void
    {
        config([
            'services.groq.key' => 'test-groq-key',
            'services.groq.url' => 'https://groq.test/v1/responses',
            'services.groq.model' => 'groq-test-model',
            'services.groq.timeout' => 12,
            'services.anthropic.chat_timeout' => 2,
        ]);
        $timeouts = [];
        $calls = 0;
        Http::fake(function ($request, $options) use (&$timeouts, &$calls) {
            $timeouts[] = $options['timeout'] ?? null;

            return ++$calls === 1
                ? Http::response(['error' => 'down'], 500)
                : Http::response(['id' => 'resp_2', 'model' => 'groq-test-model', 'output_text' => 'From the second provider.']);
        });

        $result = (new FallbackTextGenerator(new GroqResponsesService, new GroqResponsesService))
            ->converse('i', [['role' => 'user', 'content' => 'hi']]);

        $this->assertSame('From the second provider.', $result['text']);
        $this->assertSame(17, FallbackTextGenerator::chatDeadlineSeconds());
        // The first provider is held to its share (the chat timeout), the second gets what is left, up to its own cap.
        $this->assertEquals(2, $timeouts[0]);
        $this->assertEquals(12, $timeouts[1]);
    }
}
