<?php

namespace App\Http\Controllers;

use App\Models\Transaction;
use Illuminate\Http\Request;

class TransactionController extends Controller
{
    public function index(Request $request)
    {
        $query = Transaction::with([
            'budget:id,title',
            'recorder:id,first_name,last_name',
        ])->orderBy('transaction_date', 'desc');

        if ($request->filled('budget_id')) {
            $query->where('budget_id', $request->budget_id);
        }

        if ($request->filled('type')) {
            $query->where('type', $request->type);
        }

        if ($request->filled('from')) {
            $query->whereDate('transaction_date', '>=', $request->from);
        }

        if ($request->filled('to')) {
            $query->whereDate('transaction_date', '<=', $request->to);
        }

        $perPage = min((int) $request->get('per_page', 20), 1000);
        return response()->json($query->paginate($perPage));
    }

    public function summary(Request $request)
    {
        $request->validate([
            'from' => ['nullable', 'date'],
            'to'   => ['nullable', 'date'],
        ]);

        $query = Transaction::query();

        if ($request->filled('from')) {
            $query->whereDate('transaction_date', '>=', $request->from);
        }

        if ($request->filled('to')) {
            $query->whereDate('transaction_date', '<=', $request->to);
        }

        $totalIncome  = (clone $query)->where('type', 'income')->sum('amount');
        $totalExpense = (clone $query)->where('type', 'expense')->sum('amount');

        $byCategory = (clone $query)
            ->selectRaw('category, type, SUM(amount) as total')
            ->groupBy('category', 'type')
            ->orderBy('total', 'desc')
            ->get();

        return response()->json([
            'total_income'  => round($totalIncome, 2),
            'total_expense' => round($totalExpense, 2),
            'net_balance'   => round($totalIncome - $totalExpense, 2),
            'by_category'   => $byCategory,
        ]);
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'type'              => ['required', 'in:income,expense'],
            'amount'            => ['required', 'numeric', 'min:0.01'],
            'category'          => ['required', 'string', 'max:100'],
            'description'       => ['required', 'string'],
            'budget_id'         => ['nullable', 'exists:budgets,id'],
            'transaction_date'  => ['required', 'date'],
            'receipt_reference' => ['nullable', 'string', 'max:100', 'unique:transactions,receipt_reference'],
        ]);

        $transaction = Transaction::create([
            ...$data,
            'recorded_by' => $request->user()->id,
        ]);

        return response()->json(
            $transaction->load([
                'budget:id,title',
                'recorder:id,first_name,last_name',
            ]),
            201
        );
    }

    public function destroy(Request $request, $id)
    {
        $transaction = Transaction::find($id);

        if (!$transaction) {
            return response()->json(['message' => 'Transaction not found.'], 404);
        }

        if ($transaction->recorded_by !== $request->user()->id && $request->user()->role !== 'admin') {
            return response()->json(['message' => 'You can only delete transactions you recorded.'], 403);
        }

        $transaction->delete();

        return response()->json(['message' => 'Transaction deleted successfully.']);
    }
}
