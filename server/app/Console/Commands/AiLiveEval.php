<?php

namespace App\Console\Commands;

use App\Contracts\TextGenerator;
use App\Models\Budget;
use App\Models\Event;
use App\Models\FinancialForecast;
use App\Models\Organization;
use App\Models\SboPosition;
use App\Models\Task;
use App\Models\Transaction;
use App\Models\User;
use App\Services\Ai\ClaudeMessagesService;
use App\Services\Ai\Evaluation\GroundingCheck;
use App\Services\Ai\Evaluation\RecordingTextGenerator;
use App\Services\Ai\Evaluation\ReportCheckFixture;
use App\Services\Ai\Evaluation\TemplateOnlyTextGenerator;
use App\Services\Ai\ReportCheckExplainer;
use App\Services\Ai\ReviewNoteDrafter;
use App\Services\Finance\FinancialReportChecks;
use App\Services\Ai\HandoverNoteDrafter;
use App\Services\Ai\SemesterNarrativeDrafter;
use Illuminate\Console\Command;
use Illuminate\Contracts\Http\Kernel;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

/**
 * Runs each of the eight language features once against a throwaway in-memory database of invented demo
 * data, through Claude only, and writes what was sent and what came back so a person can judge it.
 *
 * It never touches a configured database: it replaces the connection with SQLite in memory before it
 * migrates, and refuses to run in production.
 *
 * With --heldout it instead runs one feature over a file of held-out cases through that feature's runner
 * (HELDOUT_RUNNERS) and writes what was sent, what came back and the automatic checks for every case.
 * With --engine=template both providers are replaced by nothing, so every feature answers from its PHP template
 * and no API key is needed.
 */
class AiLiveEval extends Command
{
    protected $signature = 'ai:live-eval
        {--feature=* : Run only these features (announcement, budget_advice, event_plan, workflow_explanations, forecast_summary, report_summary, task_note, ask_ai)}
        {--out= : Folder for the eval-<feature>.json files (default storage/app/ai-live-eval)}
        {--heldout= : Path to a held-out .json case file; runs the runner registered for the file feature over its cases instead of the eight features}
        {--split= : dev or test, the split the --heldout file belongs to (taken from a .dev.json or .test.json name when left out)}
        {--engine=claude : claude (needs ANTHROPIC_API_KEY) or template (no model, every feature answers from its PHP template)}';

    protected $description = 'Run every Claude-backed feature once on invented demo data and check the numbers in each answer against its input (needs ANTHROPIC_API_KEY, never production).';

    private const FEATURES = ['announcement', 'budget_advice', 'event_plan', 'workflow_explanations', 'forecast_summary', 'report_summary', 'task_note', 'ask_ai'];

    private const SPLITS = ['dev', 'test'];

    private const ENGINES = ['claude', 'template'];

    /**
     * Held-out runners: case-file feature key -> name of the method here that runs one case. A runner takes the
     * case array and returns ['facts' => what was sent, 'text' => what came back, 'engine' => claude|groq|template,
     * 'checks' => [check name => bool]]. The slices that own a feature add its line and its method.
     *
     * @var array<string, string>
     */
    protected const HELDOUT_RUNNERS = [
        'report-checks' => 'heldoutReportCheck',
        'report_check' => 'heldoutReportCheck',
        'semester_narrative' => 'heldoutSemesterNarrative',
        'semester-narrative' => 'heldoutSemesterNarrative',
        'handover_note' => 'heldoutHandoverNote',
        'handover-notes' => 'heldoutHandoverNote',
        'review_note' => 'heldoutReviewNote',
        'review-notes' => 'heldoutReviewNote',
    ];

    private RecordingTextGenerator $recorder;

    /** Index in the recorder from which the current feature's calls start. */
    private int $callsFrom = 0;

    private ?string $lastError = null;

    /** @var array<string, mixed> */
    private array $ids = [];

