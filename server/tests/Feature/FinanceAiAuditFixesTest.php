<?php

namespace Tests\Feature;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\AiOutput;
use App\Models\Budget;
use App\Models\FinancialForecast;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use App\Services\BudgetAdviceRules;
use App\Services\HiusaAiService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class FinanceAiAuditFixesTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow('2026-11-15 12:00:00', 'Asia/Manila');
        config(['services.hiusa_ai.enabled' => true, 'services.hiusa_ai.url' => 'http://127.0.0.1:8001', 'services.hiusa_ai.key' => 'integration-key']);
        Http::fake(fn () => throw new ConnectionException('Connection refused'));
        $this->admin = User::factory()->admin()->create(['organization_id' => Organization::factory()->create()->id]);
        Sanctum::actingAs($this->admin);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function budget(float $allocated, string $status = 'approved', array $extra = []): Budget
    {
        return Budget::create([
            'organization_id' => $this->admin->organization_id, 'title' => 'Budget '.uniqid(), 'allocated_amount' => $allocated,
            'remaining_amount' => $allocated, 'warning_threshold' => 500, 'submission_status' => $status, ...$extra,
        ]);
    }

    private function generatedForecast(string $period, float $income, float $expense, string $engine = 'php-fallback'): FinancialForecast
    {
        return FinancialForecast::create([
            'organization_id' => $this->admin->organization_id, 'forecast_period' => $period, 'predicted_income' => $income,
            'predicted_expense' => $expense, 'predicted_balance' => $income - $expense, 'safe_spending_limit' => 0,
            'model_details' => ['engine' => $engine, 'risk' => 'stable'],
        ]);
    }

    private function ledger(string $type, float $amount, string $date): void
    {
        Transaction::create([
            'organization_id' => $this->admin->organization_id, 'recorded_by' => $this->admin->school_id, 'type' => $type,
            'amount' => $amount, 'category' => 'General', 'description' => 'History', 'transaction_date' => $date.' 10:00:00',
        ]);
    }

    /**
     * Income 100, 200, 300 in Jan-Mar 2026 and nothing since; today is 2026-11-15, the target 2026-12.
     * Before the fix the series stopped at March: slope 100, intercept 100, so December read 100 + 11 * 100 = 1,200.
     * With the seven quiet months (Apr-Oct) as zeros the series has 10 points, x = 0..9: mean x 4.5, Sxx 82.5,
     * mean y 60, Sxy = 800 - 10 * 4.5 * 60 = -1,900, slope -23.030303, intercept 163.636364, December (x = 11) = -89.70.
     */
    public function test_quiet_months_after_the_last_entry_are_zeros_in_the_series(): void
    {
        foreach (['2026-01' => 100, '2026-02' => 200, '2026-03' => 300] as $month => $income) {
            $this->ledger('income', $income, $month.'-10');
            $this->ledger('expense', 50, $month.'-10');
        }

        $response = $this->postJson('/api/forecasts/generate', ['months' => 12])->assertCreated();

        $response->assertJsonPath('forecast_period', '2026-12')
            ->assertJsonPath('model_details.sample_months', 10)
            ->assertJsonPath('model_details.populated_months', 3)
            ->assertJsonPath('model_details.income_clamped', true)
            ->assertJsonPath('predicted_income', '0.00');
        $this->assertEqualsWithDelta(-89.7, $response->json('model_details.raw_predicted_income'), 0.01);
        $this->assertEqualsWithDelta(-23.030303, $response->json('model_details.income.slope'), 0.0001);
    }

    /**
     * Organization forecast income 20,000 and expense 40,000. Sportsfest holds 10,000 of the 40,000 approved
     * allocations (a 0.25 share), untouched. Before: available = 10,000 + 20,000 - 40,000 = -10,000, deficit,
     * safe limit 0. After: share income 5,000, share expense 10,000, available = 10,000 + 5,000 - 10,000 = 5,000,
     * safe limit 4,000, recommended 4,000, reserve 6,000, overspending (expenses above income).
     */
    public function test_budget_advice_uses_the_budgets_own_share_of_the_organization_forecast(): void
    {
        $sportsfest = $this->budget(10000);
        $this->budget(30000);
        $forecast = $this->generatedForecast('2026-12', 20000, 40000);

        $response = $this->postJson("/api/budgets/{$sportsfest->id}/advice")->assertOk();

        $response->assertJsonPath('forecast_id', $forecast->id)
            ->assertJsonPath('forecast_period', '2026-12')
            ->assertJsonPath('forecast_status', 'used')
            ->assertJsonPath('advice.estimated_available_budget', 5000)
            ->assertJsonPath('advice.safe_spending_limit', 4000)
            ->assertJsonPath('advice.recommended_allocation', 4000)
            ->assertJsonPath('advice.reserve_amount', 6000)
            ->assertJsonPath('advice.forecast_risk', 'overspending')
            ->assertJsonPath('advice.inputs.predicted_income', 5000)
            ->assertJsonPath('advice.inputs.predicted_expense', 10000)
            ->assertJsonPath('advice.inputs.budget_share', 0.25);
        $this->assertEquals(4000, $sportsfest->fresh()->safe_spending_limit);
    }

    public function test_budget_advice_without_a_current_generated_forecast_says_so_and_ignores_stale_and_manual_rows(): void
    {
        $budget = $this->budget(10000);
        $this->generatedForecast('2026-01', 99999, 1);
        $this->generatedForecast('2026-12', 99999, 1, 'manual');
        FinancialForecast::create(['organization_id' => $this->admin->organization_id, 'forecast_period' => 'Q4 2026', 'predicted_income' => 99999, 'predicted_expense' => 1]);

        $response = $this->postJson("/api/budgets/{$budget->id}/advice")->assertOk();

        $response->assertJsonPath('forecast_id', null)
            ->assertJsonPath('forecast_status', 'missing')
            ->assertJsonPath('advice.inputs.predicted_income', 0)
            ->assertJsonPath('advice.estimated_available_budget', 10000);
        $this->assertStringStartsWith('No current forecast was available', $response->json('advice.advice'));
    }

    public function test_budget_advice_is_refused_until_the_budget_is_approved(): void
    {
        foreach (['pending_department_head', 'pending_sao', 'rejected'] as $status) {
            $budget = $this->budget(1000, $status);
            $this->postJson("/api/budgets/{$budget->id}/advice")->assertStatus(409);
            $this->assertNull($budget->fresh()->advice_generated_at);
        }
        $this->assertSame(0, AiOutput::where('feature_type', 'BUDGET_EXPLANATION')->count());
    }

    public function test_advice_is_marked_stale_once_the_balance_moves_and_fresh_after_regenerating(): void
    {
        $budget = $this->budget(10000);
        $this->postJson("/api/budgets/{$budget->id}/advice")->assertOk()->assertJsonPath('budget.advice_stale', false);
        $this->assertFalse($this->getJson('/api/budgets')->assertOk()->json('data.0.advice_stale'));

        Transaction::create([
            'organization_id' => $this->admin->organization_id, 'recorded_by' => $this->admin->school_id, 'budget_id' => $budget->id, 'type' => 'expense',
            'amount' => 3000, 'category' => 'General', 'description' => 'Spend', 'transaction_date' => now()->toDateString(),
        ]);
        $budget->update(['remaining_amount' => 7000]);

        $this->assertTrue($this->getJson('/api/budgets', ['Cache-Control' => 'no-cache'])->assertOk()->json('data.0.advice_stale'));
        $this->postJson("/api/budgets/{$budget->id}/advice")->assertOk()->assertJsonPath('budget.advice_stale', false);
    }

    public function test_forecast_current_funds_only_count_the_active_semester(): void
    {
        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => '2026-01-01', 'ends_on' => '2027-05-31', 'is_current' => true]);
        $closed = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 2, 'starts_on' => '2026-01-01', 'ends_on' => '2026-07-31', 'status' => 'completed']);
        $active = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => '2026-08-01', 'ends_on' => '2026-12-31', 'status' => 'active']);
        $old = $this->budget(5000);
        $old->forceFill(['created_at' => '2026-03-01 09:00:00'])->save();
        $this->budget(700, 'approved', ['created_at' => '2026-09-01 09:00:00']);

        $response = $this->postJson('/api/forecasts/generate', ['months' => 6])->assertCreated();

        $this->assertEquals(700, $response->json('model_details.current_available_budget'));
        $response->assertJsonPath('model_details.academic_semester_id', $active->id);
        $this->assertNotSame($closed->id, $response->json('model_details.academic_semester_id'));
    }

    public function test_the_forecast_summary_names_the_approved_funds_behind_the_safe_limit(): void
    {
        $this->budget(50000);
        foreach (['2026-08', '2026-09', '2026-10'] as $month) {
            $this->ledger('income', 10000, $month.'-10');
            $this->ledger('expense', 8000, $month.'-10');
        }

        $response = $this->postJson('/api/forecasts/generate', ['months' => 3])->assertCreated();

        $response->assertJsonPath('model_details.estimated_available_budget', 52000);
        $this->assertEquals(41600, $response->json('safe_spending_limit'));
        $this->assertStringContainsString('With PHP 50,000.00 in approved budgets, the estimated available budget is PHP 52,000.00.', $response->json('confidence_note'));
    }

    public function test_the_forecast_fallback_rates_the_warning_threshold_as_high_like_the_engine(): void
    {
        $this->budget(0, 'approved', ['warning_threshold' => 600]);
        foreach (['2026-08', '2026-09', '2026-10'] as $month) {
            $this->ledger('income', 1000, $month.'-10');
            $this->ledger('expense', 500, $month.'-10');
        }

        $response = $this->postJson('/api/forecasts/generate', ['months' => 3])->assertCreated();

        $response->assertJsonPath('model_details.budget_advice.engine', 'php-fallback')
            ->assertJsonPath('model_details.budget_advice.overspending_risk', 'high')
            ->assertJsonPath('model_details.budget_advice.forecast_risk', 'overspending');
        $this->assertStringStartsWith('Overspending risk is high.', $response->json('model_details.budget_advice.advice'));
    }

    public function test_the_advice_rules_cover_the_threshold_and_ninety_percent_branches(): void
    {
        $base = ['committed_expenses' => 0, 'safety_ratio' => 0.8];

        $threshold = BudgetAdviceRules::evaluate([...$base, 'predicted_income' => 1000, 'predicted_expense' => 500, 'current_available_budget' => 0, 'warning_threshold' => 600]);
        $this->assertSame(['high', 'overspending', 'no_funds'], [$threshold['overspending_risk'], $threshold['forecast_risk'], $threshold['allocation_status']]);

        $ratio = BudgetAdviceRules::evaluate([...$base, 'predicted_income' => 1000, 'predicted_expense' => 900, 'current_available_budget' => 5000, 'warning_threshold' => 100]);
        $this->assertSame(['medium', 'overspending'], [$ratio['overspending_risk'], $ratio['forecast_risk']]);
        $this->assertStringStartsWith('Expenses are close to forecast income.', $ratio['advice']);
    }

    /** @dataProvider adviceCases */
    public function test_the_php_advice_rules_match_the_live_python_engine(array $payload): void
    {
        config(['services.hiusa_ai.key' => env('HIUSA_AI_SERVICE_KEY')]);
        Http::allowStrayRequests();
        $live = app(HiusaAiService::class)->budgetAdvice($payload);

        if ($live === null) {
            $this->markTestSkipped('Live HIUSA AI service is not reachable.');
        }

        $local = BudgetAdviceRules::evaluate($payload);
        foreach (['estimated_available_budget', 'safe_spending_limit', 'recommended_allocation', 'reserve_amount', 'allocation_status', 'overspending_risk', 'forecast_risk', 'possible_deficit', 'expense_to_income_ratio', 'advice'] as $key) {
            $this->assertEquals($live[$key], $local[$key], "{$key} differs between engines.");
        }
    }

    public static function adviceCases(): array
    {
        $base = ['committed_expenses' => 0, 'safety_ratio' => 0.8];

        return [
            'warning threshold' => [[...$base, 'predicted_income' => 1000, 'predicted_expense' => 500, 'current_available_budget' => 0, 'warning_threshold' => 600]],
            'ninety percent ratio' => [[...$base, 'predicted_income' => 1000, 'predicted_expense' => 900, 'current_available_budget' => 5000, 'warning_threshold' => 100]],
            'deficit' => [[...$base, 'predicted_income' => 1000, 'predicted_expense' => 4000, 'current_available_budget' => 500, 'warning_threshold' => 100]],
            'stable' => [[...$base, 'predicted_income' => 5000, 'predicted_expense' => 1000, 'current_available_budget' => 8000, 'warning_threshold' => 100]],
        ];
    }

    public function test_manual_forecasts_need_a_year_month_period_and_cannot_claim_a_model_run(): void
    {
        $payload = ['forecast_period' => '2026-12', 'predicted_income' => 1000, 'predicted_expense' => 6000];

        $this->postJson('/api/forecasts', [...$payload, 'forecast_period' => 'Q4 2024'])->assertUnprocessable()->assertJsonValidationErrors('forecast_period');

        $created = $this->postJson('/api/forecasts', [
            ...$payload,
            'model_details' => ['engine' => 'python-fastapi', 'fit_quality' => 'strong', 'is_reliable' => true, 'risk' => 'stable'],
        ])->assertCreated();
        $created->assertJsonPath('model_details', ['engine' => 'manual', 'risk' => 'deficit']);

        $this->putJson('/api/forecasts/'.$created->json('id'), ['predicted_expense' => 200])->assertOk()
            ->assertJsonPath('model_details', ['engine' => 'manual', 'risk' => 'stable']);
    }

    public function test_a_legacy_free_text_period_can_still_be_edited_without_resending_it(): void
    {
        $legacy = FinancialForecast::create(['organization_id' => $this->admin->organization_id, 'forecast_period' => 'Q4 2024 (Oct-Dec)', 'predicted_income' => 100, 'predicted_expense' => 50]);

        $this->putJson('/api/forecasts/'.$legacy->id, ['predicted_income' => 120])->assertOk()
            ->assertJsonPath('forecast_period', 'Q4 2024 (Oct-Dec)');
    }

    public function test_the_forecast_list_names_each_organization(): void
    {
        $this->generatedForecast('2026-12', 100, 50);

        $this->getJson('/api/forecasts')->assertOk()
            ->assertJsonPath('data.0.organization.id', $this->admin->organization_id)
            ->assertJsonPath('data.0.organization.acronym', $this->admin->organization->acronym);
    }

    private function generateReport(): \Illuminate\Testing\TestResponse
    {
        return $this->postJson('/api/financial-reports/generate', [
            'report_type' => 'monthly',
            'signatories' => ['treasurer' => 'Taylor Treasurer', 'president' => 'Pat President', 'adviser' => 'Alex Adviser', 'sbo_adviser' => 'Sam SBO Adviser'],
        ])->assertCreated();
    }

    public function test_the_report_summary_only_quotes_approved_in_period_advisories_and_an_in_period_forecast(): void
    {
        $inside = now()->toDateTimeString();
        $this->budget(1000, 'approved', ['advice_generated_at' => $inside, 'advisory_note' => 'In period approved']);
        $this->budget(1000, 'pending_department_head', ['advice_generated_at' => $inside, 'advisory_note' => 'Pending budget']);
        $this->budget(1000, 'approved', ['advice_generated_at' => '2026-03-05 09:00:00', 'advisory_note' => 'Long ago']);
        $this->generatedForecast('2026-12', 777, 1);

        $report = $this->generateReport();

        $this->assertSame(['In period approved'], collect($report->json('budget_advisories'))->pluck('advisory_note')->all());
        $report->assertJsonPath('latest_ols_forecast', null);

        $november = $this->generatedForecast('2026-11', 555, 5);
        $this->generateReport()->assertJsonPath('latest_ols_forecast.id', $november->id);
    }
}
