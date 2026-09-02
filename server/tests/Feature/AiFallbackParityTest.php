<?php

namespace Tests\Feature;

use App\Http\Controllers\BudgetController;
use App\Http\Controllers\FinancialForecastController;
use App\Http\Controllers\TaskController;
use App\Models\Budget;
use App\Models\FinancialForecast;
use App\Models\Organization;
use App\Models\SboPosition;
use App\Models\Task;
use App\Models\Transaction;
use App\Models\User;
use App\Services\HiusaAiService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use ReflectionMethod;
use Tests\TestCase;

/**
 * phpunit.xml forces HIUSA_AI_SERVICE_ENABLED=false globally, so every AI call
 * would otherwise short-circuit to null before ever reaching Http::fake(). Each
 * test here re-enables the service (mirroring HiusaAiServiceIntegrationTest) and
 * then breaks it three different ways - a connection error, a 500, and a 200
 * with a shape the validators reject - to prove the PHP fallback engines take
 * over cleanly and produce the exact numbers the Python engines would for the
 * same input.
 *
 * Every operating point below is deliberately chosen so the new code and the
 * OLD BUGGY code would have produced DIFFERENT output - a zero-workload,
 * no-history officer or a 2-month "insufficient_data" forecast would pass
 * whether or not the underlying fixes existed, so none of those appear here.
 */
class AiFallbackParityTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        config([
            'services.hiusa_ai.enabled' => true,
            'services.hiusa_ai.url' => 'http://127.0.0.1:8001',
            'services.hiusa_ai.key' => 'parity-test-key',
        ]);
    }

    // --- Task delegation -------------------------------------------------

    public function test_task_creation_falls_back_to_php_scoring_on_connection_error(): void
    {
        Http::fake([
            'http://127.0.0.1:8001/api/v1/task-delegation' => fn () => throw new ConnectionException('Connection refused'),
        ]);

        $this->assertTaskFallsBackToPhpScoring();
    }

    public function test_task_creation_falls_back_to_php_scoring_on_server_error(): void
    {
        Http::fake([
            'http://127.0.0.1:8001/api/v1/task-delegation' => Http::response('Internal Server Error', 500),
        ]);

        $this->assertTaskFallsBackToPhpScoring();
    }

    public function test_task_creation_falls_back_to_php_scoring_on_malformed_payload(): void
    {
        Http::fake([
            // Missing rankings/officer scores entirely - not a shape rememberAiRankings() can use.
            'http://127.0.0.1:8001/api/v1/task-delegation' => Http::response(['algorithm' => 'rule_based_weighted_scoring']),
        ]);

        $this->assertTaskFallsBackToPhpScoring();
    }

    /**
     * Discriminating operating point: a Treasurer with a nonzero, non-capacity
     * workload (3 of the default 5 active-task slots used) and a real
     * completed/overdue history (3 completed, 1 overdue -> 75% performance,
     * not the neutral-70 prior). Every asserted number only holds if workload
     * scaling and the real performance ratio are actually computed.
     */
    private function assertTaskFallsBackToPhpScoring(): void
    {
        $admin = $this->user('ADMIN');
        $treasurer = $this->user('SBO_OFFICER', $admin->organization_id, 'Treasurer');
        $this->seedTaskHistory($treasurer, $admin->organization_id, $admin);

        Sanctum::actingAs($admin);

        // Title matches the "finance" keyword set; Treasurer is a primary
        // match for that area. Both the Python engine and this PHP mirror
        // compute:
        //   position 100.00 x 0.40 + workload 40.00 x 0.35 + performance 75.00 x 0.25 = 72.75
        $response = $this->postJson('/api/tasks', [
            'title' => 'Prepare the budget liquidation report',
            'assigned_to' => $treasurer->school_id,
            'deadline' => now()->addWeek(),
            'status' => 'pending',
        ]);

        $response->assertCreated()
            ->assertJsonPath('assigned_to', $treasurer->school_id)
            ->assertJsonPath('role_score', '100.00')
            ->assertJsonPath('workload_score', '40.00')
            ->assertJsonPath('performance_score', '75.00')
            ->assertJsonPath('final_score', '72.75')
            ->assertJsonPath('delegation.engine', 'php-fallback')
            ->assertJsonPath('delegation.task_area', 'finance')
            ->assertJsonPath('delegation.recommended_officer_id', $treasurer->school_id)
            ->assertJsonPath('delegation.rankings.0.position_tier', 'primary')
            ->assertJsonPath('delegation.rankings.0.final_score', 72.75);

        $note = $response->json('ai_recommendation_note');
        $this->assertStringContainsString("inferred as 'finance'", $note);
        $this->assertStringContainsString('a primary match', $note);
        $this->assertStringContainsString('40.00 (3/5 active tasks)', $note);
        $this->assertStringContainsString('performance 75.00', $note);
    }

    private function seedTaskHistory(User $officer, int $organizationId, User $creator): void
    {
        // 2 currently active + 1 overdue (also active) => active_tasks = 3.
        foreach ([1, 2] as $i) {
            Task::create([
                'organization_id' => $organizationId,
                'created_by' => $creator->school_id,
                'title' => "Existing active task {$i}",
                'assigned_to' => $officer->school_id,
                'status' => 'pending',
                'deadline' => now()->addWeek(),
                'task_type' => 'regular',
            ]);
        }

        Task::create([
            'organization_id' => $organizationId,
            'created_by' => $creator->school_id,
            'title' => 'Existing overdue task',
            'assigned_to' => $officer->school_id,
            'status' => 'overdue',
            'deadline' => now()->subWeek(),
            'task_type' => 'regular',
        ]);

        // 3 completed + the 1 overdue above => historical = 4, performance = 3/4 = 75%.
        foreach ([1, 2, 3] as $i) {
            Task::create([
                'organization_id' => $organizationId,
                'created_by' => $creator->school_id,
                'title' => "Existing completed task {$i}",
                'assigned_to' => $officer->school_id,
                'status' => 'completed',
                'deadline' => now()->subWeek(),
                'task_type' => 'regular',
                'progress_percent' => 100,
                'completed_at' => now()->subDays(2),
            ]);
        }
    }

    // --- Financial forecast -----------------------------------------------

    public function test_forecast_generation_falls_back_to_php_engine_on_connection_error(): void
    {
        Http::fake([
            'http://127.0.0.1:8001/api/v1/financial-forecast' => fn () => throw new ConnectionException('Connection refused'),
            'http://127.0.0.1:8001/api/v1/budget-advice' => fn () => throw new ConnectionException('Connection refused'),
        ]);

        $this->assertForecastFallsBackToPhpEngine();
    }

    public function test_forecast_generation_falls_back_to_php_engine_on_server_error(): void
    {
        Http::fake([
            'http://127.0.0.1:8001/api/v1/financial-forecast' => Http::response('Internal Server Error', 500),
            'http://127.0.0.1:8001/api/v1/budget-advice' => Http::response('Internal Server Error', 500),
        ]);

        $this->assertForecastFallsBackToPhpEngine();
    }

    public function test_forecast_generation_falls_back_to_php_engine_on_malformed_payload(): void
    {
        Http::fake([
            // 200 OK but forecast_period is not a Y-m period - pythonForecast() must reject this.
            'http://127.0.0.1:8001/api/v1/financial-forecast' => Http::response(['forecast_period' => 'not-a-period']),
            // 200 OK but forecast_risk is not one of the allowed values - validBudgetAdvice() must reject this.
            'http://127.0.0.1:8001/api/v1/budget-advice' => Http::response(['safe_spending_limit' => 10, 'forecast_risk' => 'unknown']),
        ]);

        $this->assertForecastFallsBackToPhpEngine();
    }

    /**
     * Discriminating operating point: six months of genuinely noisy,
     * non-collinear income (income_model.r_squared ~= 0.086) against a
     * perfectly linear expense trend (expense_model.r_squared == 1). The
     * weakest of the two must drive fit_quality to "weak" - a real threshold
     * read, not the n<4 "insufficient_data" short-circuit the previous
     * 2-month version of this test could never get past.
     */
    private function assertForecastFallsBackToPhpEngine(): void
    {
        $admin = $this->user('ADMIN');
        $this->seedMonthlyTransactions($admin, [
            [500, 600], [50, 650], [480, 700], [60, 750], [510, 800], [40, 850],
        ]);

        Sanctum::actingAs($admin);

        $response = $this->postJson('/api/forecasts/generate', ['months' => 6]);

        $response->assertCreated()
            ->assertJsonPath('predicted_income', '139.33')
            ->assertJsonPath('predicted_expense', '900.00')
            ->assertJsonPath('model_details.engine', 'php-fallback')
            ->assertJsonPath('model_details.sample_months', 6)
            ->assertJsonPath('model_details.fit_quality', 'weak')
            ->assertJsonPath('model_details.is_reliable', false)
            ->assertJsonPath('model_details.income_clamped', false)
            ->assertJsonPath('model_details.budget_advice.engine', 'php-fallback');
    }

    public function test_forecast_generation_clamps_a_negative_income_projection_but_reports_the_raw_value(): void
    {
        Http::fake([
            'http://127.0.0.1:8001/api/v1/financial-forecast' => fn () => throw new ConnectionException('Connection refused'),
            'http://127.0.0.1:8001/api/v1/budget-advice' => fn () => throw new ConnectionException('Connection refused'),
        ]);

        $admin = $this->user('ADMIN');
        // A strictly declining income series (1000 -> 700 -> 400 -> 100) is a
        // perfect line whose next point is negative; expense is flat. Both
        // engines must clamp predicted_income to 0 while still exposing the
        // raw -200 the line actually projects.
        $this->seedMonthlyTransactions($admin, [
            [1000, 200], [700, 200], [400, 200], [100, 200],
        ]);

        Sanctum::actingAs($admin);
        $response = $this->postJson('/api/forecasts/generate', ['months' => 4]);

        $response->assertCreated()
            ->assertJsonPath('predicted_income', '0.00')
            ->assertJsonPath('model_details.engine', 'php-fallback')
            ->assertJsonPath('model_details.income_clamped', true)
            ->assertJsonPath('model_details.raw_predicted_income', -200)
            ->assertJsonPath('model_details.expense_clamped', false);
    }

    /**
     * The point of this suite is that the PHP fallback and the Python engine
     * agree numerically. Every other test here asserts PHP against
     * hand-derived constants; this one instead calls the LIVE Python service
     * and the PHP fallback with the same six-month series and asserts they
     * produce the same numbers.
     */
    public function test_php_forecast_fallback_matches_the_live_python_engine_on_the_same_data(): void
    {
        // The real configured key against the real running ai-service -
        // deliberately NOT Http::fake() for this call.
        config(['services.hiusa_ai.key' => env('HIUSA_AI_SERVICE_KEY')]);

        $monthly = [
            ['period' => '2030-01', 'income' => 500, 'expense' => 600],
            ['period' => '2030-02', 'income' => 50, 'expense' => 650],
            ['period' => '2030-03', 'income' => 480, 'expense' => 700],
            ['period' => '2030-04', 'income' => 60, 'expense' => 750],
            ['period' => '2030-05', 'income' => 510, 'expense' => 800],
            ['period' => '2030-06', 'income' => 40, 'expense' => 850],
        ];

        $live = app(HiusaAiService::class)->financialForecast($monthly);

        if ($live === null) {
            $this->markTestSkipped('Live HIUSA AI service at '.config('services.hiusa_ai.url').' is not reachable.');
        }

        $admin = $this->user('ADMIN');
        $this->seedMonthlyTransactions($admin, [
            [500, 600], [50, 650], [480, 700], [60, 750], [510, 800], [40, 850],
        ]);

        // Now break the connection so the SAME request is served by the PHP
        // fallback, and diff its numbers against the live call above.
        Http::fake([
            'http://127.0.0.1:8001/api/v1/financial-forecast' => fn () => throw new ConnectionException('Connection refused'),
            'http://127.0.0.1:8001/api/v1/budget-advice' => fn () => throw new ConnectionException('Connection refused'),
        ]);

        Sanctum::actingAs($admin);
        $response = $this->postJson('/api/forecasts/generate', ['months' => 6]);

        $response->assertCreated()->assertJsonPath('model_details.engine', 'php-fallback');
        $this->assertSame(number_format($live['predicted_income'], 2, '.', ''), $response->json('predicted_income'));
        $this->assertSame(number_format($live['predicted_expense'], 2, '.', ''), $response->json('predicted_expense'));
        $this->assertSame($live['fit_quality'], $response->json('model_details.fit_quality'));
        $this->assertSame($live['sample_months'], $response->json('model_details.sample_months'));
        $this->assertEqualsWithDelta($live['income_model']['r_squared'], $response->json('model_details.income.r_squared'), 0.0001);
        $this->assertEqualsWithDelta($live['expense_model']['r_squared'], $response->json('model_details.expense.r_squared'), 0.0001);
    }

    private function seedMonthlyTransactions(User $admin, array $incomeExpensePairs): void
    {
        $monthsAgo = count($incomeExpensePairs) - 1;

        foreach ($incomeExpensePairs as [$income, $expense]) {
            // Start at a month boundary before subtracting so dates such as
            // August 31 cannot overflow into duplicate months (for example,
            // "four months ago" becoming May 1 instead of April 1).
            $period = now()->startOfMonth()->subMonths($monthsAgo);

            Transaction::create([
                'organization_id' => $admin->organization_id,
                'recorded_by' => $admin->school_id,
                'type' => 'income',
                'amount' => $income,
                'category' => 'General',
                'description' => 'Fallback parity source',
                'transaction_date' => $period,
            ]);
            Transaction::create([
                'organization_id' => $admin->organization_id,
                'recorded_by' => $admin->school_id,
                'type' => 'expense',
                'amount' => $expense,
                'category' => 'General',
                'description' => 'Fallback parity source',
                'transaction_date' => $period,
            ]);
            $monthsAgo--;
        }
    }

    // --- Budget advice -------------------------------------------------

    public function test_budget_advice_falls_back_to_php_engine_on_connection_error(): void
    {
        Http::fake([
            'http://127.0.0.1:8001/api/v1/budget-advice' => fn () => throw new ConnectionException('Connection refused'),
        ]);

        $this->assertBudgetAdviceFallsBackToPhpEngine();
    }

    public function test_budget_advice_falls_back_to_php_engine_on_server_error(): void
    {
        Http::fake([
            'http://127.0.0.1:8001/api/v1/budget-advice' => Http::response('Internal Server Error', 500),
        ]);

        $this->assertBudgetAdviceFallsBackToPhpEngine();
    }

    public function test_budget_advice_falls_back_to_php_engine_on_malformed_payload(): void
    {
        Http::fake([
            // 200 OK but safe_spending_limit is not numeric - validAdvice() must reject this.
            'http://127.0.0.1:8001/api/v1/budget-advice' => Http::response(['safe_spending_limit' => 'a lot', 'forecast_risk' => 'unknown']),
        ]);

        $this->assertBudgetAdviceFallsBackToPhpEngine();
    }

    /**
     * Discriminating operating point: an existing forecast where expense
     * (900) exceeds income (500), so the risk engine must actually compute
     * overspending risk rather than default to "stable" - the previous
     * version of this test had no forecast at all (0/0), which is stable
     * under any implementation, buggy or not.
     */
    private function assertBudgetAdviceFallsBackToPhpEngine(): void
    {
        $admin = $this->user('ADMIN');
        $budget = Budget::create([
            'organization_id' => $admin->organization_id,
            'title' => 'Fallback parity budget',
            'allocated_amount' => 1000,
            'remaining_amount' => 1000,
            'warning_threshold' => 100,
        ]);
        FinancialForecast::create([
            'organization_id' => $admin->organization_id,
            'forecast_period' => now()->addMonth()->format('Y-m'),
            'predicted_income' => 500,
            'predicted_expense' => 900,
        ]);

        Sanctum::actingAs($admin);

        // available = 1000 + 500 - 900 - 0(committed) = 600; safe limit = 600 x 0.8 = 480;
        // recommended = min(1000, 480) = 480; reserve = 1000 - 480 = 520. Expense (900) >
        // income (500), so this must land on overspending/high/reduce_allocation, not stable.
        $response = $this->postJson("/api/budgets/{$budget->id}/advice");

        $response->assertOk()
            ->assertJsonPath('engine', 'php-fallback')
            ->assertJsonPath('advice.forecast_risk', 'overspending')
            ->assertJsonPath('advice.overspending_risk', 'high')
            ->assertJsonPath('advice.recommended_allocation', 480)
            ->assertJsonPath('advice.reserve_amount', 520)
            ->assertJsonPath('advice.allocation_status', 'reduce_allocation');
    }

    /**
     * BudgetController::advice() always calls localBudgetAdvice() with
     * committed_expenses hardcoded to 0 and safety_ratio hardcoded to 0.8, so
     * neither is reachable with a different value through the HTTP endpoint.
     * Pin the formula itself directly, with both at values that are NOT the
     * hardcoded defaults - these are exactly the two values GAP 4 calls out
     * as having been hardcoded into the pre-fix formula.
     */
    public function test_budget_controller_local_budget_advice_pins_committed_expenses_and_custom_safety_ratio(): void
    {
        $advice = $this->invokeLocalBudgetAdvice(app(BudgetController::class), [
            'predicted_income' => 1000,
            'predicted_expense' => 200,
            'current_available_budget' => 2000,
            'committed_expenses' => 300,
            'warning_threshold' => 0,
            'safety_ratio' => 0.5,
        ]);

        // available = 2000 + 1000 - 200 - 300 = 2500; safe limit = 2500 x 0.5 = 1250;
        // recommended = min(2000, 1250) = 1250; reserve = 2000 - 1250 = 750.
        $this->assertSame(2500.0, $advice['estimated_available_budget']);
        $this->assertSame(1250.0, $advice['safe_spending_limit']);
        $this->assertSame(1250.0, $advice['recommended_allocation']);
        $this->assertSame(750.0, $advice['reserve_amount']);
        $this->assertSame('stable', $advice['forecast_risk']);
        $this->assertSame('within_limit', $advice['allocation_status']);
    }

    /**
     * FinancialForecastController::localBudgetAdvice is the copy the spec
     * called out as previously drifted, and (like BudgetController's) is only
     * ever invoked through its endpoint with committed_expenses/safety_ratio
     * hardcoded to 0/0.8. Pin it directly with different values too.
     */
    public function test_financial_forecast_controller_local_budget_advice_pins_committed_expenses_and_custom_safety_ratio(): void
    {
        $advice = $this->invokeLocalBudgetAdvice(app(FinancialForecastController::class), [
            'predicted_income' => 1000,
            'predicted_expense' => 200,
            'current_available_budget' => 2000,
            'committed_expenses' => 300,
            'warning_threshold' => 0,
            'safety_ratio' => 0.5,
        ]);

        $this->assertSame(2500.0, $advice['estimated_available_budget']);
        $this->assertSame(1250.0, $advice['safe_spending_limit']);
        $this->assertSame(1250.0, $advice['recommended_allocation']);
        $this->assertSame(750.0, $advice['reserve_amount']);
        $this->assertSame('stable', $advice['forecast_risk']);
        $this->assertSame('within_limit', $advice['allocation_status']);
    }

    private function invokeLocalBudgetAdvice(object $controller, array $payload): array
    {
        $method = new ReflectionMethod($controller, 'localBudgetAdvice');
        $method->setAccessible(true);

        return $method->invoke($controller, $payload);
    }

    // --- Task-area keyword matching ---------------------------------------

    /**
     * TaskController::inferTaskArea() is the PHP mirror exercised whenever the
     * Python service is down - exactly the path this suite is about. A bare
     * substring test previously misclassified "Send immediate reminders"
     * as publicity (via "media" inside "immediate") and "Draft the
     * fundamental bylaws revision" as finance (via "fund" inside
     * "fundamental").
     */
    public function test_php_infer_task_area_uses_word_boundaries_not_bare_substrings(): void
    {
        $method = new ReflectionMethod(TaskController::class, 'inferTaskArea');
        $method->setAccessible(true);
        $controller = app(TaskController::class);

        $this->assertNotSame('publicity', $method->invoke($controller, 'Send immediate reminders to officers', null));
        $this->assertNotSame('finance', $method->invoke($controller, 'Draft the fundamental bylaws revision', null));
        $this->assertSame('finance', $method->invoke($controller, 'Prepare the financial liquidation report', null));
    }

    private function user(string $role, ?int $organizationId = null, ?string $positionTitle = null): User
    {
        $user = User::factory()->create([
            'role' => $role,
            'organization_id' => $organizationId ?? Organization::factory(),
            'account_status' => 'active',
            'position_title' => $positionTitle,
        ]);

        if ($role === 'SBO_OFFICER' && $positionTitle) {
            SboPosition::updateOrCreate(['organization_id' => $user->organization_id, 'role' => $role, 'title' => $positionTitle], ['is_active' => true]);
        }

        return $user;
    }
}
