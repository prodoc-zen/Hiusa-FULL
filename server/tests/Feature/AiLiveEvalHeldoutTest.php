<?php

namespace Tests\Feature;

use App\Console\Commands\AiLiveEval;
use App\Contracts\TextGenerator;
use Illuminate\Contracts\Console\Kernel;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/** The held-out mechanism of ai:live-eval: the loader, the engine switch and the record a run leaves. */
class AiLiveEvalHeldoutTest extends TestCase
{
    /** @var list<string> */
    private array $paths = [];

    protected function tearDown(): void
    {
        foreach ($this->paths as $path) {
            is_dir($path) ? @rmdir($path) : @unlink($path);
        }
        parent::tearDown();
    }

    private function scratchDir(): string
    {
        $dir = sys_get_temp_dir().'/hiusa-heldout-test-'.bin2hex(random_bytes(4));
        mkdir($dir);
        $this->paths[] = $dir;

        return $dir;
    }

    /** Writes a case file inside a fresh folder and returns its path. */
    private function caseFile(string $name, mixed $content): string
    {
        $path = $this->scratchDir().'/'.$name;
        file_put_contents($path, is_string($content) ? $content : json_encode($content));
        array_unshift($this->paths, $path);

        return $path;
    }

    /** @return array<string, mixed> */
    private function validFile(string $feature = 'no_such_feature'): array
    {
        return ['feature' => $feature, 'author_note' => 'x', 'cases' => [['id' => 'a-01'], ['id' => 'a-02']]];
    }

    public function test_it_needs_no_key_with_the_template_engine(): void
    {
        config()->set('services.anthropic.key', '');
        $path = $this->caseFile('x.dev.json', $this->validFile());

        // Past the key check, the run stops on the registry and not on the missing key.
        $this->artisan('ai:live-eval', ['--engine' => 'template', '--heldout' => $path])
            ->expectsOutputToContain('No held-out runner is registered for the feature no_such_feature')
            ->assertFailed();
    }

    public function test_the_claude_engine_still_needs_a_key_for_a_held_out_run(): void
    {
        config()->set('services.anthropic.key', '');
        $path = $this->caseFile('x.dev.json', $this->validFile());

        $this->artisan('ai:live-eval', ['--heldout' => $path])->expectsOutputToContain('ANTHROPIC_API_KEY is not set')->assertFailed();
    }

    public function test_an_unknown_engine_is_refused(): void
    {
        $this->artisan('ai:live-eval', ['--engine' => 'gpt'])->expectsOutputToContain('Unknown engine: gpt')->assertFailed();
    }

    public function test_a_held_out_run_refuses_production(): void
    {
        $this->app['env'] = 'production';
        $path = $this->caseFile('x.dev.json', $this->validFile());

        $this->artisan('ai:live-eval', ['--engine' => 'template', '--heldout' => $path])->expectsOutputToContain('Refusing to run in production')->assertFailed();
    }

    /** @return array<string, array{0: string, 1: mixed, 2: array<string, string>, 3: string}> */
    public static function badFiles(): array
    {
        return [
            'neither option nor name gives a split' => ['x.json', ['feature' => 'f', 'cases' => [['id' => 'a']]], [], 'Pass --split=dev or --split=test'],
            'a split that is not dev or test' => ['x.dev.json', ['feature' => 'f', 'cases' => [['id' => 'a']]], ['--split' => 'prod'], '--split must be dev or test'],
            'a test file run as dev' => ['x.test.json', ['feature' => 'f', 'cases' => [['id' => 'a']]], ['--split' => 'dev'], 'The file is a test set but --split=dev was given'],
            'a dev file run as test' => ['x.dev.json', ['feature' => 'f', 'cases' => [['id' => 'a']]], ['--split' => 'test'], 'The file is a dev set but --split=test was given'],
            'not json' => ['x.dev.json', '{ nope', [], 'The case file is not a JSON object'],
            'a json list' => ['x.dev.json', [['id' => 'a']], [], 'The case file is not a JSON object'],
            'no feature' => ['x.dev.json', ['cases' => [['id' => 'a']]], [], 'The case file has no "feature"'],
            'no cases' => ['x.dev.json', ['feature' => 'f'], [], 'The case file has no "cases" list'],
            'an empty cases list' => ['x.dev.json', ['feature' => 'f', 'cases' => []], [], 'The case file has no "cases" list'],
            'a case without an id' => ['x.dev.json', ['feature' => 'f', 'cases' => [['id' => 'a'], ['title' => 'b']]], [], 'Case number 2 has no "id"'],
            'a repeated id' => ['x.dev.json', ['feature' => 'f', 'cases' => [['id' => 'a'], ['id' => 'a']]], [], 'The case id a appears twice'],
            'a feature with no runner' => ['x.dev.json', ['feature' => 'f', 'cases' => [['id' => 'a']]], [], 'No held-out runner is registered for the feature f'],
        ];
    }

    #[DataProvider('badFiles')]
    public function test_the_loader_refuses_a_file_it_cannot_run(string $name, mixed $content, array $options, string $message): void
    {
        $path = $this->caseFile($name, $content);

        $this->artisan('ai:live-eval', ['--engine' => 'template', '--heldout' => $path] + $options)->expectsOutputToContain($message)->assertFailed();
    }

    public function test_a_missing_file_is_refused(): void
    {
        $this->artisan('ai:live-eval', ['--engine' => 'template', '--heldout' => $this->scratchDir().'/none.dev.json'])
            ->expectsOutputToContain('Cannot read the case file')->assertFailed();
    }

