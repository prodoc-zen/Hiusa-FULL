<?php

namespace Tests\Feature;

use App\Models\ApprovalRequest;
use App\Models\Budget;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class BudgetApprovalWorkflowTest extends TestCase
{
    use RefreshDatabase;

    public function test_budget_moves_from_admin_to_department_head_then_sao(): void
    {
        $organization = Organization::factory()->create();
        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION', 'acronym' => 'SAO']);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $departmentHead = User::factory()->departmentHead()->create(['organization_id' => $organization->id]);
        $superAdmin = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);

        Sanctum::actingAs($admin);
        $budgetId = $this->postJson('/api/budgets', [
            'title' => 'Leadership Summit Budget',
            'allocated_amount' => 1000,
            'warning_threshold' => 200,
        ])->assertCreated()->json('id');

        $departmentApproval = ApprovalRequest::where('entity_type', 'budget')
            ->where('entity_id', $budgetId)->where('required_role', 'DEPARTMENT_HEAD')->firstOrFail();
        $this->assertSame('pending', $departmentApproval->status);
        $this->assertSame('pending_department_head', Budget::findOrFail($budgetId)->submission_status);

        Sanctum::actingAs($departmentHead);
        $this->patchJson('/api/approval-requests/'.$departmentApproval->id, ['status' => 'approved'])->assertOk();

        $budget = Budget::findOrFail($budgetId);
        $this->assertSame('pending_sao', $budget->submission_status);
        $this->assertSame($departmentHead->school_id, $budget->department_head_approved_by);
        $this->assertNotNull($budget->department_head_approved_at);
        $this->assertSame('1000.00', $budget->remaining_amount, 'Remaining amount must not finalize before the SAO stage.');

        $saoApproval = ApprovalRequest::where('entity_type', 'budget')
            ->where('entity_id', $budgetId)->where('required_role', 'SUPER_ADMIN')->where('status', 'pending')->firstOrFail();

        Sanctum::actingAs($superAdmin);
        $this->patchJson('/api/approval-requests/'.$saoApproval->id, ['status' => 'approved'])->assertOk();

        $budget->refresh();
        $this->assertSame('approved', $budget->submission_status);
        $this->assertSame('1000.00', $budget->remaining_amount);
        $this->assertDatabaseHas('audit_logs', ['module' => 'approvals', 'action' => 'reviewed_approved', 'record_id' => $saoApproval->id]);
    }

    public function test_department_head_rejection_returns_the_budget_to_admin_with_remarks(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $departmentHead = User::factory()->departmentHead()->create(['organization_id' => $organization->id]);

        Sanctum::actingAs($admin);
        $budgetId = $this->postJson('/api/budgets', [
            'title' => 'Sports Fest Budget',
            'allocated_amount' => 500,
            'warning_threshold' => 100,
        ])->assertCreated()->json('id');
        $approval = ApprovalRequest::where('entity_type', 'budget')->where('entity_id', $budgetId)->firstOrFail();

        Sanctum::actingAs($departmentHead);
        $this->patchJson('/api/approval-requests/'.$approval->id, [
            'status' => 'rejected',
            'remarks' => 'Allocation exceeds the approved event scope.',
        ])->assertOk()->assertJsonPath('remarks', 'Allocation exceeds the approved event scope.');

        $this->assertSame('rejected', Budget::findOrFail($budgetId)->submission_status);

        Sanctum::actingAs($admin);
        $this->getJson('/api/budgets')->assertOk()
            ->assertJsonFragment(['id' => $budgetId, 'approval_status' => 'rejected', 'approval_remarks' => 'Allocation exceeds the approved event scope.']);
    }

    public function test_sao_rejection_returns_the_budget_to_admin_with_remarks(): void
    {
        $organization = Organization::factory()->create();
        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION', 'acronym' => 'SAO']);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $departmentHead = User::factory()->departmentHead()->create(['organization_id' => $organization->id]);
        $superAdmin = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);

        Sanctum::actingAs($admin);
        $budgetId = $this->postJson('/api/budgets', [
            'title' => 'Merchandise Fund',
            'allocated_amount' => 2000,
            'warning_threshold' => 300,
        ])->assertCreated()->json('id');
        $departmentApproval = ApprovalRequest::where('entity_type', 'budget')->where('entity_id', $budgetId)->firstOrFail();

        Sanctum::actingAs($departmentHead);
        $this->patchJson('/api/approval-requests/'.$departmentApproval->id, ['status' => 'approved'])->assertOk();

        $saoApproval = ApprovalRequest::where('entity_type', 'budget')
            ->where('entity_id', $budgetId)->where('required_role', 'SUPER_ADMIN')->firstOrFail();

        Sanctum::actingAs($superAdmin);
        $this->patchJson('/api/approval-requests/'.$saoApproval->id, [
            'status' => 'rejected',
            'remarks' => 'Insufficient supporting documentation.',
        ])->assertOk();

        $this->assertSame('rejected', Budget::findOrFail($budgetId)->submission_status);
    }

    public function test_editing_a_rejected_budget_restarts_approval_at_department_head(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $departmentHead = User::factory()->departmentHead()->create(['organization_id' => $organization->id]);

        Sanctum::actingAs($admin);
        $budgetId = $this->postJson('/api/budgets', [
            'title' => 'Recognition Night Budget',
            'allocated_amount' => 800,
            'warning_threshold' => 150,
        ])->assertCreated()->json('id');
        $approval = ApprovalRequest::where('entity_type', 'budget')->where('entity_id', $budgetId)->firstOrFail();

        Sanctum::actingAs($departmentHead);
        $this->patchJson('/api/approval-requests/'.$approval->id, ['status' => 'rejected', 'remarks' => 'Wrong venue costing.'])
            ->assertOk();

        Sanctum::actingAs($admin);
        $this->putJson('/api/budgets/'.$budgetId, ['allocated_amount' => 900])->assertOk();

        $this->assertDatabaseHas('approval_requests', [
            'id' => $approval->id,
            'status' => 'pending',
            'required_role' => 'DEPARTMENT_HEAD',
            'remarks' => null,
        ]);
        $budget = Budget::findOrFail($budgetId);
        $this->assertSame('pending_department_head', $budget->submission_status);
        $this->assertNull($budget->department_head_approved_by);
    }

    public function test_editing_a_pending_sao_budget_restarts_approval_at_department_head(): void
    {
        $organization = Organization::factory()->create();
        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION', 'acronym' => 'SAO']);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $departmentHead = User::factory()->departmentHead()->create(['organization_id' => $organization->id]);
        $superAdmin = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);

        Sanctum::actingAs($admin);
        $budgetId = $this->postJson('/api/budgets', [
            'title' => 'Conference Budget',
            'allocated_amount' => 1000,
            'warning_threshold' => 200,
        ])->assertCreated()->json('id');
        $departmentApproval = ApprovalRequest::where('entity_type', 'budget')
            ->where('entity_id', $budgetId)->where('required_role', 'DEPARTMENT_HEAD')->firstOrFail();

        Sanctum::actingAs($departmentHead);
        $this->patchJson('/api/approval-requests/'.$departmentApproval->id, ['status' => 'approved'])->assertOk();

        $budget = Budget::findOrFail($budgetId);
        $this->assertSame('pending_sao', $budget->submission_status);
        $saoApproval = ApprovalRequest::where('entity_type', 'budget')
            ->where('entity_id', $budgetId)->where('required_role', 'SUPER_ADMIN')->where('status', 'pending')->firstOrFail();

        // Bypass reproduction: while the SAO stage is still pending, the admin
        // materially changes what the Department Head already signed off on.
        Sanctum::actingAs($admin);
        $this->putJson('/api/budgets/'.$budgetId, ['allocated_amount' => 50000])->assertOk();

        $budget->refresh();
        $this->assertSame('pending_department_head', $budget->submission_status);
        $this->assertNull($budget->department_head_approved_by);
        $this->assertNull($budget->department_head_approved_at);
        $this->assertSame('50000.00', $budget->allocated_amount);

        // The stale SAO request must not remain reachable: it was reopened as
        // the new Department Head request, so no pending SAO row is left.
        $this->assertDatabaseHas('approval_requests', [
            'id' => $saoApproval->id,
            'status' => 'pending',
            'required_role' => 'DEPARTMENT_HEAD',
        ]);
        $this->assertFalse(
            ApprovalRequest::where('entity_type', 'budget')->where('entity_id', $budgetId)
                ->where('required_role', 'SUPER_ADMIN')->where('status', 'pending')->exists(),
            'A pending SAO request must not remain after a pending_sao budget is edited.'
        );

        Sanctum::actingAs($superAdmin);
        $this->patchJson('/api/approval-requests/'.$saoApproval->id, ['status' => 'approved'])->assertForbidden();

        // Re-run the full chain on the edited figure so the SAO cannot finalize
        // an amount the Department Head never actually reviewed.
        Sanctum::actingAs($departmentHead);
        $this->patchJson('/api/approval-requests/'.$saoApproval->id, ['status' => 'approved'])->assertOk();
        $newSaoApproval = ApprovalRequest::where('entity_type', 'budget')
            ->where('entity_id', $budgetId)->where('required_role', 'SUPER_ADMIN')->where('status', 'pending')->firstOrFail();
        Sanctum::actingAs($superAdmin);
        $this->patchJson('/api/approval-requests/'.$newSaoApproval->id, ['status' => 'approved'])->assertOk();

        $budget->refresh();
        $this->assertSame('approved', $budget->submission_status);
        $this->assertSame('50000.00', $budget->remaining_amount);
    }

    public function test_editing_a_pending_sao_budget_with_no_fields_does_not_restart_approval(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $departmentHead = User::factory()->departmentHead()->create(['organization_id' => $organization->id]);

        Sanctum::actingAs($admin);
        $budgetId = $this->postJson('/api/budgets', [
            'title' => 'Alumni Homecoming Budget',
            'allocated_amount' => 600,
            'warning_threshold' => 100,
        ])->assertCreated()->json('id');
        $departmentApproval = ApprovalRequest::where('entity_type', 'budget')->where('entity_id', $budgetId)->firstOrFail();

        Sanctum::actingAs($departmentHead);
        $this->patchJson('/api/approval-requests/'.$departmentApproval->id, ['status' => 'approved'])->assertOk();

        $budget = Budget::findOrFail($budgetId);
        $this->assertSame('pending_sao', $budget->submission_status);
        $approvedBy = $budget->department_head_approved_by;

        Sanctum::actingAs($admin);
        $this->putJson('/api/budgets/'.$budgetId, [])->assertOk();

        $budget->refresh();
        $this->assertSame('pending_sao', $budget->submission_status);
        $this->assertSame($approvedBy, $budget->department_head_approved_by);
        $this->assertDatabaseHas('approval_requests', [
            'entity_type' => 'budget',
            'entity_id' => $budgetId,
            'required_role' => 'SUPER_ADMIN',
            'status' => 'pending',
        ]);
    }

    public function test_transaction_spendability_trusts_budget_submission_status_over_approval_request_rows(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        Sanctum::actingAs($admin);

        // Forged desync: the latest ApprovalRequest row says approved, but the
        // budget itself is still only at the SAO stage. Spending must go by
        // Budget::submission_status, not by re-deriving approval from the
        // ApprovalRequest table, so this must still be refused.
        $pendingSaoBudget = Budget::create([
            'organization_id' => $organization->id,
            'title' => 'Desynced Pending SAO Budget',
            'allocated_amount' => 1000,
            'remaining_amount' => 1000,
            'warning_threshold' => 100,
            'submission_status' => 'pending_sao',
        ]);
        ApprovalRequest::create([
            'organization_id' => $organization->id,
            'entity_type' => 'budget',
            'entity_id' => $pendingSaoBudget->id,
            'requested_by' => $admin->school_id,
            'required_role' => 'SUPER_ADMIN',
            'status' => 'approved',
        ]);

        $this->postJson('/api/transactions', [
            'budget_id' => $pendingSaoBudget->id,
            'type' => 'expense',
            'amount' => 50,
            'category' => 'Operations',
            'description' => 'Should be refused',
            'transaction_date' => now()->toDateString(),
        ])->assertUnprocessable()
            ->assertJsonPath('message', 'The selected budget must belong to this organization and be approved.');

        // Inverse desync: the latest ApprovalRequest row says rejected, but the
        // budget itself is marked approved. Spending must still go through.
        $approvedBudget = Budget::create([
            'organization_id' => $organization->id,
            'title' => 'Desynced Approved Budget',
            'allocated_amount' => 1000,
            'remaining_amount' => 1000,
            'warning_threshold' => 100,
            'submission_status' => 'approved',
        ]);
        ApprovalRequest::create([
            'organization_id' => $organization->id,
            'entity_type' => 'budget',
            'entity_id' => $approvedBudget->id,
            'requested_by' => $admin->school_id,
            'required_role' => 'SUPER_ADMIN',
            'status' => 'rejected',
        ]);

        $this->postJson('/api/transactions', [
            'budget_id' => $approvedBudget->id,
            'type' => 'expense',
            'amount' => 50,
            'category' => 'Operations',
            'description' => 'Should be allowed',
            'transaction_date' => now()->toDateString(),
        ])->assertCreated();
    }

    public function test_department_head_from_another_organization_cannot_act_on_the_approval(): void
    {
        $organization = Organization::factory()->create();
        $otherOrganization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $otherDepartmentHead = User::factory()->departmentHead()->create(['organization_id' => $otherOrganization->id]);

        Sanctum::actingAs($admin);
        $budgetId = $this->postJson('/api/budgets', [
            'title' => 'Cross-Org Budget',
            'allocated_amount' => 400,
            'warning_threshold' => 50,
        ])->assertCreated()->json('id');
        $approval = ApprovalRequest::where('entity_type', 'budget')->where('entity_id', $budgetId)->firstOrFail();

        Sanctum::actingAs($otherDepartmentHead);
        $this->patchJson('/api/approval-requests/'.$approval->id, ['status' => 'approved'])->assertNotFound();

        $this->assertSame('pending', $approval->fresh()->status);
    }

    public function test_sao_cannot_skip_the_department_head_stage(): void
    {
        $organization = Organization::factory()->create();
        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION', 'acronym' => 'SAO']);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $superAdmin = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);

        Sanctum::actingAs($admin);
        $budgetId = $this->postJson('/api/budgets', [
            'title' => 'General Fund',
            'allocated_amount' => 1500,
            'warning_threshold' => 250,
        ])->assertCreated()->json('id');
        $approval = ApprovalRequest::where('entity_type', 'budget')->where('entity_id', $budgetId)->firstOrFail();
        $this->assertSame('DEPARTMENT_HEAD', $approval->required_role);

        Sanctum::actingAs($superAdmin);
        $this->patchJson('/api/approval-requests/'.$approval->id, ['status' => 'approved'])->assertForbidden();

        $this->assertSame('pending', $approval->fresh()->status);
        $this->assertSame('pending_department_head', Budget::findOrFail($budgetId)->submission_status);
    }
}
