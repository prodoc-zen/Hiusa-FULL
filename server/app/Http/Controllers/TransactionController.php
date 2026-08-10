<?php

namespace App\Http\Controllers;

use App\Models\Budget;
use App\Models\Event;
use App\Models\ApprovalRequest;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class TransactionController extends Controller
{
    public function index(Request $request)
    {
        $query = Transaction::with([
            'budget:id,title',
            'event:id,title',
            'recorder:school_id,first_name,last_name',
            'payer:school_id,first_name,last_name',
        ])
            ->where('organization_id', $request->user()->organization_id)
            ->orderBy('transaction_date', 'desc');

        if ($request->filled('budget_id')) {
            $query->where('budget_id', $request->budget_id);
        }

        if ($request->filled('event_id')) {
            $query->where('event_id', $request->event_id);
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
            'to' => ['nullable', 'date', 'after_or_equal:from'],
            'event_id' => ['nullable', 'integer'],
            'type' => ['nullable', 'in:income,expense'],
        ]);

        $query = Transaction::query()
            ->where('organization_id', $request->user()->organization_id);

        if ($request->filled('event_id')) {
            $query->where('event_id', $request->event_id);
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

        $totalIncome = (clone $query)->where('type', 'income')->sum('amount');
        $totalExpense = (clone $query)->where('type', 'expense')->sum('amount');

        $byCategory = (clone $query)
            ->selectRaw('category, type, SUM(amount) as total')
            ->groupBy('category', 'type')
            ->orderBy('total', 'desc')
            ->get();

        return response()->json([
            'total_income' => round($totalIncome, 2),
            'total_expense' => round($totalExpense, 2),
            'net_balance' => round($totalIncome - $totalExpense, 2),
            'by_category' => $byCategory,
        ]);
    }

    public function store(Request $request)
    {
        $data = $request->validate($this->rules($request));

        if (! $this->linksBelongToOrganization($request, $data)) {
            return response()->json(['message' => 'Selected transaction links must belong to this organization.'], 422);
        }

        return DB::transaction(function () use ($data, $request) {
            if (!empty($data['event_id']) && empty($data['receipt_number'])) {
                $data['receipt_number'] = ((int) Transaction::where('organization_id', $request->user()->organization_id)
                    ->where('event_id', $data['event_id'])
                    ->lockForUpdate()
                    ->max('receipt_number')) + 1;
            }

            $transaction = Transaction::create([
                ...$data,
                'recorded_by' => $request->user()->id,
                'organization_id' => $request->user()->organization_id,
            ]);

            $this->applyBudgetMovement($transaction, 1);

            return response()->json($transaction->load([
                'budget:id,title',
                'event:id,title',
                'recorder:school_id,first_name,last_name',
                'payer:school_id,first_name,last_name',
            ]), 201);
        });
    }

    public function update(Request $request, $id)
    {
        $transaction = Transaction::where('organization_id', $request->user()->organization_id)->find($id);

        if (!$transaction) {
            return response()->json(['message' => 'Transaction not found.'], 404);
        }

        $data = $request->validate($this->rules($request, true, $transaction));

        if (! $this->linksBelongToOrganization($request, $data)) {
            return response()->json(['message' => 'Selected transaction links must belong to this organization.'], 422);
        }

        return DB::transaction(function () use ($transaction, $data) {
            $this->applyBudgetMovement($transaction, -1);
            $transaction->update($data);
            $this->applyBudgetMovement($transaction->fresh(), 1);

            return response()->json($transaction->fresh()->load([
                'budget:id,title',
                'event:id,title',
                'recorder:school_id,first_name,last_name',
                'payer:school_id,first_name,last_name',
            ]));
        });
    }

    public function personalReceipts(Request $request)
    {
        $userId = $request->user()->id;

        $receipts = Transaction::with([
            'budget:id,title',
            'event:id,title',
            'recorder:school_id,first_name,last_name',
            'payer:school_id,first_name,last_name',
        ])
            ->where('organization_id', $request->user()->organization_id)
            ->where(function ($query) use ($userId) {
                $query->where('payer_id', $userId)
                    ->orWhere('recorded_by', $userId);
            })
            ->where(function ($query) {
                $query->whereNotNull('receipt_reference')
                    ->orWhereNotNull('receipt_number')
                    ->orWhereNotNull('receipt_file_url');
            })
            ->orderBy('transaction_date', 'desc')
            ->get();

        return response()->json($receipts);
    }

    public function destroy(Request $request, $id)
    {
        $transaction = Transaction::where('organization_id', $request->user()->organization_id)->find($id);

        if (!$transaction) {
            return response()->json(['message' => 'Transaction not found.'], 404);
        }

        if ($transaction->recorded_by !== $request->user()->id && $request->user()->role !== 'ADMIN') {
            return response()->json(['message' => 'You can only delete transactions you recorded.'], 403);
        }

        DB::transaction(function () use ($transaction) {
            $this->applyBudgetMovement($transaction, -1);
            $transaction->delete();
        });

        return response()->json(['message' => 'Transaction deleted successfully.']);
    }

    private function linksBelongToOrganization(Request $request, array $data): bool
    {
        $organizationId = $request->user()->organization_id;

        if (!empty($data['budget_id'])) {
            $budgetExists = Budget::where('organization_id', $organizationId)
                ->where('id', $data['budget_id'])
                ->exists();
            $budgetApproved = ApprovalRequest::where('organization_id', $organizationId)
                ->where('entity_type', 'budget')
                ->where('entity_id', $data['budget_id'])
                ->where('status', 'approved')
                ->exists();

            if (! $budgetExists || ! $budgetApproved) {
                return false;
            }
        }

        if (!empty($data['event_id']) && !Event::where('organization_id', $organizationId)->where('id', $data['event_id'])->exists()) {
            return false;
        }

        if (!empty($data['payer_id']) && !User::where('organization_id', $organizationId)->where('school_id', $data['payer_id'])->exists()) {
            return false;
        }

        return true;
    }

    private function rules(Request $request, bool $partial = false, ?Transaction $transaction = null): array
    {
        $required = $partial ? 'sometimes|required' : 'required';
        $eventId = $request->input('event_id', $transaction?->event_id);

        return [
            'type' => [$required, 'in:income,expense'],
            'amount' => [$required, 'numeric', 'min:0.01'],
            'category' => [$required, 'string', 'max:100'],
            'description' => [$required, 'string'],
            'budget_id' => ['nullable', 'exists:budgets,id'],
            'event_id' => ['nullable', 'exists:events,id'],
            'payer_id' => ['nullable', 'exists:users,school_id'],
            'transaction_date' => [$required, 'date'],
            'receipt_reference' => [
                'nullable',
                'string',
                'max:100',
                Rule::unique('transactions', 'receipt_reference')->ignore($transaction?->id),
            ],
            'receipt_number' => [
                'nullable',
                'integer',
                'min:1',
                Rule::unique('transactions', 'receipt_number')
                    ->where(fn ($query) => $query->where('event_id', $eventId))
                    ->ignore($transaction?->id),
            ],
            'receipt_file_url' => ['nullable', 'string', 'max:500'],
        ];
    }

    private function applyBudgetMovement(Transaction $transaction, int $direction): void
    {
        if (!$transaction->budget_id) {
            return;
        }

        $budget = Budget::lockForUpdate()->find($transaction->budget_id);

        if (!$budget) {
            return;
        }

        $amount = (float) $transaction->amount * $direction;
        $delta = $transaction->type === 'income' ? $amount : -$amount;
        $current = $budget->remaining_amount ?? $budget->allocated_amount;

        $budget->update([
            'remaining_amount' => (float) $current + $delta,
            'overspending_risk' => $this->overspendingRisk((float) $current + $delta, (float) $budget->warning_threshold),
        ]);
    }

    private function overspendingRisk(float $remainingAmount, float $warningThreshold): string
    {
        if ($remainingAmount < 0) {
            return 'high';
        }

        return $remainingAmount <= $warningThreshold ? 'medium' : 'low';
    }
}