    public function handle(): int
    {
        if ($this->laravel->environment('production')) {
            $this->error('Refusing to run in production.');

            return self::FAILURE;
        }

        $engine = (string) $this->option('engine');
        if (! in_array($engine, self::ENGINES, true)) {
            $this->error('Unknown engine: '.$engine.'. Use claude or template.');

            return self::FAILURE;
        }
        if ($engine === 'claude' && trim((string) config('services.anthropic.key')) === '') {
            $this->error('ANTHROPIC_API_KEY is not set in the environment.');

            return self::FAILURE;
        }

        if ($this->option('heldout') !== null) {
            return $this->handleHeldout($engine);
        }
        if ($this->option('split') !== null) {
            $this->error('--split only goes with --heldout.');

            return self::FAILURE;
        }

        $selected = $this->option('feature') ?: self::FEATURES;
        $unknown = array_diff($selected, self::FEATURES);
        if ($unknown !== []) {
            $this->error('Unknown feature: '.implode(', ', $unknown));

            return self::FAILURE;
        }

        $out = rtrim((string) ($this->option('out') ?: storage_path('app/ai-live-eval')), '/\\');
        if (! is_dir($out) && ! mkdir($out, 0777, true) && ! is_dir($out)) {
            $this->error("Cannot create {$out}.");

            return self::FAILURE;
        }

        $this->isolate();
        $this->useEngine($engine);
        $this->seed();

        $rows = [];
        foreach ($selected as $feature) {
            $rows[] = $this->runFeature($feature, $out);
        }

        $this->table(['feature', 'claude', 'ms', 'stop_reason', 'chars', 'numbers', 'ungrounded'], array_map(fn (array $row) => [
            $row['feature'], $row['claude'], $row['ms'], $row['stop_reason'], $row['chars'], $row['checked'], $row['violations'] === [] ? '-' : implode(' ', $row['violations']),
        ], $rows));

        return self::SUCCESS;
    }

