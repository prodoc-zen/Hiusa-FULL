<?php

namespace Tests\Feature;

use App\Services\GroqResponsesService;
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
                && $request['max_output_tokens'] === 220;
        });
    }

    public function test_it_returns_null_when_no_key_is_configured(): void
    {
        config()->set('services.groq.key', '');

        $this->assertNull(app(GroqResponsesService::class)->generate('Instructions', 'Input'));
        Http::assertNothingSent();
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
            && $request['text']['format']['schema'] === $schema);
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
}
