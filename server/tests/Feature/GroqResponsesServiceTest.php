<?php

namespace Tests\Feature;

use App\Services\GroqResponsesService;
use Illuminate\Http\Client\Factory as HttpFactory;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class GroqResponsesServiceTest extends TestCase
{
    public function test_it_uses_the_groq_responses_api_and_extracts_output_text(): void
    {
        config()->set('services.groq', [
            'key' => 'test-groq-key',
            'url' => 'https://api.groq.com/openai/v1/responses',
            'model' => 'openai/gpt-oss-20b',
            'timeout' => 25,
        ]);
        Http::fake([
            'api.groq.com/*' => Http::response([
                'id' => 'resp_test_123',
                'model' => 'openai/gpt-oss-20b',
                'output' => [[
                    'type' => 'message',
                    'content' => [[
                        'type' => 'output_text',
                        'text' => 'Generated explanation.',
                    ]],
                ]],
            ]),
        ]);

        $result = app(GroqResponsesService::class)->generate(
            'Preserve the supplied figures.',
            'Income: 1000; expense: 400.',
            220,
            0.2,
        );

        $this->assertSame('Generated explanation.', $result['text']);
        $this->assertSame('openai/gpt-oss-20b', $result['model']);
        $this->assertSame('resp_test_123', $result['response_id']);

        Http::assertSent(function (Request $request): bool {
            return $request->url() === 'https://api.groq.com/openai/v1/responses'
                && $request->hasHeader('Authorization', 'Bearer test-groq-key')
                && $request['model'] === 'openai/gpt-oss-20b'
                && $request['instructions'] === 'Preserve the supplied figures.'
                && $request['input'] === 'Income: 1000; expense: 400.'
                && $request['reasoning']['effort'] === 'medium'
                // 220 asked for plus room for the reasoning that is counted in the same budget.
                && $request['max_output_tokens'] === 220 + 1536
                && ! isset($request['previous_response_id'], $request['store'], $request['truncation'], $request['include']);
        });
    }

    public function test_the_reasoning_effort_follows_config_and_only_low_has_no_reasoning_room(): void
    {
        foreach (['low' => 220, 'medium' => 220 + 1536, 'HIGH' => 220 + 3072, 'bogus' => 220 + 1536] as $configured => $tokens) {
            config()->set('services.groq', ['key' => 'k', 'url' => 'https://api.groq.com/openai/v1/responses', 'model' => 'openai/gpt-oss-120b', 'timeout' => 12, 'reasoning_effort' => $configured]);
            Http::swap(new HttpFactory);
            Http::fake(['api.groq.com/*' => Http::response(['id' => 'r', 'model' => 'openai/gpt-oss-120b', 'output_text' => 'ok'])]);

            app(GroqResponsesService::class)->generate('i', 'x', 220);

            Http::assertSent(fn (Request $request) => $request['max_output_tokens'] === $tokens
                && $request['reasoning']['effort'] === (strtolower($configured) === 'bogus' ? 'medium' : strtolower($configured)));
        }
    }

    public function test_a_400_at_medium_is_retried_once_at_low_with_the_original_budget(): void
    {
        config()->set('services.groq', ['key' => 'k', 'url' => 'https://api.groq.com/openai/v1/responses', 'model' => 'openai/gpt-oss-120b', 'timeout' => 12, 'reasoning_effort' => 'medium']);
        Http::fake(['api.groq.com/*' => Http::sequence()
            ->push(['error' => ['message' => 'unsupported reasoning effort']], 400)
            ->push(['id' => 'r2', 'model' => 'openai/gpt-oss-120b', 'output_text' => 'Answered at low.'])]);

        $result = app(GroqResponsesService::class)->generate('i', 'x', 220);

        $this->assertSame('Answered at low.', $result['text']);
        Http::assertSentCount(2);
        $sent = Http::recorded()->map(fn ($pair) => $pair[0])->values();
        $this->assertSame('medium', $sent[0]['reasoning']['effort']);
        $this->assertSame('low', $sent[1]['reasoning']['effort']);
        $this->assertSame(220, $sent[1]['max_output_tokens']);
    }

    public function test_a_400_at_low_or_a_non_400_error_is_not_retried(): void
    {
        foreach ([['low', 400], ['medium', 500], ['medium', 429]] as [$effort, $status]) {
            config()->set('services.groq', ['key' => 'k', 'url' => 'https://api.groq.com/openai/v1/responses', 'model' => 'm', 'timeout' => 12, 'reasoning_effort' => $effort]);
            Http::swap(new HttpFactory);
            Http::fake(['api.groq.com/*' => Http::response('boom', $status)]);

            $this->assertNull(app(GroqResponsesService::class)->generate('i', 'x'));
            Http::assertSentCount(1);
        }
    }

    public function test_it_returns_null_when_no_key_is_configured(): void
    {
        config()->set('services.groq.key', '');

        $this->assertNull(app(GroqResponsesService::class)->generate('Instructions', 'Input'));
        Http::assertNothingSent();
    }

    public function test_an_incomplete_response_is_a_failure_so_the_fallback_chain_moves_on(): void
    {
        config()->set('services.groq', [
            'key' => 'test-groq-key',
            'url' => 'https://api.groq.com/openai/v1/responses',
            'model' => 'openai/gpt-oss-20b',
            'timeout' => 25,
        ]);
        Http::fake(['api.groq.com/*' => Http::response([
            'id' => 'resp_cut_off',
            'model' => 'openai/gpt-oss-20b',
            'status' => 'incomplete',
            'incomplete_details' => ['reason' => 'max_output_tokens'],
            'output_text' => 'A summary that was cut off mid-sen',
        ])]);

        $this->assertNull(app(GroqResponsesService::class)->generate('Instructions', 'Input'));
    }

    public function test_a_failing_or_slow_groq_is_tried_once_and_capped_at_twelve_seconds(): void
    {
        config()->set('services.groq', [
            'key' => 'test-groq-key',
            'url' => 'https://api.groq.com/openai/v1/responses',
            'model' => 'openai/gpt-oss-20b',
            'timeout' => 30,
        ]);
        $timeouts = [];
        Http::fake(function ($request, $options) use (&$timeouts) {
            $timeouts[] = $options['timeout'] ?? null;

            return Http::response(['error' => 'rate limited'], 429);
        });

        $this->assertNull(app(GroqResponsesService::class)->generate('Instructions', 'Input'));

        $this->assertSame([12], $timeouts);
        Http::assertSentCount(1);
    }

    public function test_it_requests_and_validates_json_schema_output(): void
    {
        config()->set('services.groq', [
            'key' => 'test-groq-key',
            'url' => 'https://api.groq.com/openai/v1/responses',
            'model' => 'openai/gpt-oss-20b',
            'timeout' => 25,
            'connect_timeout' => 5,
        ]);
        Http::fake(['api.groq.com/*' => Http::response([
            'id' => 'resp_json',
            'model' => 'openai/gpt-oss-20b',
            'output_text' => '{"overview":"Validated"}',
        ])]);

        $schema = ['type' => 'object', 'additionalProperties' => false, 'required' => ['overview'], 'properties' => ['overview' => ['type' => 'string']]];
        $result = app(GroqResponsesService::class)->generateStructured('Use supplied facts.', ['event' => 'Assembly'], 'event_plan', $schema);

        $this->assertSame(['overview' => 'Validated'], $result['data']);
        Http::assertSent(fn (Request $request) => $request['text']['format']['type'] === 'json_schema'
            && $request['text']['format']['strict'] === true
            && $request['reasoning']['effort'] === 'medium'
            && $request['max_output_tokens'] === 1800 + 1536
            && $request['text']['format']['schema'] === $schema);
    }

    public function test_an_incomplete_structured_response_is_a_failure_even_when_its_text_parses(): void
    {
        config()->set('services.groq', [
            'key' => 'test-groq-key',
            'url' => 'https://api.groq.com/openai/v1/responses',
            'model' => 'openai/gpt-oss-20b',
            'timeout' => 25,
        ]);
        Http::fake(['api.groq.com/*' => Http::response([
            'id' => 'resp_cut_off_json',
            'model' => 'openai/gpt-oss-20b',
            'status' => 'incomplete',
            'incomplete_details' => ['reason' => 'max_output_tokens'],
            'output_text' => '{"overview":"Looks whole but the plan was cut off"}',
        ])]);

        $schema = ['type' => 'object', 'additionalProperties' => false, 'required' => ['overview'], 'properties' => ['overview' => ['type' => 'string']]];

        $this->assertNull(app(GroqResponsesService::class)->generateStructured('Use supplied facts.', ['event' => 'Assembly'], 'event_plan', $schema));
    }

    public function test_numeric_fact_guard_rejects_invented_figures(): void
    {
        $service = app(GroqResponsesService::class);
        $facts = ['income' => 50000, 'spent' => 38000, 'remaining' => 12000, 'forecasted_expense' => 15000, 'projected_balance' => -3000];

        $this->assertTrue($service->preservesNumericFacts(
            'From PHP 50,000.00, spending of 38,000 leaves 12,000; after 15,000 more, the balance is -3,000.',
            $facts,
        ));
        $this->assertTrue($service->preservesNumericFacts('The configured safety ratio is 80%.', ['safety_ratio' => 0.8]));
        $this->assertFalse($service->preservesNumericFacts(
            'The organization should secure an additional PHP 9,999.',
            $facts,
        ));
    }

    public function test_plain_text_removes_markdown_markers_from_display_copy(): void
    {
        $text = "# **Summary**\r\n\r\n* First **item**\r\n+ `Second` item\r\n\r\n\r\nDone";

        $this->assertSame(
            "Summary\n\n- First item\n- Second item\n\nDone",
            app(GroqResponsesService::class)->plainText($text),
        );
    }
}
