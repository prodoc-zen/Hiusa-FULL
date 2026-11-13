<?php

namespace Tests\Feature;

use App\Services\Ai\ClaudeMessagesService;
use App\Services\Ai\Evaluation\GroundingCheck;
use GuzzleHttp\Client;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Psr7\Response;
use Tests\TestCase;

class AiLiveEvalTest extends TestCase
{
    public function test_grounding_finds_numbers_the_input_never_had(): void
    {
        $input = json_encode(['income' => 12500.5, 'ratio' => 0.8, 'when' => '2026-11-01', 'name' => 'Pedro Lim, 3 teams']);

        $this->assertSame(['checked' => 5, 'violations' => []], GroundingCheck::check('Income PHP 12,500.50 at 80% for 3 teams on November 1, 2026.', $input));
        $this->assertSame(['PHP 99'], array_map(fn ($token) => 'PHP '.$token, GroundingCheck::check('Spend PHP 99 now.', $input)['violations']));
        $this->assertSame(['-12,500.50'], GroundingCheck::check('A loss of -12,500.50.', $input)['violations'], 'a changed sign is a different number');
    }

    public function test_grounding_ignores_iso_deadlines_derived_from_supplied_times(): void
    {
        $result = GroundingCheck::check('Deadline 2026-12-01T08:00:00.000000Z for 3 tasks.', json_encode(['start' => '2026-12-14T08:00:00.000000Z', 'tasks' => 3]));

        $this->assertSame([], $result['violations']);
    }

    public function test_grounding_is_fast_on_a_long_run_of_digits_and_commas(): void
    {
        $started = microtime(true);
        GroundingCheck::check(str_repeat('1,', 50000).'x', str_repeat('9', 50000));

        $this->assertLessThan(1.0, microtime(true) - $started);
    }

    public function test_it_refuses_without_a_key(): void
    {
        config()->set('services.anthropic.key', '');

        $this->artisan('ai:live-eval')->expectsOutputToContain('ANTHROPIC_API_KEY is not set')->assertFailed();
    }

    public function test_it_refuses_in_production(): void
    {
        config()->set('services.anthropic.key', 'test-key');
        $this->app['env'] = 'production';

        $this->artisan('ai:live-eval')->expectsOutputToContain('Refusing to run in production')->assertFailed();
    }

    public function test_it_runs_every_feature_on_demo_data_and_writes_one_file_each(): void
    {
        config()->set('services.anthropic.key', 'test-key');
        // Any answer will do; the point is that each feature is reached and recorded. Structured calls get invalid JSON, so they fall back.
        $queue = array_fill(0, 40, fn () => new Response(200, ['content-type' => 'application/json'], json_encode([
            'id' => 'msg_eval', 'type' => 'message', 'role' => 'assistant', 'model' => 'claude-sonnet-5-5',
            'content' => [['type' => 'text', 'text' => 'A short answer with 9999 in it.']],
            'stop_reason' => 'end_turn', 'stop_sequence' => null, 'usage' => ['input_tokens' => 1, 'output_tokens' => 1],
        ])));
        $this->app->bind(ClaudeMessagesService::class, fn () => new ClaudeMessagesService(new Client(['handler' => HandlerStack::create(new MockHandler($queue))])));
        $out = sys_get_temp_dir().'/hiusa-ai-live-eval-test-'.bin2hex(random_bytes(4));

        $this->artisan('ai:live-eval', ['--out' => $out])->assertSuccessful();

        foreach (['announcement', 'budget_advice', 'event_plan', 'workflow_explanations', 'forecast_summary', 'report_summary', 'task_note', 'ask_ai'] as $feature) {
            $file = "{$out}/eval-{$feature}.json";
            $this->assertFileExists($file, $feature);
            $record = json_decode((string) file_get_contents($file), true);
            $this->assertSame($feature, $record['feature']);
            $this->assertArrayHasKey('ungrounded_numbers', $record['grounding']);
            $this->assertStringNotContainsString('test-key', (string) file_get_contents($file));
        }
        // The invented 9999 is flagged where Claude's text reached a plain-text feature.
        $announcement = json_decode((string) file_get_contents("{$out}/eval-announcement.json"), true);
        $this->assertTrue($announcement['calls'][0]['served_by_claude']);
        $this->assertSame(['9999'], $announcement['grounding']['ungrounded_numbers']);

        foreach (glob("{$out}/*") as $file) {
            unlink($file);
        }
        rmdir($out);
    }
}
