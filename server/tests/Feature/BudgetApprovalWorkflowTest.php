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
