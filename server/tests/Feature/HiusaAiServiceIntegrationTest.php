<?php

namespace Tests\Feature;

use App\Models\Budget;
use App\Models\Organization;
use App\Models\SboPosition;
use App\Models\Task;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class HiusaAiServiceIntegrationTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        config([
            'services.hiusa_ai.enabled' => true,
            'services.hiusa_ai.url' => 'http://127.0.0.1:8001',
            'services.hiusa_ai.key' => 'integration-key',
        ]);
    }

    public function test_forecast_generation_uses_python_service_results(): void
    {
        $admin = $this->user('ADMIN');
        foreach ([
            ['period' => now()->startOfMonth()->subMonth(), 'type' => 'income', 'amount' => 1000],
            ['period' => now()->startOfMonth(), 'type' => 'income', 'amount' => 1200],
        ] as $row) {
            Transaction::create([
                'organization_id' => $admin->organization_id,
                'recorded_by' => $admin->school_id,
                'type' => $row['type'],
                'amount' => $row['amount'],
                'category' => 'General',
                'description' => 'Python integration source',
                'transaction_date' => $row['period'],
            ]);
        }

        Http::fake([
            'http://127.0.0.1:8001/api/v1/financial-forecast' => Http::response([
                'algorithm' => 'ordinary_least_squares',
                'forecast_period' => now()->addMonth()->format('Y-m'),
                'sample_months' => 2,
                'predicted_income' => 1400,
                'predicted_expense' => 800,
                'predicted_balance' => 600,
                'income_model' => ['slope' => 200, 'intercept' => 1000, 'r_squared' => 1],
                'expense_model' => ['slope' => 100, 'intercept' => 600, 'r_squared' => 1],
            ]),
            'http://127.0.0.1:8001/api/v1/budget-advice' => Http::response($this->adviceResponse()),
        ]);

        Sanctum::actingAs($admin);
        $this->postJson('/api/forecasts/generate', ['months' => 12])
            ->assertCreated()
            ->assertJsonPath('predicted_income', '1400.00')
            ->assertJsonPath('model_details.engine', 'python-fastapi')
            ->assertJsonPath('model_details.budget_advice.safe_spending_limit', 480);

        Http::assertSent(fn ($request) => $request->url() === 'http://127.0.0.1:8001/api/v1/financial-forecast'
            && $request->hasHeader('X-AI-Service-Key', 'integration-key'));
    }

    public function test_budget_advice_endpoint_saves_python_advice_on_the_budget(): void
    {
        $admin = $this->user('ADMIN');
        $budget = Budget::create([
            'organization_id' => $admin->organization_id,
            'title' => 'AI-advised budget',
            'allocated_amount' => 1000,
            'remaining_amount' => 1000,
            'warning_threshold' => 200,
        ]);
        Http::fake([
            'http://127.0.0.1:8001/api/v1/budget-advice' => Http::response($this->adviceResponse()),
        ]);

        Sanctum::actingAs($admin);
        $this->postJson("/api/budgets/{$budget->id}/advice")
            ->assertOk()
            ->assertJsonPath('engine', 'python-fastapi')
            ->assertJsonPath('budget.overspending_risk', 'low')
            ->assertJsonPath('budget.advisory_note', 'Projection is stable.');
    }

    public function test_task_creation_uses_python_rankings_and_score_breakdown(): void
    {
        $admin = $this->user('ADMIN');
        $firstOfficer = $this->user('SBO_OFFICER', $admin->organization_id);
        $recommendedOfficer = $this->user('SBO_OFFICER', $admin->organization_id);
        Task::create([
            'organization_id' => $admin->organization_id,
            'created_by' => $admin->school_id,
            'assigned_to' => $firstOfficer->school_id,
            'title' => 'Existing task',
            'status' => 'pending',
            'deadline' => now()->addDay(),
        ]);
        Http::fake([
            'http://127.0.0.1:8001/api/v1/task-delegation' => Http::response([
                'algorithm' => 'rule_based_weighted_scoring',
                'weights' => ['role' => 0.4, 'workload' => 0.35, 'performance' => 0.25],
                'recommended_officer_id' => $recommendedOfficer->school_id,
                'rankings' => [
                    $this->ranking($recommendedOfficer, 99),
                    $this->ranking($firstOfficer, 80),
                ],
            ]),
        ]);

        Sanctum::actingAs($admin);
        $this->postJson('/api/tasks', [
            'title' => 'Python recommended task',
            'deadline' => now()->addWeek(),
            'status' => 'pending',
        ])->assertCreated()
            ->assertJsonPath('assigned_to', $recommendedOfficer->school_id)
            ->assertJsonPath('final_score', '99.00')
            ->assertJsonPath('ai_recommendation_note', 'Recommended by Python.');
    }

    private function user(string $role, ?int $organizationId = null): User
    {
        $user = User::factory()->create([
            'role' => $role,
            'position_title' => $role === 'SBO_OFFICER' ? 'President' : null,
            'organization_id' => $organizationId ?? Organization::factory(),
            'account_status' => 'active',
        ]);
        if ($role === 'SBO_OFFICER') {
            SboPosition::updateOrCreate(['organization_id' => $user->organization_id, 'role' => $role, 'title' => 'President'], ['is_active' => true]);
        }

        return $user;
    }

    private function adviceResponse(): array
    {
        return [
            'estimated_available_budget' => 600,
            'safe_spending_limit' => 480,
            'overspending_risk' => 'low',
            'forecast_risk' => 'stable',
            'possible_deficit' => false,
            'expense_to_income_ratio' => 0.5714,
            'advice' => 'Projection is stable.',
            'rules_applied' => ['test rule'],
        ];
    }

    private function ranking(User $officer, float $finalScore): array
    {
        return [
            'officer_id' => $officer->school_id,
            'name' => "{$officer->first_name} {$officer->last_name}",
            'role_score' => 100,
            'workload_score' => $finalScore,
            'performance_score' => $finalScore,
            'final_score' => $finalScore,
            'explanation' => 'Recommended by Python.',
        ];
    }
}
