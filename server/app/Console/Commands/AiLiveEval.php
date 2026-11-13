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
 */
class AiLiveEval extends Command
{
    protected $signature = 'ai:live-eval
        {--feature=* : Run only these features (announcement, budget_advice, event_plan, workflow_explanations, forecast_summary, report_summary, task_note, ask_ai)}
        {--out=D:/Claude/scratch/hiusa-ai : Folder for the eval-<feature>.json files}';

    protected $description = 'Run every Claude-backed feature once on invented demo data and check the numbers in each answer against its input (needs ANTHROPIC_API_KEY, never production).';

    private const FEATURES = ['announcement', 'budget_advice', 'event_plan', 'workflow_explanations', 'forecast_summary', 'report_summary', 'task_note', 'ask_ai'];

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
        if (trim((string) config('services.anthropic.key')) === '') {
            $this->error('ANTHROPIC_API_KEY is not set in the environment.');

            return self::FAILURE;
        }

        $selected = $this->option('feature') ?: self::FEATURES;
        $unknown = array_diff($selected, self::FEATURES);
        if ($unknown !== []) {
            $this->error('Unknown feature: '.implode(', ', $unknown));

            return self::FAILURE;
        }

        $out = rtrim((string) $this->option('out'), '/\\');
        if (! is_dir($out) && ! mkdir($out, 0777, true) && ! is_dir($out)) {
            $this->error("Cannot create {$out}.");

            return self::FAILURE;
        }

        $this->isolate();
        $this->seed();

        $this->recorder = new RecordingTextGenerator($this->laravel->make(ClaudeMessagesService::class));
        $this->laravel->instance(TextGenerator::class, $this->recorder);

        $rows = [];
        foreach ($selected as $feature) {
            $rows[] = $this->runFeature($feature, $out);
        }

        $this->table(['feature', 'claude', 'ms', 'stop_reason', 'chars', 'numbers', 'ungrounded'], array_map(fn (array $row) => [
            $row['feature'], $row['claude'], $row['ms'], $row['stop_reason'], $row['chars'], $row['checked'], $row['violations'] === [] ? '-' : implode(' ', $row['violations']),
        ], $rows));

        return self::SUCCESS;
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
