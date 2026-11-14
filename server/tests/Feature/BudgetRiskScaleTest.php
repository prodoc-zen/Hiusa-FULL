<?php

namespace Tests\Feature;

use App\Models\AiOutput;
use App\Models\Budget;
use App\Models\Organization;
use App\Models\User;
use App\Services\BudgetAdviceRules;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class BudgetRiskScaleTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->organization = Organization::factory()->create();
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
    }

    private function approvedBudget(array $attributes = []): Budget
    {
        return Budget::factory()->create([
            'organization_id' => $this->organization->id,
            'submission_status' => 'approved',
            'allocated_amount' => 1000,
            'remaining_amount' => 1000,
            'warning_threshold' => 200,
            'overspending_risk' => 'low',
            ...$attributes,
        ]);
    }

    private function storeAdvice(Budget $budget, string $risk): void
    {
        $budget->update(['overspending_risk' => $risk, 'advisory_note' => 'Old advice.', 'advice_generated_at' => now()]);
        AiOutput::create([
            'organization_id' => $budget->organization_id,
            'feature_type' => 'BUDGET_EXPLANATION',
            'reference_type' => Budget::class,
            'reference_id' => $budget->id,
            'prompt_text' => 'x',
            'output_text' => '',
            'structured_input' => ['current_available_budget' => (float) $budget->remaining_amount, 'warning_threshold' => (float) $budget->warning_threshold],
            'structured_output' => ['engine' => 'php-fallback', 'computed_advice' => ['advice' => 'Old advice.', 'overspending_risk' => $risk]],
            'status' => 'completed',
            'created_at' => now(),
        ]);
    }

    private function insights(): array
    {
        $this->app['auth']->forgetGuards();
        Sanctum::actingAs($this->admin);

        return collect($this->getJson('/api/dashboard/briefing', ['Cache-Control' => 'no-cache'])->assertOk()->json('insights'))->where('engine', 'budget_advisory')->values()->all();
    }

    public function test_the_model_uses_the_advice_engine_scale(): void
    {
        $this->assertSame('high', Budget::overspendingRiskFor(-1, 200));
        $this->assertSame('high', Budget::overspendingRiskFor(200, 200));
        $this->assertSame('high', Budget::overspendingRiskFor(150, 200));
        $this->assertSame('low', Budget::overspendingRiskFor(201, 200));
        $this->assertSame('low', Budget::overspendingRiskFor(0, 0));

        foreach ([[-5, 100], [100, 100], [500, 100], [0, 0], [50, 0]] as [$available, $threshold]) {
            $this->assertSame(
                BudgetAdviceRules::evaluate(['predicted_income' => 0, 'predicted_expense' => 0, 'current_available_budget' => $available, 'warning_threshold' => $threshold])['overspending_risk'],
                Budget::overspendingRiskFor($available, $threshold),
            );
        }
    }

    public function test_a_ledger_movement_into_the_warning_band_writes_high_not_medium(): void
    {
        Sanctum::actingAs($this->admin);
        $budget = $this->approvedBudget();

        $this->postJson('/api/transactions', [
            'type' => 'expense', 'amount' => 850, 'category' => 'Supplies', 'description' => 'Supplies',
            'budget_id' => $budget->id, 'transaction_date' => now()->toDateString(),
        ])->assertCreated();

        $budget->refresh();
        $this->assertEquals(150, (float) $budget->remaining_amount);
        $this->assertSame('high', $budget->overspending_risk);
    }

    public function test_income_posted_against_a_budget_lowers_the_risk_again(): void
    {
        Sanctum::actingAs($this->admin);
        $budget = $this->approvedBudget(['remaining_amount' => 150, 'overspending_risk' => 'high']);

        $this->postJson('/api/transactions', [
            'type' => 'income', 'amount' => 500, 'category' => 'Sponsorship', 'description' => 'Sponsor',
            'budget_id' => $budget->id, 'transaction_date' => now()->toDateString(),
        ])->assertCreated();

        $this->assertEquals(650, (float) $budget->fresh()->remaining_amount);
        $this->assertSame('low', $budget->fresh()->overspending_risk);
    }

    public function test_the_badge_matches_the_advice_engine_for_the_same_inputs(): void
    {
        $budget = $this->approvedBudget(['remaining_amount' => 150]);
        $badge = Budget::overspendingRiskFor(150, 200);
        $engine = BudgetAdviceRules::evaluate(['predicted_income' => 0, 'predicted_expense' => 0, 'current_available_budget' => 150, 'warning_threshold' => 200]);

        $this->assertSame($engine['overspending_risk'], $badge);
        $this->assertSame('overspending', $engine['forecast_risk']);
        $this->assertSame($badge, Budget::overspendingRiskFor((float) $budget->remaining_amount, (float) $budget->warning_threshold));
    }

    public function test_the_dashboard_does_not_pair_a_fresh_risk_with_an_old_advisory_note(): void
    {
        Sanctum::actingAs($this->admin);
        $budget = $this->approvedBudget();
        $this->storeAdvice($budget, 'high');
        $this->assertCount(1, $this->insights());

        $this->postJson('/api/transactions', [
            'type' => 'expense', 'amount' => 100, 'category' => 'Supplies', 'description' => 'Supplies',
            'budget_id' => $budget->id, 'transaction_date' => now()->toDateString(),
        ])->assertCreated();
        $budget->refresh();
        $budget->update(['overspending_risk' => 'high']);

        $this->assertSame([], $this->insights());
    }

    public function test_the_dashboard_skips_budgets_with_advice_never_recorded_and_unapproved_budgets(): void
    {
        Sanctum::actingAs($this->admin);
        $this->approvedBudget(['overspending_risk' => 'high', 'advisory_note' => 'Note', 'advice_generated_at' => now()]);
        $pending = $this->approvedBudget(['submission_status' => 'pending_sao']);
        $this->storeAdvice($pending, 'high');
        $pending->update(['submission_status' => 'pending_sao']);

        $this->assertSame([], $this->insights());

        $fresh = $this->approvedBudget(['title' => 'Fresh Budget']);
        $this->storeAdvice($fresh, 'high');
        $insights = $this->insights();
        $this->assertCount(1, $insights);
        $this->assertStringContainsString('Fresh Budget', $insights[0]['title']);
    }
}
