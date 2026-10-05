<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * A forecast is for the next calendar month after today in Asia/Manila. The
 * month in progress is mostly empty, so forecasting it, or the month after the
 * last one with entries, tells the officers nothing about what is coming.
 */
class ForecastNextMonthTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private string $engineUrl;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.hiusa_ai.enabled' => true, 'services.hiusa_ai.url' => 'http://127.0.0.1:8001', 'services.hiusa_ai.key' => 'integration-key']);
        $this->engineUrl = 'http://127.0.0.1:8001/api/v1/financial-forecast';
        $this->admin = User::factory()->admin()->create(['organization_id' => Organization::factory()->create()->id]);
        Sanctum::actingAs($this->admin);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function engineDown(): void
    {
        Http::fake([$this->engineUrl => fn () => throw new ConnectionException('Connection refused'), '*' => Http::response([], 500)]);
    }

    /** One income and one expense entry per month: income climbs 100 a month, expense stays at 50. */
    private function seedHistory(string ...$periods): void
    {
        foreach ($periods as $index => $period) {
            foreach ([['income', 100 * ($index + 1)], ['expense', 50]] as [$type, $amount]) {
                Transaction::create([
                    'organization_id' => $this->admin->organization_id, 'recorded_by' => $this->admin->school_id, 'type' => $type,
                    'amount' => $amount, 'category' => 'General', 'description' => 'History', 'transaction_date' => $period.'-10 12:00:00',
                ]);
            }
        }
    }

    public function test_history_that_ends_last_month_still_forecasts_the_month_after_today(): void
    {
        $this->engineDown();
        Carbon::setTestNow(Carbon::parse('2026-10-06 10:00:00', 'Asia/Manila'));
        $this->seedHistory('2026-06', '2026-07', '2026-08', '2026-09');

        $this->postJson('/api/forecasts/generate', ['months' => 12])->assertCreated()
            ->assertJsonPath('forecast_period', '2026-11')
            ->assertJsonPath('model_details.engine', 'php-fallback')
            ->assertJsonPath('predicted_income', '600.00')
            ->assertJsonPath('predicted_expense', '50.00');
    }

    public function test_history_that_includes_the_current_month_forecasts_the_month_after_it(): void
    {
        $this->engineDown();
        Carbon::setTestNow(Carbon::parse('2026-10-06 10:00:00', 'Asia/Manila'));
        $this->seedHistory('2026-07', '2026-08', '2026-09', '2026-10');

        $this->postJson('/api/forecasts/generate', ['months' => 12])->assertCreated()
            ->assertJsonPath('forecast_period', '2026-11')
            ->assertJsonPath('predicted_income', '500.00');
    }

    public function test_the_month_is_read_on_the_manila_calendar_not_utc(): void
    {
        $this->engineDown();
        Carbon::setTestNow(Carbon::parse('2026-10-31 20:00:00', 'UTC'));
        $this->seedHistory('2026-07', '2026-08', '2026-09', '2026-10');

        $this->postJson('/api/forecasts/generate', ['months' => 12])->assertCreated()
            ->assertJsonPath('forecast_period', '2026-12')
            ->assertJsonPath('predicted_income', '600.00');
    }

    public function test_the_python_engine_is_asked_for_the_same_month_and_a_stale_answer_is_not_trusted(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-10-06 10:00:00', 'Asia/Manila'));
        $this->seedHistory('2026-06', '2026-07', '2026-08', '2026-09');
        $answerPeriod = '2026-11';
        Http::fake([
            $this->engineUrl => function () use (&$answerPeriod) {
                return Http::response([
                    'algorithm' => 'ordinary_least_squares', 'forecast_period' => $answerPeriod, 'sample_months' => 4,
                    'predicted_income' => 999, 'predicted_expense' => 50, 'predicted_balance' => 949,
                    'income_model' => ['slope' => 100, 'intercept' => 100, 'r_squared' => 1],
                    'expense_model' => ['slope' => 0, 'intercept' => 50, 'r_squared' => 1],
                ]);
            },
            '*' => Http::response([], 500),
        ]);

        $this->postJson('/api/forecasts/generate', ['months' => 12])->assertCreated()
            ->assertJsonPath('forecast_period', '2026-11')
            ->assertJsonPath('model_details.engine', 'python-fastapi')
            ->assertJsonPath('predicted_income', '999.00');
        Http::assertSent(fn (Request $request) => $request->url() === $this->engineUrl && $request['target_period'] === '2026-11');

        // An engine that predates target_period answers for the month after the history, which is October.
        $answerPeriod = '2026-10';
        $this->postJson('/api/forecasts/generate', ['months' => 12])->assertCreated()
            ->assertJsonPath('forecast_period', '2026-11')
            ->assertJsonPath('model_details.engine', 'php-fallback')
            ->assertJsonPath('predicted_income', '600.00');
    }
}
