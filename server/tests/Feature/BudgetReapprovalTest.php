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
 * A budget's remaining amount is its allocation, plus income recorded against
 * it, minus what was spent from it. Approving it again after an edit used to
 * reset it to the full allocation, erasing the spending already recorded.
 */
class BudgetReapprovalTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private User $head;

    protected function setUp(): void
    {
        parent::setUp();
        $organization = Organization::factory()->create();
        $this->admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $this->head = User::factory()->create(['organization_id' => $organization->id, 'role' => 'DEPARTMENT_HEAD', 'account_status' => 'active']);
    }

    private function approveAsHead(Budget $budget): void
    {
        $approval = ApprovalRequest::where('entity_type', 'budget')->where('entity_id', $budget->id)->where('status', 'pending')->latest('id')->firstOrFail();
        Sanctum::actingAs($this->head);
        $this->patchJson("/api/approval-requests/{$approval->id}", ['status' => 'approved'])->assertOk();
        Sanctum::actingAs($this->admin);
    }

    private function spend(Budget $budget, string $type, float $amount): int
    {
        return $this->postJson('/api/transactions', [
            'type' => $type, 'amount' => $amount, 'category' => 'Supplies', 'description' => "{$type} {$amount}",
            'budget_id' => $budget->id, 'transaction_date' => now()->toDateString(),
        ])->assertCreated()->json('id');
    }

    public function test_reapproval_keeps_recorded_spending_and_deleting_it_restores_the_allocation(): void
    {
        Sanctum::actingAs($this->admin);
        $budget = Budget::findOrFail($this->postJson('/api/budgets', ['title' => 'Sports Fest', 'allocated_amount' => 1000, 'warning_threshold' => 200])->assertCreated()->json('id'));
        $this->approveAsHead($budget);
        $expense = $this->spend($budget, 'expense', 400);
        $this->assertEquals(600, (float) $budget->fresh()->remaining_amount);

        $this->putJson("/api/budgets/{$budget->id}", ['title' => 'Sports Fest 2026'])->assertOk();
        $this->approveAsHead($budget);
        $this->assertEquals(600, (float) $budget->fresh()->remaining_amount, 'Re-approval must not erase the 400 already spent.');

        $this->deleteJson("/api/transactions/{$expense}")->assertOk();
        $this->assertEquals(1000, (float) $budget->fresh()->remaining_amount);
    }

    public function test_raising_the_allocation_is_kept_through_reapproval_and_refreshes_the_risk(): void
    {
        Sanctum::actingAs($this->admin);
        $budget = Budget::findOrFail($this->postJson('/api/budgets', ['title' => 'Assembly', 'allocated_amount' => 1000, 'warning_threshold' => 200])->assertCreated()->json('id'));
        $this->approveAsHead($budget);
        $this->spend($budget, 'expense', 900);
        $this->assertSame('medium', $budget->fresh()->overspending_risk);

        $this->putJson("/api/budgets/{$budget->id}", ['allocated_amount' => 5000])->assertOk();
        $this->assertSame('low', $budget->fresh()->overspending_risk, 'Raising the allocation must refresh the stored risk.');
        $this->approveAsHead($budget);

        $budget->refresh();
        $this->assertEquals(4100, (float) $budget->remaining_amount);
        $this->assertSame('low', $budget->overspending_risk);
    }
}
