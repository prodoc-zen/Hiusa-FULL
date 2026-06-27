<?php

namespace App\Http\Controllers;

use App\Models\Budget;
use Illuminate\Http\Request;

class BudgetController extends Controller
{
    public function index()
    {
        $budgets = Budget::with('event:id,title')
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

        $budget = Budget::create($data);

        return response()->json(
            $budget->load('event:id,title'),
            201
        );
    }

    public function update(Request $request, $id)
    {
        $budget = Budget::find($id);

        if (!$budget) {
            return response()->json(['message' => 'Budget not found.'], 404);
        }

        $data = $request->validate([
            'title'             => ['sometimes', 'required', 'string', 'max:255'],
            'allocated_amount'  => ['sometimes', 'required', 'numeric', 'min:0'],
            'warning_threshold' => ['sometimes', 'required', 'numeric', 'min:0'],
            'event_id'          => ['nullable', 'exists:events,id'],
        ]);

        $budget->update($data);

        return response()->json($budget->fresh()->load('event:id,title'));
    }

    public function destroy($id)
    {
        $budget = Budget::find($id);

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