    public function test_held_out_and_feature_cannot_be_combined(): void
    {
        $path = $this->caseFile('x.dev.json', $this->validFile());

        $this->artisan('ai:live-eval', ['--engine' => 'template', '--heldout' => $path, '--feature' => ['task_note']])
            ->expectsOutputToContain('Use either --feature or --heldout')->assertFailed();
    }

    public function test_split_alone_is_refused(): void
    {
        $this->artisan('ai:live-eval', ['--engine' => 'template', '--split' => 'dev'])->expectsOutputToContain('--split only goes with --heldout')->assertFailed();
    }

    public function test_a_registered_runner_is_run_for_every_case_and_recorded(): void
    {
        config()->set('services.anthropic.key', '');
        $this->app[Kernel::class]->registerCommand(new HeldoutFakeRunnerEval);
        $path = $this->caseFile('fake.test.json', ['feature' => 'fake', 'author_note' => 'x', 'cases' => [
            ['id' => 'f-01', 'word' => 'alpha'],
            ['id' => 'f-02', 'word' => 'beta'],
            ['id' => 'f-03', 'word' => 'boom'],
            ['id' => 'f-04', 'word' => 'gamma'],
        ]]);
        $out = $this->scratchDir();
        $this->paths[] = "{$out}/heldout-fake-test.json";

        // The split is read from the file name here.
        $this->artisan('ai:live-eval', ['--engine' => 'template', '--heldout' => $path, '--out' => $out])
            ->expectsOutputToContain('fake test: 4 cases, 2 passed all checks (50%); has_word 3/3, short 2/3')
            ->assertSuccessful();

        $record = json_decode((string) file_get_contents("{$out}/heldout-fake-test.json"), true);
        $this->assertSame(['fake', 'test', 'template'], [$record['feature'], $record['split'], $record['engine_requested']]);
        $this->assertSame(['cases' => 4, 'passed_all' => 2, 'pass_rate' => 50, 'checks' => ['has_word' => ['passed' => 3, 'of' => 3], 'short' => ['passed' => 2, 'of' => 3]]], $record['summary']);
        $this->assertSame(['f-01', 'f-02', 'f-03', 'f-04'], array_column($record['cases'], 'id'));

        [$first, $second, $third, $fourth] = $record['cases'];
        $this->assertSame(['word' => 'alpha'], $first['facts']);
        $this->assertSame('Draft: alpha', $first['text']);
        $this->assertSame('template', $first['engine'], 'with no model behind it the generator answers nothing and the template text is used');
        $this->assertSame(['has_word' => true, 'short' => true], $first['checks']);
        $this->assertTrue($first['passed']);
        $this->assertFalse($second['passed'], 'one failed check fails the case');
        $this->assertSame(['has_word' => true, 'short' => false], $second['checks']);
        $this->assertStringContainsString('RuntimeException: the runner broke', $third['error'], 'a runner that throws fails its own case only');
        $this->assertFalse($third['passed']);
        $this->assertTrue($fourth['passed']);
    }

    public function test_the_split_option_names_the_output_file(): void
    {
        config()->set('services.anthropic.key', '');
        $this->app[Kernel::class]->registerCommand(new HeldoutFakeRunnerEval);
        $path = $this->caseFile('cases.json', ['feature' => 'fake', 'cases' => [['id' => 'f-01', 'word' => 'alpha']]]);
        $out = $this->scratchDir();
        $this->paths[] = "{$out}/heldout-fake-dev.json";

        $this->artisan('ai:live-eval', ['--engine' => 'template', '--heldout' => $path, '--split' => 'dev', '--out' => $out])->assertSuccessful();

        $this->assertFileExists("{$out}/heldout-fake-dev.json");
    }

    public function test_the_template_engine_runs_the_eight_features_with_no_key_and_no_model(): void
    {
        config()->set('services.anthropic.key', '');
        config()->set('services.groq.key', 'would-be-used');
        $out = $this->scratchDir();
        $this->paths[] = "{$out}/eval-announcement.json";

        $this->artisan('ai:live-eval', ['--engine' => 'template', '--feature' => ['announcement'], '--out' => $out])->assertSuccessful();

        $record = json_decode((string) file_get_contents("{$out}/eval-announcement.json"), true);
        $this->assertSame(200, $record['http_status']);
        $this->assertNotSame([], $record['calls'], 'the announcement still asked for a draft');
        $this->assertSame([false], array_values(array_unique(array_column($record['calls'], 'served_by_claude'))));
        $this->assertStringNotContainsString('would-be-used', (string) file_get_contents("{$out}/eval-announcement.json"));
    }
}

/** A command with one registered runner, standing in for a feature's own while the registry is empty. */
class HeldoutFakeRunnerEval extends AiLiveEval
{
    protected const HELDOUT_RUNNERS = ['fake' => 'runFake'];

    /** @param  array<string, mixed>  $case */
    protected function runFake(array $case): array
    {
        if ($case['word'] === 'boom') {
            throw new \RuntimeException('the runner broke');
        }
        $facts = ['word' => $case['word']];
        $generated = $this->laravel->make(TextGenerator::class)->generate('Write one line.', json_encode($facts));
        $text = $generated['text'] ?? 'Draft: '.$case['word'];

        return [
            'facts' => $facts,
            'text' => $text,
            'engine' => $generated === null ? 'template' : 'claude',
            'checks' => ['has_word' => str_contains($text, $case['word']), 'short' => $case['word'] !== 'beta'],
        ];
    }
}
