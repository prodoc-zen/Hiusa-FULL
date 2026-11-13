<?php

namespace Tests\Feature;

use App\Models\AiOutput;
use App\Models\Budget;
use App\Models\Event;
use App\Models\FinancialForecast;
use App\Models\Organization;
use App\Models\SboPosition;
use App\Models\Task;
use App\Models\Transaction;
use App\Models\User;
use App\Services\Ai\ClaudeMessagesService;
use GuzzleHttp\Client;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Middleware;
use GuzzleHttp\Psr7\Response;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Psr\Http\Message\RequestInterface;
use Tests\TestCase;

/**
 * Every language feature, three ways: Claude answers, Claude is down and Groq answers, both are down and the
 * deterministic text stands. Claude's HTTP layer and Groq's are both faked, so no test reaches a network.
 */
class ClaudeEndpointsTest extends TestCase
{
    use RefreshDatabase;

    private const MODES = ['claude' => ['claude'], 'claude down, groq answers' => ['groq'], 'both down' => ['none']];

    /** @var array<int, array{request: RequestInterface}> */
    private array $claudeHistory = [];

    /** @var array<int, array<string, mixed>> */
    private array $groqBodies = [];

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'performance.api_cache.enabled' => false,
            'services.hiusa_ai.enabled' => false,
        ]);
    }

    public static function modes(): array
    {
        return self::MODES;
    }

    /**
     * @param  string  $mode  claude | groq | none: who is allowed to answer
     * @param  callable(RequestInterface): string  $claudeText  the body text Claude answers with, from its request
     * @param  callable(array): string  $groqOutput  the Groq output_text from its request body
     */
    private function arrange(string $mode, callable $claudeText, ?callable $groqOutput = null): void
    {
        config([
            'services.anthropic.key' => 'test-anthropic-key',
            'services.ai.provider' => 'anthropic',
            'services.groq.key' => 'test-groq-key',
        ]);

        $claudeQueue = array_fill(0, 12, fn (RequestInterface $request) => $mode === 'claude'
            ? $this->claudeMessage($claudeText($request))
            : new Response(529, ['content-type' => 'application/json'], json_encode(['type' => 'error', 'error' => ['type' => 'overloaded_error', 'message' => 'Overloaded']])));
        $stack = HandlerStack::create(new MockHandler($claudeQueue));
        $stack->push(Middleware::history($this->claudeHistory));
        $this->app->bind(ClaudeMessagesService::class, fn () => new ClaudeMessagesService(new Client(['handler' => $stack])));

        Http::fake(function (HttpRequest $request) use ($mode, $groqOutput) {
            $this->groqBodies[] = $request->data();
            if ($mode === 'none') {
                return Http::response(['error' => 'unavailable'], 503);
            }

            return Http::response([
                'id' => 'resp_groq',
                'model' => 'groq-test-model',
                'output_text' => $groqOutput ? $groqOutput($request->data()) : 'Groq wrote this.',
            ]);
        });
    }

    private function claudeMessage(string $text): Response
    {
        return new Response(200, ['content-type' => 'application/json'], json_encode([
            'id' => 'msg_endpoint',
            'type' => 'message',
            'role' => 'assistant',
            'model' => 'claude-sonnet-5-5',
            'content' => [['type' => 'text', 'text' => $text]],
            'stop_reason' => 'end_turn',
            'stop_sequence' => null,
            'usage' => ['input_tokens' => 10, 'output_tokens' => 20],
        ]));
    }

    private function assertWho(string $mode): void
    {
        $groqCalls = count($this->groqBodies);
        match ($mode) {
            'claude' => $this->assertSame([1, 0], [count($this->claudeHistory), $groqCalls], 'Claude answered, so Groq must not be called'),
            'groq' => $this->assertSame([1, 1], [count($this->claudeHistory), $groqCalls], 'one failed Claude attempt, no retry, then one Groq call'),
            'none' => $this->assertSame([1, 1], [count($this->claudeHistory), $groqCalls]),
        };
    }

    private function admin(): User
    {
        return User::factory()->create(['organization_id' => Organization::factory(), 'role' => 'ADMIN', 'account_status' => 'active']);
    }

    #[DataProvider('modes')]
    public function test_announcement_draft(string $mode): void
    {
        $this->arrange($mode, fn () => "**Assembly**\n\n* Venue to be announced.", fn () => 'Groq draft.');
        Sanctum::actingAs($this->admin());

        $response = $this->postJson('/api/announcements/generate-draft', ['title' => 'General Assembly', 'target_role' => 'STUDENT', 'category' => 'events', 'details' => 'Venue not decided.'])->assertOk();

        match ($mode) {
            'claude' => $response->assertJsonPath('model_name', 'claude-sonnet-5-5')->assertJsonPath('is_template', false)->assertJsonPath('output_text', "Assembly\n\n- Venue to be announced."),
            'groq' => $response->assertJsonPath('model_name', 'groq-test-model')->assertJsonPath('is_template', false),
            'none' => $response->assertJsonPath('model_name', 'template-draft')->assertJsonPath('is_template', true),
        };
        $this->assertWho($mode);
        // The audience is sent as words, and the officer's own notes reach the model.
        $sent = json_decode((string) $this->claudeHistory[0]['request']->getBody(), true);
        $this->assertStringContainsString('Audience: Students', $sent['messages'][0]['content']);
        $this->assertStringContainsString('Venue not decided.', $sent['messages'][0]['content']);
    }

    #[DataProvider('modes')]
    public function test_budget_advice(string $mode): void
    {
        $text = 'Spending risk is high, so keep new commitments under the safe spending limit.';
        $this->arrange($mode, fn () => $text, fn () => $text);
        $admin = $this->admin();
        $budget = Budget::create(['organization_id' => $admin->organization_id, 'title' => 'Foundation Week', 'allocated_amount' => 1000, 'remaining_amount' => 1000, 'warning_threshold' => 100]);
        FinancialForecast::create(['organization_id' => $admin->organization_id, 'forecast_period' => now()->addMonth()->format('Y-m'), 'predicted_income' => 500, 'predicted_expense' => 900]);
        Sanctum::actingAs($admin);

        $response = $this->postJson("/api/budgets/{$budget->id}/advice")->assertOk();

        match ($mode) {
            'claude' => $response->assertJsonPath('advice.xai_model', 'claude-sonnet-5-5')->assertJsonPath('advice.xai_status', 'generated')->assertJsonPath('advice.advice', $text),
            'groq' => $response->assertJsonPath('advice.xai_model', 'groq-test-model')->assertJsonPath('advice.xai_status', 'generated'),
            'none' => $response->assertJsonPath('advice.xai_model', null)->assertJsonPath('advice.xai_status', 'unavailable'),
        };
        // The deterministic numbers never depend on who wrote the words.
        $response->assertJsonPath('advice.recommended_allocation', 480)->assertJsonPath('advice.forecast_risk', 'overspending');
        $this->assertWho($mode);
    }

    #[DataProvider('modes')]
    public function test_forecast_summary(string $mode): void
    {
        $text = 'The next month looks tight, so keep spending under the safe limit.';
        $this->arrange($mode, fn () => $text, fn () => $text);
        $admin = $this->admin();
        foreach ([[500, 600], [50, 650], [480, 700], [60, 750], [510, 800], [40, 850]] as $index => [$income, $expense]) {
            $period = now()->startOfMonth()->subMonths(6 - $index);
            Transaction::create(['organization_id' => $admin->organization_id, 'recorded_by' => $admin->school_id, 'type' => 'income', 'amount' => $income, 'category' => 'General', 'description' => 'Seed', 'transaction_date' => $period]);
            Transaction::create(['organization_id' => $admin->organization_id, 'recorded_by' => $admin->school_id, 'type' => 'expense', 'amount' => $expense, 'category' => 'General', 'description' => 'Seed', 'transaction_date' => $period]);
        }
        Sanctum::actingAs($admin);

        $this->postJson('/api/forecasts/generate', ['months' => 7])->assertCreated()->assertJsonPath('model_details.algorithm', 'ordinary_least_squares');

        $output = AiOutput::where('feature_type', 'FINANCIAL_SUMMARY')->latest('id')->firstOrFail();
        match ($mode) {
            'claude' => [$this->assertSame('claude-sonnet-5-5', $output->model_name), $this->assertSame('completed', $output->status)],
            'groq' => [$this->assertSame('groq-test-model', $output->model_name), $this->assertSame('completed', $output->status)],
            'none' => [$this->assertNull($output->model_name), $this->assertSame('failed', $output->status)],
        };
        $this->assertWho($mode);
        // This forecast is weak, and the sentence that says so is added whoever wrote the summary.
        if ($mode !== 'none') {
            $this->assertStringContainsString($text, $output->output_text);
        }
        $sent = json_decode((string) $this->claudeHistory[0]['request']->getBody(), true)['messages'][0]['content'];
        $this->assertStringContainsString('Reliability warning:', $sent);
        $this->assertStringContainsString('Expected income: PHP ', $sent);
    }

    #[DataProvider('modes')]
    public function test_financial_report_summary(string $mode): void
    {
        $text = 'The report shows income and expenses for the period and no budget advisory was generated.';
        $this->arrange($mode, fn () => '**'.$text.'**', fn () => $text);
        $admin = $this->admin();
        Transaction::create(['organization_id' => $admin->organization_id, 'recorded_by' => $admin->school_id, 'type' => 'income', 'amount' => 1000, 'category' => 'Dues', 'description' => 'Seed', 'transaction_date' => now()]);
        Sanctum::actingAs($admin);

        $response = $this->postJson('/api/financial-reports/generate', [
            'report_type' => 'monthly',
            'signatories' => ['treasurer' => 'Taylor Treasurer', 'president' => 'Pat President', 'adviser' => 'Alex Adviser', 'sbo_adviser' => 'Sam SBO Adviser'],
        ])->assertCreated();

        match ($mode) {
            'none' => $response->assertJsonPath('ai_summary_status', 'unavailable'),
            default => $response->assertJsonPath('ai_summary_status', 'generated')->assertJsonPath('report.summary_text', $text),
        };
        $output = AiOutput::where('feature_type', 'FINANCIAL_SUMMARY')->latest('id')->firstOrFail();
        $this->assertSame(['claude' => 'claude-sonnet-5-5', 'groq' => 'groq-test-model', 'none' => null][$mode], $output->model_name);
        $this->assertWho($mode);
        // The model is told which dates the report covers.
        $sent = json_decode((string) $this->claudeHistory[0]['request']->getBody(), true);
        $context = json_decode($sent['messages'][0]['content'], true);
        $this->assertSame(now()->startOfMonth()->toDateString(), $context['period']['start']);
    }

    #[DataProvider('modes')]
    public function test_task_assignment_note(string $mode): void
    {
        $text = 'Pat Treasurer is a primary finance match with a strong workload and performance record.';
        $this->arrange($mode, fn () => $text, fn () => $text);
        $admin = $this->admin();
        SboPosition::create(['organization_id' => $admin->organization_id, 'role' => 'SBO_OFFICER', 'title' => 'Treasurer', 'is_active' => true]);
        $treasurer = User::factory()->create(['organization_id' => $admin->organization_id, 'role' => 'SBO_OFFICER', 'account_status' => 'active', 'position_title' => 'Treasurer']);
        Sanctum::actingAs($admin);

        $response = $this->postJson('/api/tasks', ['title' => 'Prepare the budget liquidation report', 'assigned_to' => $treasurer->school_id, 'deadline' => now()->addWeek(), 'status' => 'pending'])->assertCreated();

        if ($mode === 'none') {
            $this->assertStringContainsString("inferred as 'finance'", $response->json('ai_recommendation_note'));
        } else {
            $response->assertJsonPath('ai_recommendation_note', $text);
        }
        $output = AiOutput::where('feature_type', 'TASK_EXPLANATION')->latest('id')->first();
        if ($output) {
            $this->assertSame(['claude' => 'claude-sonnet-5-5', 'groq' => 'groq-test-model', 'none' => null][$mode], $output->model_name);
        }
        $this->assertSame('finance', $response->json('delegation.task_area'));
        $this->assertWho($mode);
        $this->assertSame(1, Task::count());
    }

    #[DataProvider('modes')]
    public function test_event_plan_and_task_explanations(string $mode): void
    {
        $admin = $this->admin();
        $event = Event::factory()->create([
            'organization_id' => $admin->organization_id,
            'created_by' => $admin->school_id,
            'status' => 'planning',
            'start_time' => now()->addDays(30),
            'end_time' => now()->addDays(30)->addHours(3),
        ]);
        SboPosition::create(['organization_id' => $admin->organization_id, 'role' => 'SBO_OFFICER', 'title' => 'Business Manager', 'is_active' => true]);
        $officer = User::factory()->create(['organization_id' => $admin->organization_id, 'role' => 'SBO_OFFICER', 'account_status' => 'active', 'position_title' => 'Business Manager']);
        $workflow = $this->workflow($event);
        $explain = fn (array $input) => json_encode(['explanations' => collect($input['recommendations'])->map(fn ($row) => ['task_id' => $row['task_id'], 'explanation' => "Officer ranked {$row['rank']} with a total score of {$row['total_score']}."])->all()]);
        $answer = function (array $input) use ($workflow, $explain) {
            return isset($input['recommendations']) ? $explain($input) : json_encode($workflow);
        };

        // Claude's structured answers come from the JSON the request carried; Groq's from its own input field.
        $this->arrange(
            $mode,
            fn (RequestInterface $request) => $answer(json_decode(json_decode((string) $request->getBody(), true)['messages'][0]['content'], true)),
            fn (array $body) => $answer(json_decode((string) $body['input'], true)),
        );
        Sanctum::actingAs($admin);

        $draft = $this->postJson("/api/events/{$event->id}/generate-plan", ['requirements' => 'Plan registration and setup.']);

        if ($mode === 'none') {
            // The checklist template stands in, and it passes the same validation as a generated plan.
            $draft->assertCreated()->assertJsonPath('ai_output.model_name', 'template-draft');
            $this->assertWho('none');

            return;
        }
        $expected = $mode === 'claude' ? 'claude-sonnet-5-5' : 'groq-test-model';
        $draft->assertCreated()->assertJsonPath('ai_output.model_name', $expected)->assertJsonCount(3, 'workflow.tasks');

        // The plan request carries the clock, so the model can keep deadlines in the future.
        $sent = json_decode((string) $this->claudeHistory[0]['request']->getBody(), true);
        $this->assertArrayHasKey('current_time', json_decode($sent['messages'][0]['content'], true));
        $this->assertSame('json_schema', $sent['output_config']['format']['type']);

        $tasks = array_map(fn (array $task) => [...$task, 'assigned_to' => $officer->school_id], $draft->json('workflow.tasks'));
        $this->postJson("/api/events/{$event->id}/workflows/{$draft->json('ai_output.id')}/confirm", ['tasks' => $tasks])->assertCreated();

        $explanations = AiOutput::where('feature_type', 'TASK_EXPLANATION')->where('status', 'completed')->get();
        $this->assertCount(3, $explanations);
        $this->assertSame([$expected], $explanations->pluck('model_name')->unique()->values()->all());
        $this->assertTrue(Task::where('event_id', $event->id)->get()->every(fn (Task $task) => str_contains($task->ai_recommendation_note, 'total score')));
    }

    #[DataProvider('modes')]
    public function test_ask_ai_answer(string $mode): void
    {
        $text = 'Here is a short answer built from the supplied records.';
        $this->arrange($mode, fn () => $text, fn () => $text);
        Sanctum::actingAs($this->admin());

        $response = $this->postJson('/api/ai/assistant/ask', ['question' => 'What should I do today?'])->assertOk();

        match ($mode) {
            'claude' => $response->assertJsonPath('engine', 'claude+semantic_rag')->assertJsonPath('answer', $text)->assertJsonPath('rag_metadata.engine', 'Hybrid Semantic RAG + Claude LLM'),
            'groq' => $response->assertJsonPath('engine', 'groq+semantic_rag')->assertJsonPath('answer', $text)->assertJsonPath('rag_metadata.engine', 'Hybrid Semantic RAG + Groq LLM'),
            'none' => $response->assertJsonPath('engine', 'semantic_rag+deterministic'),
        };
        $this->assertSame(['claude' => 'claude-sonnet-5-5', 'groq' => 'groq-test-model', 'none' => null][$mode], AiOutput::where('feature_type', 'ASK_AI_ASSISTANT')->latest('id')->value('model_name'));
        $this->assertWho($mode);
    }

    public function test_a_claude_answer_that_invents_a_number_is_dropped_like_any_other_model_answer(): void
    {
        $this->arrange('claude', fn () => 'The safe spending limit is PHP 987,654.00 this month.');
        $admin = $this->admin();
        $budget = Budget::create(['organization_id' => $admin->organization_id, 'title' => 'Foundation Week', 'allocated_amount' => 1000, 'remaining_amount' => 1000, 'warning_threshold' => 100]);
        Sanctum::actingAs($admin);

        $this->postJson("/api/budgets/{$budget->id}/advice")->assertOk()
            ->assertJsonPath('advice.xai_status', 'unavailable')
            ->assertJsonPath('advice.xai_model', null);
    }

    private function workflow(Event $event): array
    {
        $task = fn (string $key, string $title, string $phase, string $priority, $deadline, ?string $dependsOn) => [
            'key' => $key, 'title' => $title, 'description' => $title.'.', 'phase' => $phase, 'priority' => $priority,
            'deadline' => $deadline->toISOString(), 'depends_on_key' => $dependsOn, 'recommended_role' => 'Business Manager',
        ];

        return [
            'overview' => 'Prepare and run the event from the supplied requirements.',
            'preparation_phases' => ['Confirm scope', 'Prepare logistics', 'Close records'],
            'timeline' => ['Approve scope', 'Set up the venue', 'Reconcile records'],
            'resources' => ['Registration materials'],
            'logistics' => ['Confirm room access'],
            'risks' => ['Venue not yet specified'],
            'scheduling_conflicts' => [],
            'tasks' => [
                $task('scope', 'Confirm event scope', 'pre_event', 'high', $event->start_time->copy()->subDays(10), null),
                $task('setup', 'Complete venue setup', 'event_day', 'critical', $event->start_time->copy()->addHour(), 'scope'),
                $task('close', 'Document event closeout', 'post_event', 'medium', $event->end_time->copy()->addDay(), 'setup'),
            ],
        ];
    }
}