    /** Held-out run: load and check the case file first, so a bad file costs no migration, then run every case. */
    private function handleHeldout(string $engine): int
    {
        if ($this->option('feature')) {
            $this->error('Use either --feature or --heldout, not both.');

            return self::FAILURE;
        }

        try {
            $loaded = $this->loadHeldout((string) $this->option('heldout'), $this->option('split') === null ? null : (string) $this->option('split'));
        } catch (\InvalidArgumentException $e) {
            $this->error($e->getMessage());

            return self::FAILURE;
        }

        $out = rtrim((string) ($this->option('out') ?: storage_path('app/ai-live-eval')), '/\\');
        if (! is_dir($out) && ! mkdir($out, 0777, true) && ! is_dir($out)) {
            $this->error("Cannot create {$out}.");

            return self::FAILURE;
        }

        $this->isolate();
        $this->useEngine($engine);
        $this->seed();

        $method = static::HELDOUT_RUNNERS[$loaded['feature']];
        $cases = [];
        foreach ($loaded['cases'] as $case) {
            $cases[] = $this->runHeldoutCase($method, $case);
        }

        $summary = $this->summarise($cases);
        file_put_contents("{$out}/heldout-{$loaded['feature']}-{$loaded['split']}.json", json_encode([
            'feature' => $loaded['feature'],
            'split' => $loaded['split'],
            'engine_requested' => $engine,
            'summary' => $summary,
            'cases' => $cases,
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

        $this->line(sprintf(
            '%s %s: %d cases, %d passed all checks (%s%%); %s',
            $loaded['feature'], $loaded['split'], $summary['cases'], $summary['passed_all'], $summary['pass_rate'],
            $summary['checks'] === [] ? 'no checks recorded' : implode(', ', array_map(fn (string $name, array $tally) => "{$name} {$tally['passed']}/{$tally['of']}", array_keys($summary['checks']), $summary['checks'])),
        ));

        return self::SUCCESS;
    }

    /**
     * Reads a held-out case file and proves it can be run: a JSON object with a feature that has a runner, and a
     * non-empty list of cases each carrying its own unique id. The split comes from --split or from a .dev.json or
     * .test.json file name; naming one and handing over the other is refused so a test set is never run as dev.
     *
     * @return array{feature: string, split: string, cases: list<array<string, mixed>>}
     *
     * @throws \InvalidArgumentException
     */
    private function loadHeldout(string $path, ?string $split): array
    {
        if ($split !== null && ! in_array($split, self::SPLITS, true)) {
            throw new \InvalidArgumentException('--split must be dev or test.');
        }
        $named = preg_match('/\.(dev|test)\.json$/i', $path, $m) === 1 ? strtolower($m[1]) : null;
        if ($split !== null && $named !== null && $split !== $named) {
            throw new \InvalidArgumentException("The file is a {$named} set but --split={$split} was given.");
        }
        $split ??= $named;
        if ($split === null) {
            throw new \InvalidArgumentException('Pass --split=dev or --split=test, or name the file <name>.dev.json or <name>.test.json.');
        }
        if (! is_file($path) || ! is_readable($path)) {
            throw new \InvalidArgumentException("Cannot read the case file {$path}.");
        }
        if (filesize($path) > 5_000_000) {
            throw new \InvalidArgumentException('The case file is over 5 MB.');
        }

        $decoded = json_decode((string) file_get_contents($path), true);
        if (! is_array($decoded) || array_is_list($decoded)) {
            throw new \InvalidArgumentException('The case file is not a JSON object.');
        }
        $feature = $decoded['feature'] ?? null;
        if (! is_string($feature) || $feature === '') {
            throw new \InvalidArgumentException('The case file has no "feature".');
        }
        $cases = $decoded['cases'] ?? null;
        if (! is_array($cases) || $cases === [] || ! array_is_list($cases)) {
            throw new \InvalidArgumentException('The case file has no "cases" list.');
        }
        $ids = [];
        foreach ($cases as $index => $case) {
            $id = is_array($case) ? ($case['id'] ?? null) : null;
            if (! is_string($id) || $id === '') {
                throw new \InvalidArgumentException('Case number '.($index + 1).' has no "id".');
            }
            if (isset($ids[$id])) {
                throw new \InvalidArgumentException("The case id {$id} appears twice.");
            }
            $ids[$id] = true;
        }

        $method = static::HELDOUT_RUNNERS[$feature] ?? null;
        if ($method === null || ! method_exists($this, $method)) {
            throw new \InvalidArgumentException("No held-out runner is registered for the feature {$feature}.");
        }

        return ['feature' => $feature, 'split' => $split, 'cases' => $cases];
    }

    /**
     * Runs one case and returns the record kept for it. A runner that throws fails its case; it never stops the run.
     *
     * @param  array<string, mixed>  $case
     * @return array<string, mixed>
     */
    private function runHeldoutCase(string $method, array $case): array
    {
        $record = ['id' => $case['id'], 'facts' => null, 'text' => null, 'engine' => null, 'checks' => [], 'error' => null];
        try {
            $result = $this->{$method}($case);
            $record['facts'] = $result['facts'] ?? null;
            $record['text'] = $result['text'] ?? null;
            $record['engine'] = $result['engine'] ?? null;
            $record['checks'] = array_map(fn ($passed) => (bool) $passed, (array) ($result['checks'] ?? []));
        } catch (\Throwable $e) {
            $record['error'] = get_class($e).': '.$e->getMessage();
        }
        $record['passed'] = $record['error'] === null && $record['checks'] !== [] && ! in_array(false, $record['checks'], true);

        return $record;
    }

    /**
     * @param  list<array<string, mixed>>  $cases
     * @return array{cases: int, passed_all: int, pass_rate: float, checks: array<string, array{passed: int, of: int}>}
     */
    private function summarise(array $cases): array
    {
        $checks = [];
        foreach ($cases as $case) {
            foreach ($case['checks'] as $name => $passed) {
                $checks[$name] ??= ['passed' => 0, 'of' => 0];
                $checks[$name]['of']++;
                $checks[$name]['passed'] += $passed ? 1 : 0;
            }
        }
        $passedAll = count(array_filter($cases, fn (array $case) => $case['passed']));

        return [
            'cases' => count($cases),
            'passed_all' => $passedAll,
            'pass_rate' => $cases === [] ? 0.0 : round($passedAll / count($cases) * 100, 1),
            'checks' => $checks,
        ];
    }

    /**
     * The prose of "Before you send": the case's ledger is seeded into the throwaway database, the rules run on it, and
     * the explainer orders the findings and words them. The rules themselves are judged by the PHPUnit held-out test;
     * this judges the words. A model answer that fails the explainer's own guards is replaced by the rules list, which
     * shows in the engine column as template.
     *
     * @param  array<string, mixed>  $case
     * @return array{facts: array<string, mixed>, text: string, engine: string, checks: array<string, bool>}
     */
    private function heldoutReportCheck(array $case): array
    {
        $fixture = ReportCheckFixture::seed($case);
        $findings = array_values($this->laravel->make(FinancialReportChecks::class)->forReport($fixture->report));
        $explained = $this->laravel->make(ReportCheckExplainer::class)->explainFromFindings($findings);

        $sentences = array_column($explained['items'], 'sentence', 'key');
        $supplied = array_map(fn (array $finding) => FinancialReportChecks::keyOf($finding), $findings);

        $mentioned = true;
        foreach ($findings as $finding) {
            $mentioned = $mentioned && $this->mentionsFinding((string) ($sentences[FinancialReportChecks::keyOf($finding)] ?? ''), $finding);
        }

        return [
            'facts' => $explained['facts'],
            'text' => $explained['text'],
            'engine' => $explained['engine'],
            'checks' => [
                'every_finding_mentioned' => $mentioned,
                'none_invented' => count($sentences) === count($supplied) && array_diff(array_keys($sentences), $supplied) === [],
                'no_unsupplied_number' => GroundingCheck::check($explained['text'], (string) json_encode($explained['facts'], JSON_UNESCAPED_UNICODE))['violations'] === [],
            ],
        ];
    }

    /** A sentence is about a finding when it carries one of that finding's amounts, names or categories. */
    private function mentionsFinding(string $sentence, array $finding): bool
    {
        $needles = [];
        array_walk_recursive($finding['facts'], function ($value) use (&$needles) {
            if (is_float($value) || is_int($value)) {
                $needles[] = number_format((float) $value, 2);
            } elseif (is_string($value) && ! preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) && ! in_array($value, ['income', 'expense'], true) && mb_strlen($value) > 2) {
                $needles[] = $value;
            }
        });
        $needles[] = match ($finding['code']) {
            'opening_balance_mismatch' => 'opening',
            'ledger_changed_since_generated' => 'ledger',
            default => '',
        };

        foreach (array_filter($needles) as $needle) {
            if (mb_stripos($sentence, (string) $needle) !== false) {
                return true;
            }
        }

        return false;
    }

    /** Puts the chosen engine behind the TextGenerator contract; template leaves no key for any provider. */
    private function useEngine(string $engine): void
    {
        if ($engine === 'template') {
            Config::set('services.anthropic.key', '');
            Config::set('services.groq.key', '');
            $this->recorder = new RecordingTextGenerator(new TemplateOnlyTextGenerator);
        } else {
            $this->recorder = new RecordingTextGenerator($this->laravel->make(ClaudeMessagesService::class));
        }
        $this->laravel->instance(TextGenerator::class, $this->recorder);
    }

    /** Swap whatever database is configured for an empty in-memory SQLite one, then prove the swap held. */
    private function isolate(): void
    {
        Config::set('database.default', 'sqlite');
        Config::set('database.connections.sqlite.database', ':memory:');
        Config::set('database.connections.sqlite.url', null);
        Config::set('cache.default', 'array');
        Config::set('queue.default', 'sync');
        Config::set('session.driver', 'array');
        Config::set('mail.default', 'log');
        Config::set('performance.api_cache.enabled', false);
        Config::set('services.hiusa_ai.enabled', false);
        Config::set('services.ai.provider', 'anthropic');
        DB::purge('sqlite');

        $connection = DB::connection();
        if ($connection->getDriverName() !== 'sqlite' || $connection->getDatabaseName() !== ':memory:') {
            throw new \RuntimeException('The evaluation database is not in-memory SQLite; stopping before any migration.');
        }

        Artisan::call('migrate', ['--force' => true]);
    }

    private function seed(): void
    {
        $organization = Organization::factory()->create(['name' => 'Computer Science Society', 'acronym' => 'CSS']);
        $admin = User::factory()->create(['organization_id' => $organization->id, 'role' => 'ADMIN', 'account_status' => 'active', 'first_name' => 'Maria', 'last_name' => 'Santos', 'email' => 'maria.santos@demo.test']);

        foreach (['President', 'Treasurer', 'Business Manager', 'Secretary'] as $title) {
            SboPosition::create(['organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'title' => $title, 'is_active' => true]);
        }
        $officers = [];
        foreach ([['President', 'Juan', 'Dela Cruz'], ['Treasurer', 'Ana', 'Reyes'], ['Business Manager', 'Pedro', 'Lim'], ['Secretary', 'Liza', 'Garcia']] as $index => [$title, $first, $last]) {
            $officers[$title] = User::factory()->create([
                'organization_id' => $organization->id, 'role' => 'SBO_OFFICER', 'account_status' => 'active', 'position_title' => $title,
                'first_name' => $first, 'last_name' => $last, 'email' => strtolower("{$first}.{$last}").'@demo.test',
            ]);
        }

        // Six full months of ledger history that ends last month: income swings, expenses climb.
        foreach ([[18500, 12400], [9200, 13100], [17800, 13900], [8800, 14600], [19400, 15200], [9900, 15800]] as $index => [$income, $expense]) {
            $month = now()->startOfMonth()->subMonths(6 - $index);
            Transaction::create(['organization_id' => $organization->id, 'recorded_by' => $admin->school_id, 'type' => 'income', 'amount' => $income, 'category' => 'Membership dues', 'description' => 'Collected dues', 'transaction_date' => $month->copy()->addDays(4)]);
            Transaction::create(['organization_id' => $organization->id, 'recorded_by' => $admin->school_id, 'type' => 'expense', 'amount' => $expense, 'category' => 'Events', 'description' => 'Event costs', 'transaction_date' => $month->copy()->addDays(9)]);
        }
        // This month, so a monthly report has something to say.
        Transaction::create(['organization_id' => $organization->id, 'recorded_by' => $admin->school_id, 'type' => 'income', 'amount' => 6400, 'category' => 'Membership dues', 'description' => 'Collected dues', 'transaction_date' => now()->startOfMonth()->addHours(9)]);
        Transaction::create(['organization_id' => $organization->id, 'recorded_by' => $admin->school_id, 'type' => 'expense', 'amount' => 2150.5, 'category' => 'Printing', 'description' => 'Posters and tarpaulin', 'transaction_date' => now()->startOfMonth()->addHours(10)]);

        $event = Event::factory()->create([
            'organization_id' => $organization->id, 'created_by' => $admin->school_id, 'status' => 'planning',
            'title' => 'Programming Contest 2026', 'description' => 'Annual inter-section programming contest for first and second year students.',
            'location' => 'Computer Laboratory 2', 'start_time' => now()->addDays(21)->setTime(8, 0), 'end_time' => now()->addDays(21)->setTime(16, 0), 'requires_budget' => true,
        ]);
        Event::factory()->create([
            'organization_id' => $organization->id, 'created_by' => $admin->school_id, 'status' => 'planning',
            'title' => 'Department Orientation', 'location' => 'Main Auditorium',
            'start_time' => now()->addDays(21)->setTime(13, 0), 'end_time' => now()->addDays(21)->setTime(17, 0),
        ]);
        $budget = Budget::create(['organization_id' => $organization->id, 'event_id' => $event->id, 'title' => 'Programming Contest budget', 'allocated_amount' => 25000, 'remaining_amount' => 21350.5, 'warning_threshold' => 3000]);
        FinancialForecast::create(['organization_id' => $organization->id, 'forecast_period' => now()->addMonth()->format('Y-m'), 'predicted_income' => 14200, 'predicted_expense' => 16100]);

        // The Treasurer has a real record: two open tasks and three finished, one of them late.
        $treasurer = $officers['Treasurer'];
        foreach (['Collect second-semester dues', 'Reconcile the cash box'] as $title) {
            Task::create(['organization_id' => $organization->id, 'created_by' => $admin->school_id, 'title' => $title, 'assigned_to' => $treasurer->school_id, 'status' => 'pending', 'deadline' => now()->addWeek(), 'task_type' => 'regular']);
        }
        foreach (['Liquidate the intramurals fund', 'Post the monthly ledger', 'Submit the audit folder'] as $title) {
            Task::create(['organization_id' => $organization->id, 'created_by' => $admin->school_id, 'title' => $title, 'assigned_to' => $treasurer->school_id, 'status' => 'completed', 'deadline' => now()->subWeek(), 'task_type' => 'regular', 'progress_percent' => 100, 'completed_at' => now()->subDays(2)]);
        }
        Task::where('assigned_to', $treasurer->school_id)->update(['assigned_at' => now()->subDays(6)]);

        $this->ids = ['admin' => $admin, 'treasurer' => $treasurer, 'officers' => $officers, 'event' => $event, 'budget' => $budget];
    }

    /** @return array<string, mixed> */
    private function runFeature(string $feature, string $out): array
    {
        $before = count($this->recorder->calls);
        $admin = $this->ids['admin'];
        $event = $this->ids['event'];

        $this->callsFrom = $before;
        $status = match ($feature) {
            'announcement' => $this->send($admin, 'POST', '/api/announcements/generate-draft', ['title' => 'Programming Contest Registration', 'target_role' => 'STUDENT', 'category' => 'events', 'details' => 'Open to first and second year students. Teams of three. Registration closes one week before the contest. Venue and prizes are still being finalized.']),
            'budget_advice' => $this->send($admin, 'POST', "/api/budgets/{$this->ids['budget']->id}/advice"),
            'event_plan' => $this->send($admin, 'POST', "/api/events/{$event->id}/generate-plan", ['requirements' => 'Teams of three, online judge on the laboratory network, certificates for the top three teams.']),
            'workflow_explanations' => $this->confirmWorkflow(),
            'forecast_summary' => $this->send($admin, 'POST', '/api/forecasts/generate', ['months' => 7]),
            'report_summary' => $this->send($admin, 'POST', '/api/financial-reports/generate', ['report_type' => 'monthly', 'signatories' => ['treasurer' => 'Ana Reyes', 'president' => 'Juan Dela Cruz', 'adviser' => 'Dr. Rosa Mercado', 'sbo_adviser' => 'Mr. Carlo Tan']]),
            'task_note' => $this->send($admin, 'POST', '/api/tasks', ['title' => 'Prepare the budget liquidation report', 'assigned_to' => $this->ids['treasurer']->school_id, 'deadline' => now()->addWeek()->toISOString(), 'status' => 'pending']),
            'ask_ai' => $this->send($admin, 'POST', '/api/ai/assistant/ask', ['question' => 'What needs my attention this week?']),
        };

        $calls = array_slice($this->recorder->calls, $this->callsFrom);
        $checks = array_map(fn (array $call) => GroundingCheck::check((string) $call['output'], (string) $call['input']), $calls);
        $violations = array_values(array_unique(array_merge(...array_column($checks, 'violations') ?: [[]])));
        $checked = array_sum(array_column($checks, 'checked'));

        file_put_contents($out.'/eval-'.$feature.'.json', json_encode([
            'feature' => $feature,
            'http_status' => $status,
            'http_error' => $status >= 400 ? $this->lastError : null,
            'calls' => $calls,
            'grounding' => ['numbers_checked' => $checked, 'ungrounded_numbers' => $violations],
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

        $all = $calls !== [] && count(array_filter($calls, fn (array $call) => $call['served_by_claude'])) === count($calls);
        $last = $calls === [] ? null : $calls[array_key_last($calls)];

        return [
            'feature' => $feature,
            'claude' => $calls === [] ? 'no call' : ($all ? 'yes' : 'NO'),
            'ms' => array_sum(array_column($calls, 'latency_ms')),
            'stop_reason' => $last['stop_reason'] ?? '-',
            'chars' => array_sum(array_column($calls, 'output_characters')),
            'checked' => $checked,
            'violations' => $violations,
        ];
    }

    /**
     * One semester-narrative case: the case's own facts go to the drafter exactly as the endpoint would send a digest.
     *
     * @param  array<string, mixed>  $case
     * @return array<string, mixed>
     */
    private function heldoutSemesterNarrative(array $case): array
    {
        $digest = [
            'organization' => $case['organization'] ?? '',
            'semester' => $case['semester'] ?? '',
            'events' => $case['events'] ?? [],
            'tasks' => $case['tasks'] ?? ['completed' => 0, 'overdue' => 0, 'open' => 0],
            'elections' => $case['elections'] ?? [],
            'merchandise' => $case['merchandise'] ?? ['orders' => 0, 'claimed' => 0],
            'announcements' => $case['announcements'] ?? ['posted' => 0],
            'finance' => $case['finance'] ?? ['income' => 0, 'expense' => 0, 'closing_balance' => 0],
            'upcoming_events' => $case['upcoming_events'] ?? [],
            'officers' => $case['officers'] ?? [],
        ];
        $expect = $case['expect'] ?? [];

        $draft = $this->laravel->make(SemesterNarrativeDrafter::class)->draftFromDigest($digest);
        $text = implode("\n\n", $draft['sections']);

        // Titles the case promises plus the ones its facts carry: a quoted phrase outside both is an invented title.
        $known = ['events' => array_map(fn ($title) => ['title' => $title], [...SemesterNarrativeDrafter::suppliedTitles($digest), ...($expect['titles'] ?? [])])];
        $checks = [
            'no_unsupplied_number' => GroundingCheck::check($text, (string) json_encode($digest, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES))['violations'] === [],
            'titles_subset' => SemesterNarrativeDrafter::quotesOnlySuppliedTitles($text, $known),
            'max_length' => ! in_array(true, array_map(fn (string $section) => SemesterNarrativeDrafter::words($section) > SemesterNarrativeDrafter::MAX_WORDS, $draft['sections']), true),
        ];
        if (($expect['cancelled_titles'] ?? []) !== []) {
            $checks['cancelled_not_held'] = ! SemesterNarrativeDrafter::describesCancelledAsHeld($text, $expect['cancelled_titles']);
        }
        if (($expect['empty'] ?? false) === true) {
            $checks['empty_semester_says_none'] = preg_match('/\bno events?\b/iu', $draft['sections']['accomplishments']) === 1;
        }

        return ['facts' => $digest, 'text' => $text, 'engine' => $draft['engine'], 'checks' => $checks];
    }

    /**
     * One handover-note case: the case's digest and open items go to the drafter, which narrows them to its category.
     *
     * @param  array<string, mixed>  $case
     * @return array<string, mixed>
     */
    private function heldoutHandoverNote(array $case): array
    {
        $expect = $case['expect'] ?? [];
        $draft = $this->laravel->make(HandoverNoteDrafter::class)->draftFromFacts([
            'category' => $case['category'] ?? '',
            'digest' => $case['digest'] ?? [],
            'open_items' => $case['open_items'] ?? [],
        ]);
        $text = $draft['text'];
        $mentions = fn (string $phrase) => mb_stripos($text, $phrase) !== false;

        return [
            'facts' => $draft['facts'],
            'text' => $text,
            'engine' => $draft['engine'],
            'checks' => [
                'no_unsupplied_number' => GroundingCheck::check($text, (string) json_encode($draft['facts'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES))['violations'] === [],
                'category_only' => ! in_array(true, array_map($mentions, $expect['must_not_mention'] ?? []), true),
                'must_mention' => ! in_array(false, array_map($mentions, $expect['must_mention'] ?? []), true),
                'max_length' => mb_strlen($text) <= HandoverNoteDrafter::MAX_CHARACTERS,
            ],
        ];
    }

    /**
     * Held-out runner for the review note drafter: the case minus its id and expect is the facts, and the text is
     * checked against what the case supplied and what it expects.
     *
     * @param  array<string, mixed>  $case
     * @return array<string, mixed>
     */
    protected function heldoutReviewNote(array $case): array
    {
        $facts = array_diff_key($case, ['id' => true, 'expect' => true]);
        $draft = $this->laravel->make(ReviewNoteDrafter::class)->draftFromFacts($facts);
        $text = $draft['text'];
        $expect = is_array($case['expect'] ?? null) ? $case['expect'] : [];
        $mentions = fn (string $needle) => mb_stripos($text, $needle) !== false;

        return [
            'facts' => $draft['facts'],
            'text' => $text,
            'engine' => $draft['engine'],
            'checks' => [
                'names_supplied_only' => ReviewNoteDrafter::namesAreSupplied($text, $draft['facts']),
                'no_unsupplied_number' => GroundingCheck::check($text, (string) json_encode($draft['facts'], JSON_UNESCAPED_UNICODE))['violations'] === [],
                'decision_word_consistent' => ReviewNoteDrafter::decisionWordsAgree($text, $draft['facts']),
                'max_120_words' => ReviewNoteDrafter::wordCount($text) <= ReviewNoteDrafter::MAX_WORDS,
                'must_mention' => collect((array) ($expect['must_mention'] ?? []))->every(fn ($needle) => $mentions((string) $needle)),
                'must_not_contain' => collect((array) ($expect['must_not_contain'] ?? []))->every(fn ($needle) => ! $mentions((string) $needle)),
            ],
        ];
    }

    private function confirmWorkflow(): int
    {
        // The explanations are written when the plan is confirmed, so the plan is built first and not counted.
        $admin = $this->ids['admin'];
        $event = $this->ids['event'];
        $draft = $this->dispatchAs($admin, 'POST', "/api/events/{$event->id}/generate-plan", ['requirements' => 'Teams of three, online judge on the laboratory network.']);
        $this->callsFrom = count($this->recorder->calls);
        if ($draft->getStatusCode() !== 201) {
            return $draft->getStatusCode();
        }
        $payload = json_decode((string) $draft->getContent(), true);
        // Spread over the officers: each may hold only a few open tasks at once.
        $officerIds = array_values(array_map(fn (User $officer) => $officer->school_id, $this->ids['officers']));
        $tasks = array_map(fn (array $task, int $index) => [...$task, 'assigned_to' => $officerIds[$index % count($officerIds)]], $payload['workflow']['tasks'], array_keys($payload['workflow']['tasks']));

        return $this->send($admin, 'POST', "/api/events/{$event->id}/workflows/{$payload['ai_output']['id']}/confirm", ['tasks' => $tasks]);
    }

    private function send(User $user, string $method, string $uri, array $data = []): int
    {
        return $this->dispatchAs($user, $method, $uri, $data)->getStatusCode();
    }

    private function dispatchAs(User $user, string $method, string $uri, array $data = []): Response
    {
        $token = $user->createToken('ai-live-eval')->plainTextToken;
        $request = Request::create($uri, $method, [], [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json', 'HTTP_AUTHORIZATION' => 'Bearer '.$token], $data === [] ? null : json_encode($data));

        $this->laravel['auth']->forgetGuards();

        $response = $this->laravel->make(Kernel::class)->handle($request);
        $this->lastError = null;
        if ($response->getStatusCode() >= 400) {
            // Validation messages and error text only; the request body is never echoed.
            $decoded = json_decode((string) $response->getContent(), true);
            $this->lastError = json_encode(['message' => $decoded['message'] ?? null, 'errors' => $decoded['errors'] ?? null], JSON_UNESCAPED_UNICODE);
        }

        return $response;
    }
}
