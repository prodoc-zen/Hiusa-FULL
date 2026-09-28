<?php

namespace Tests\Feature;

use App\Models\ApprovalRequest;
use App\Models\Budget;
use App\Models\Organization;
use App\Models\User;
use App\Services\BudgetSubmissionStatusBackfiller;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class BudgetSubmissionStatusBackfillerTest extends TestCase
{
    use RefreshDatabase;

    public function test_backfill_derives_submission_status_from_each_budgets_latest_approval_request(): void
    {
        $organization = Organization::factory()->create();
        $requester = User::factory()->admin()->create(['organization_id' => $organization->id]);

        $approvedBudget = Budget::factory()->create(['organization_id' => $organization->id]);
        ApprovalRequest::withoutEvents(fn () => ApprovalRequest::create([
            'organization_id' => $organization->id,
            'entity_type' => 'budget',
            'entity_id' => $approvedBudget->id,
            'requested_by' => $requester->school_id,
            'required_role' => 'ADMIN',
            'status' => 'approved',
        ]));

        $rejectedBudget = Budget::factory()->create(['organization_id' => $organization->id]);
        ApprovalRequest::withoutEvents(fn () => ApprovalRequest::create([
            'organization_id' => $organization->id,
            'entity_type' => 'budget',
            'entity_id' => $rejectedBudget->id,
            'requested_by' => $requester->school_id,
            'required_role' => 'ADMIN',
            'status' => 'rejected',
        ]));

        $pendingBudget = Budget::factory()->create(['organization_id' => $organization->id]);
        $pendingApproval = ApprovalRequest::withoutEvents(fn () => ApprovalRequest::create([
            'organization_id' => $organization->id,
            'entity_type' => 'budget',
            'entity_id' => $pendingBudget->id,
            'requested_by' => $requester->school_id,
            'required_role' => 'ADMIN',
            'status' => 'pending',
        ]));

        $orphanBudget = Budget::factory()->create(['organization_id' => $organization->id]);

        $counts = BudgetSubmissionStatusBackfiller::run();

        $this->assertSame(['approved' => 1, 'rejected' => 1, 'pending' => 1, 'no_request' => 1], $counts);

        $this->assertSame('approved', $approvedBudget->fresh()->submission_status);
        $this->assertSame('rejected', $rejectedBudget->fresh()->submission_status);

        $this->assertSame('pending_department_head', $pendingBudget->fresh()->submission_status);
        $this->assertSame('DEPARTMENT_HEAD', $pendingApproval->fresh()->required_role);
        $this->assertSame('pending', $pendingApproval->fresh()->status);

        // No approval request at all: the old single-stage gate never treated
        // this as spendable either, so it keeps the column default rather than
        // being upgraded to a state it never earned.
        $this->assertSame('pending_department_head', $orphanBudget->fresh()->submission_status);
    }

    public function test_backfill_reroutes_a_pending_legacy_request_without_touching_others_for_the_same_budget(): void
    {
        $organization = Organization::factory()->create();
        $requester = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $budget = Budget::factory()->create(['organization_id' => $organization->id]);

        // An older, already-decided request for the same budget must be left
        // alone; only the latest (pending) one is rerouted.
        ApprovalRequest::withoutEvents(fn () => ApprovalRequest::create([
            'organization_id' => $organization->id,
            'entity_type' => 'budget',
            'entity_id' => $budget->id,
            'requested_by' => $requester->school_id,
            'required_role' => 'ADMIN',
            'status' => 'rejected',
        ]));
        $latest = ApprovalRequest::withoutEvents(fn () => ApprovalRequest::create([
            'organization_id' => $organization->id,
            'entity_type' => 'budget',
            'entity_id' => $budget->id,
            'requested_by' => $requester->school_id,
            'required_role' => 'ADMIN',
            'status' => 'pending',
        ]));

        BudgetSubmissionStatusBackfiller::run();

        $this->assertSame('pending_department_head', $budget->fresh()->submission_status);
        $this->assertSame('DEPARTMENT_HEAD', $latest->fresh()->required_role);
        $this->assertDatabaseHas('approval_requests', [
            'entity_type' => 'budget',
            'entity_id' => $budget->id,
            'status' => 'rejected',
            'required_role' => 'ADMIN',
        ]);
    }
}
