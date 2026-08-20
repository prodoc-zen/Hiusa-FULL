<?php

namespace App\Http\Controllers;

use App\Models\ApprovalRequest;
use App\Models\Budget;
use App\Models\Event;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class BudgetController extends Controller
{
    public function index(Request $request)
    {
        $budgets = Budget::with('event:id,title')
            ->where('organization_id', $request->user()->organization_id)
            ->withCount('transactions')
            ->withSum('transactions', 'amount')
            ->orderBy('created_at', 'desc')
            ->get();

        $this->attachApprovalInfo($budgets);

        return response()->json($budgets);
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'title' => ['required', 'string', 'max:255'],
            'allocated_amount' => ['required', 'numeric', 'min:0'],
            'warning_threshold' => ['required', 'numeric', 'min:0'],
            'event_id' => ['nullable', 'exists:events,id'],
            'advisory_note' => ['nullable', 'string'],
            'overspending_risk' => ['nullable', 'in:low,medium,high'],
        ]);

        if (! $this->eventBelongsToOrganization($request, $data['event_id'] ?? null)) {
            return response()->json(['message' => 'Selected event does not belong to this organization.'], 422);
        }

        $budget = Budget::create([
            ...$data,
            'remaining_amount' => $data['allocated_amount'],
            'organization_id' => $request->user()->organization_id,
        ]);

        ApprovalRequest::create([
            'organization_id' => $request->user()->organization_id,
            'entity_type' => 'budget',
            'entity_id' => $budget->id,
            'requested_by' => $request->user()->id,
            'required_role' => $request->user()->role === 'DEPARTMENT_HEAD' ? 'ADMIN' : 'DEPARTMENT_HEAD',
        ]);

        return response()->json($budget->load('event:id,title'), 201);
    }

    public function update(Request $request, $id)
    {
        $budget = Budget::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $budget) {
            return response()->json(['message' => 'Budget not found.'], 404);
        }

        $data = $request->validate([
            'title' => ['sometimes', 'required', 'string', 'max:255'],
            'allocated_amount' => ['sometimes', 'required', 'numeric', 'min:0'],
            'warning_threshold' => ['sometimes', 'required', 'numeric', 'min:0'],
            'event_id' => ['nullable', 'exists:events,id'],
            'advisory_note' => ['nullable', 'string'],
            'overspending_risk' => ['nullable', 'in:low,medium,high'],
        ]);

        if (! $this->eventBelongsToOrganization($request, $data['event_id'] ?? null)) {
            return response()->json(['message' => 'Selected event does not belong to this organization.'], 422);
        }

        if (array_key_exists('allocated_amount', $data)) {
            $spent = $budget->transactions()->where('type', 'expense')->sum('amount');
            $income = $budget->transactions()->where('type', 'income')->sum('amount');
            $data['remaining_amount'] = (float) $data['allocated_amount'] + (float) $income - (float) $spent;
        }

        if ($this->hasApprovedApproval($budget) && $this->hasMaterialBudgetChange($data)) {
            $this->reopenApproval($budget, $request);
        }

        $budget->update($data);

        ApprovalRequest::where('entity_type', 'budget')
            ->where('entity_id', $budget->id)
            ->where('status', 'rejected')
            ->where('organization_id', $budget->organization_id)
            ->get()
            ->each(fn (ApprovalRequest $approval) => $approval->resubmit());

        return response()->json($budget->fresh()->load('event:id,title'));
    }

    public function destroy(Request $request, $id)
    {
        $budget = Budget::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $budget) {
            return response()->json(['message' => 'Budget not found.'], 404);
        }

        if ($budget->transactions()->exists()) {
            return response()->json([
                'message' => 'Cannot delete a budget that has existing transactions. Remove all transactions first.',
            ], 409);
        }

        DB::transaction(function () use ($budget) {
            ApprovalRequest::where('organization_id', $budget->organization_id)
                ->where('entity_type', 'budget')
                ->where('entity_id', $budget->id)
                ->delete();
            $budget->delete();
        });

        return response()->json(['message' => 'Budget deleted successfully.']);
    }

    private function eventBelongsToOrganization(Request $request, mixed $eventId): bool
    {
        if (empty($eventId)) {
            return true;
        }

        return Event::where('organization_id', $request->user()->organization_id)
            ->where('id', $eventId)
            ->exists();
    }

    private function attachApprovalInfo($budgets): void
    {
        $approvals = ApprovalRequest::where('entity_type', 'budget')
            ->whereIn('entity_id', $budgets->pluck('id'))
            ->orderBy('id')
            ->get()
            ->keyBy('entity_id');

        foreach ($budgets as $budget) {
            $approval = $approvals->get($budget->id);
            $budget->approval_status = $approval?->status;
            $budget->approval_remarks = $approval?->remarks;
        }
    }

    private function hasApprovedApproval(Budget $budget): bool
    {
        return ApprovalRequest::where('entity_type', 'budget')
            ->where('entity_id', $budget->id)
            ->where('organization_id', $budget->organization_id)
            ->where('status', 'approved')
            ->exists();
    }

    private function hasMaterialBudgetChange(array $data): bool
    {
        return count(array_intersect(array_keys($data), [
            'title',
            'allocated_amount',
            'warning_threshold',
            'event_id',
            'advisory_note',
            'overspending_risk',
        ])) > 0;
    }

    private function reopenApproval(Budget $budget, Request $request): void
    {
        ApprovalRequest::where('entity_type', 'budget')
            ->where('entity_id', $budget->id)
            ->where('organization_id', $budget->organization_id)
            ->latest('id')
            ->first()
            ?->reopen(
                $request->user()->id,
                $request->user()->role === 'DEPARTMENT_HEAD' ? 'ADMIN' : 'DEPARTMENT_HEAD'
            );
    }
}
