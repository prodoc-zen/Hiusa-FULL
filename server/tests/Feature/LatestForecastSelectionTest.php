<?php

namespace Tests\Feature;

use App\Models\Budget;
use App\Models\Event;
use App\Models\FinancialForecast;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * "Latest forecast" means the one generated most recently. forecast_period is
 * free text on older and seeded rows, so "Q4 2024 (Oct-Dec)" sorts above
 * "2026-11" and used to win by period alone.
 */
class LatestForecastSelectionTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private Event $event;

    private Budget $budget;

    private FinancialForecast $latest;

    protected function setUp(): void
    {
        parent::setUp();
        $organization = Organization::factory()->create();
        $this->admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $this->event = Event::factory()->create([
            'organization_id' => $organization->id, 'created_by' => $this->admin->school_id, 'status' => 'approved',
            'start_time' => now()->addWeek(), 'end_time' => now()->addWeek()->addHours(3),
        ]);
        $this->budget = Budget::create([
            'organization_id' => $organization->id, 'title' => 'Operations', 'allocated_amount' => 1000, 'remaining_amount' => 1000,
            'warning_threshold' => 100, 'submission_status' => 'approved',
        ]);
        FinancialForecast::factory()->create([
            'organization_id' => $organization->id, 'forecast_period' => 'Q4 2024 (Oct-Dec)',
            'predicted_income' => 111, 'predicted_expense' => 99, 'created_at' => now()->subDays(40),
        ]);
        $this->latest = FinancialForecast::factory()->create([
            'organization_id' => $organization->id, 'forecast_period' => '2026-11',
            'predicted_income' => 5000, 'predicted_expense' => 3000, 'created_at' => now()->subDay(),
        ]);
        FinancialForecast::factory()->create([
            'organization_id' => Organization::factory()->create()->id, 'forecast_period' => '2027-01', 'created_at' => now(),
        ]);
        Sanctum::actingAs($this->admin);
    }

    public function test_budget_advice_uses_the_most_recently_generated_forecast(): void
    {
        $this->postJson("/api/budgets/{$this->budget->id}/advice")->assertOk()
            ->assertJsonPath('forecast_id', $this->latest->id)
            ->assertJsonPath('advice.estimated_available_budget', 3000);
    }

    public function test_the_event_financial_summary_uses_the_most_recently_generated_forecast(): void
    {
        $this->getJson("/api/events/{$this->event->id}")->assertOk()
            ->assertJsonPath('financial_summary.latest_forecast.id', $this->latest->id)
            ->assertJsonPath('financial_summary.latest_forecast.forecast_period', '2026-11');
    }

    public function test_a_generated_financial_report_uses_the_most_recently_generated_forecast(): void
    {
        $this->postJson('/api/financial-reports/generate', [
            'report_type' => 'monthly',
            'signatories' => ['treasurer' => 'Taylor Treasurer', 'president' => 'Pat President', 'adviser' => 'Alex Adviser', 'sbo_adviser' => 'Sam SBO Adviser'],
        ])->assertCreated()
            ->assertJsonPath('latest_ols_forecast.id', $this->latest->id)
            ->assertJsonPath('latest_ols_forecast.forecast_period', '2026-11');
    }

    public function test_forecasts_generated_in_the_same_second_are_ordered_by_id(): void
    {
        $moment = now();
        FinancialForecast::factory()->create(['organization_id' => $this->admin->organization_id, 'forecast_period' => '2026-12', 'created_at' => $moment]);
        $newest = FinancialForecast::factory()->create(['organization_id' => $this->admin->organization_id, 'forecast_period' => '2026-10', 'created_at' => $moment]);

        $this->getJson("/api/events/{$this->event->id}")->assertOk()
            ->assertJsonPath('financial_summary.latest_forecast.id', $newest->id);
    }
}
