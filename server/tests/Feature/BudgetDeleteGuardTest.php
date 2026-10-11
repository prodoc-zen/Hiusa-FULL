<?php

namespace Tests\Feature;

use App\Models\Budget;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * An approved budget and a budget that carries ledger entries stay on record, also when the approval lands after the
 * budget was first read: the guard runs again on the locked row. A ledger entry that lands in that gap needs a second
 * connection to show, which SQLite cannot give; see docs/HANDOFF.md for the MariaDB run.
 */
class BudgetDeleteGuardTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        config(['performance.api_cache.enabled' => false]);
        $this->admin = User::factory()->admin()->create(['organization_id' => Organization::factory()]);
        Sanctum::actingAs($this->admin);
    }

    private function budget(string $submissionStatus): Budget
    {
        return Budget::create([
            'organization_id' => $this->admin->organization_id, 'title' => 'Budget', 'allocated_amount' => '5000.00',
            'remaining_amount' => '5000.00', 'warning_threshold' => '500.00', 'submission_status' => $submissionStatus,
        ]);
    }

    public function test_a_budget_that_is_not_approved_and_has_no_transactions_can_be_deleted(): void
    {
        foreach (['pending_department_head', 'pending_sao', 'rejected'] as $status) {
            $budget = $this->budget($status);

            $this->deleteJson("/api/budgets/{$budget->id}")->assertOk();

            $this->assertModelMissing($budget);
        }
    }

    public function test_an_approved_budget_cannot_be_deleted(): void
    {
        $budget = $this->budget('approved');

        $this->deleteJson("/api/budgets/{$budget->id}")
            ->assertConflict()
            ->assertJsonPath('message', 'Cannot delete an approved budget. It stays on record as the allocation that was approved.');

        $this->assertModelExists($budget);
    }

    public function test_a_budget_with_transactions_still_cannot_be_deleted(): void
    {
        $budget = $this->budget('pending_department_head');
        Transaction::create([
            'organization_id' => $budget->organization_id, 'recorded_by' => $this->admin->school_id, 'budget_id' => $budget->id,
            'type' => 'expense', 'amount' => '100.00', 'category' => 'Supplies', 'description' => 'Supplies', 'transaction_date' => '2026-10-05',
        ]);

        $this->deleteJson("/api/budgets/{$budget->id}")
            ->assertConflict()
            ->assertJsonPath('message', 'Cannot delete a budget that has existing transactions. Remove all transactions first.');

        $this->assertModelExists($budget);
    }

    public function test_an_approval_that_lands_after_the_budget_was_read_still_blocks_the_delete(): void
    {
        $budget = $this->budget('pending_department_head');
        $this->afterTheBudgetIsRead(fn () => DB::table('budgets')->where('id', $budget->id)->update(['submission_status' => 'approved']));

        $this->deleteJson("/api/budgets/{$budget->id}")->assertConflict();

        $this->assertModelExists($budget);
    }

    public function test_a_budget_deleted_after_it_was_read_answers_not_found(): void
    {
        $budget = $this->budget('pending_department_head');
        $this->afterTheBudgetIsRead(fn () => DB::table('budgets')->where('id', $budget->id)->delete());

        $this->deleteJson("/api/budgets/{$budget->id}")->assertNotFound();
    }

    private function afterTheBudgetIsRead(callable $interleave): void
    {
        $fired = false;
        DB::listen(function ($query) use (&$fired, $interleave) {
            if (! $fired && str_starts_with(str_replace(['"', '`'], '', $query->sql), 'select * from budgets where organization_id')) {
                $fired = true;
                $interleave();
            }
        });
    }
}
