<?php

namespace App\Http\Controllers;

use App\Models\ApprovalRequest;
use App\Models\Budget;
use App\Models\Event;
use Illuminate\Http\Request;

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

        return response()->json($budgets);
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'title'              => ['required', 'string', 'max:255'],
            'allocated_amount'   => ['required', 'numeric', 'min:0'],
            'warning_threshold'  => ['required', 'numeric', 'min:0'],
            'event_id'           => ['nullable', 'exists:events,id'],
        ]);

        if (!empty($data['event_id']) && !Event::where('organization_id', $request->user()->organization_id)->where('id', $data['event_id'])->exists()) {
            return response()->json(['message' => 'Selected event does not belong to this organization.'], 422);
        }

        $budget = Budget::create([
            ...$data,
            'status' => 'pending',
            'organization_id' => $request->user()->organization_id,
        ]);

        ApprovalRequest::create([
            'organization_id' => $request->user()->organization_id,
            'entity_type' => 'budget',
            'entity_id' => $budget->id,
            'title' => $budget->title,
            'summary' => [
                'allocated_amount' => $budget->allocated_amount,
                'warning_threshold' => $budget->warning_threshold,
                'event_id' => $budget->event_id,
            ],
            'requested_by' => $request->user()->id,
        ]);

        return response()->json(
            $budget->load('event:id,title'),
            201
        );
    }

    public function update(Request $request, $id)
    {
        $budget = Budget::where('organization_id', $request->user()->organization_id)->find($id);

        if (!$budget) {
            return response()->json(['message' => 'Budget not found.'], 404);
        }

        $data = $request->validate([
            'title'             => ['sometimes', 'required', 'string', 'max:255'],
            'allocated_amount'  => ['sometimes', 'required', 'numeric', 'min:0'],
            'warning_threshold' => ['sometimes', 'required', 'numeric', 'min:0'],
            'event_id'          => ['nullable', 'exists:events,id'],
        ]);

        if (!empty($data['event_id']) && !Event::where('organization_id', $request->user()->organization_id)->where('id', $data['event_id'])->exists()) {
            return response()->json(['message' => 'Selected event does not belong to this organization.'], 422);
        }

        $budget->update($data);

        ApprovalRequest::where('entity_type', 'budget')
            ->where('entity_id', $budget->id)
            ->where('status', 'rejected')
            ->update([
                'status' => 'pending',
                'reviewed_by' => null,
                'reviewed_at' => null,
                'remarks' => null,
                'requested_at' => now(),
            ]);

        return response()->json($budget->fresh()->load('event:id,title'));
    }

    public function destroy(Request $request, $id)
    {
        $budget = Budget::where('organization_id', $request->user()->organization_id)->find($id);

        if (!$budget) {
            return response()->json(['message' => 'Budget not found.'], 404);
        }

        if ($budget->transactions()->exists()) {
            return response()->json([
                'message' => 'Cannot delete a budget that has existing transactions. Remove all transactions first.',
            ], 409);
        }

        $budget->delete();

        return response()->json(['message' => 'Budget deleted successfully.']);
    }
}
