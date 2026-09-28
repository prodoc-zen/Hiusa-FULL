<?php

namespace Tests\Feature;

use App\Models\ApprovalRequest;
use App\Models\Budget;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Regression coverage for a leak where a budget stuck at pending_sao was
 * still counted as "current available budget" by /forecasts/generate. The
 * old query selected budgets by ApprovalRequest::status = 'approved', but a
 * two-stage budget has an earlier stage's ApprovalRequest already marked
 * approved while the budget itself is still pending its final SAO review -
 * submission_status is the only field that reflects whether every configured
 * stage has actually cleared.
 */
class FinancialForecastBudgetAvailabilityTest extends TestCase
{
    use RefreshDatabase;

    public function test_pending_sao_budget_is_excluded_from_available_funds_and_only_counts_once_sao_approves(): void
    {
        config(['approvals.budget_final' => 'SUPER_ADMIN']);

        $organization = Organization::factory()->create();
        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION', 'acronym' => 'SAO']);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $departmentHead = User::factory()->departmentHead()->create(['organization_id' => $organization->id]);
        $superAdmin = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);

        Sanctum::actingAs($admin);
        $budgetId = $this->postJson('/api/budgets', [
            'title' => 'SAO Stage Budget',
            'allocated_amount' => 7777,
            'warning_threshold' => 100,
        ])->assertCreated()->json('id');

        $departmentApproval = ApprovalRequest::where('entity_type', 'budget')
            ->where('entity_id', $budgetId)->where('required_role', 'DEPARTMENT_HEAD')->firstOrFail();

        Sanctum::actingAs($departmentHead);
        $this->patchJson('/api/approval-requests/'.$departmentApproval->id, ['status' => 'approved'])->assertOk();

        $budget = Budget::findOrFail($budgetId);
        $this->assertSame('pending_sao', $budget->submission_status);

        Sanctum::actingAs($admin);
        $pending = $this->postJson('/api/forecasts/generate', ['months' => 6])->assertCreated();
        $this->assertSame(
            0.0,
            (float) $pending->json('model_details.current_available_budget'),
            'A budget still pending its SAO stage must not be counted as available funds.'
        );

        $saoApproval = ApprovalRequest::where('entity_type', 'budget')
            ->where('entity_id', $budgetId)->where('required_role', 'SUPER_ADMIN')->where('status', 'pending')->firstOrFail();

        Sanctum::actingAs($superAdmin);
        $this->patchJson('/api/approval-requests/'.$saoApproval->id, ['status' => 'approved'])->assertOk();
        $this->assertSame('approved', $budget->fresh()->submission_status);

        Sanctum::actingAs($admin);
        $approved = $this->postJson('/api/forecasts/generate', ['months' => 6])->assertCreated();
        $this->assertSame(
            7777.0,
            (float) $approved->json('model_details.current_available_budget'),
            'Once the SAO stage approves, the budget must be counted as available funds.'
        );
    }

    public function test_default_single_stage_budget_only_counts_after_department_head_approves(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $departmentHead = User::factory()->departmentHead()->create(['organization_id' => $organization->id]);

        Sanctum::actingAs($admin);
        $budgetId = $this->postJson('/api/budgets', [
            'title' => 'Single Stage Budget',
            'allocated_amount' => 5000,
            'warning_threshold' => 100,
        ])->assertCreated()->json('id');

        $pending = $this->postJson('/api/forecasts/generate', ['months' => 6])->assertCreated();
        $this->assertSame(
            0.0,
            (float) $pending->json('model_details.current_available_budget'),
            'A budget awaiting its only approval stage must not be counted as available funds.'
        );

        $departmentApproval = ApprovalRequest::where('entity_type', 'budget')->where('entity_id', $budgetId)->firstOrFail();
        Sanctum::actingAs($departmentHead);
        $this->patchJson('/api/approval-requests/'.$departmentApproval->id, ['status' => 'approved'])->assertOk();
        $this->assertSame('approved', Budget::findOrFail($budgetId)->submission_status);

        Sanctum::actingAs($admin);
        $approved = $this->postJson('/api/forecasts/generate', ['months' => 6])->assertCreated();
        $this->assertSame(
            5000.0,
            (float) $approved->json('model_details.current_available_budget'),
            'The single default stage must finalize the budget and count it as available funds.'
        );
    }
}
