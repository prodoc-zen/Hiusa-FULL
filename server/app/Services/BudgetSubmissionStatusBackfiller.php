<?php

namespace App\Services;

use App\Models\ApprovalRequest;
use App\Models\Budget;

class BudgetSubmissionStatusBackfiller
{
    /**
     * Backfills budgets.submission_status for rows that predate the two-stage
     * Department Head -> SAO approval chain, from each budget's latest
     * ApprovalRequest: approved -> approved, rejected -> rejected, pending ->
     * rerouted to require DEPARTMENT_HEAD and set pending_department_head.
     *
     * A budget with no approval request at all is left at the column's
     * default (pending_department_head): under the old single-stage gate,
     * TransactionController also refused spending when no ApprovalRequest
     * existed for a budget, so that default preserves the same "not yet
     * spendable" behavior these rows already had.
     *
     * @return array{approved: int, rejected: int, pending: int, no_request: int}
     */
    public static function run(): array
    {
        $counts = ['approved' => 0, 'rejected' => 0, 'pending' => 0, 'no_request' => 0];

        Budget::query()->chunkById(200, function ($budgets) use (&$counts) {
            foreach ($budgets as $budget) {
                $latest = ApprovalRequest::where('entity_type', 'budget')
                    ->where('entity_id', $budget->id)
                    ->latest('id')
                    ->first();

                if (! $latest) {
                    $counts['no_request']++;

                    continue;
                }

                if ($latest->status === 'approved') {
                    $budget->update(['submission_status' => 'approved']);
                    $counts['approved']++;
                } elseif ($latest->status === 'rejected') {
                    $budget->update(['submission_status' => 'rejected']);
                    $counts['rejected']++;
                } elseif ($latest->status === 'pending') {
                    $latest->update(['required_role' => config('approvals.routes.budget')]);
                    $budget->update(['submission_status' => 'pending_department_head']);
                    $counts['pending']++;
                }
            }
        });

        return $counts;
    }
}
