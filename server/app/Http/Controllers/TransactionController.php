<?php

namespace App\Http\Controllers;

use App\Models\ApprovalRequest;
use App\Models\AuditLog;
use App\Models\Budget;
use App\Models\Event;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class TransactionController extends Controller
{
    public function index(Request $request)
    {
        $filters = $request->validate([
            'budget_id' => ['nullable', 'integer'],
            'event_id' => ['nullable', 'integer'],
            'type' => ['nullable', 'in:income,expense'],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date', 'after_or_equal:from'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:1000'],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);

        $query = Transaction::with([
            'budget:id,title',
            'event:id,title',
            'recorder:school_id,first_name,last_name',
            'payer:school_id,first_name,last_name',
        ])
            ->where('organization_id', $request->user()->organization_id)
            ->orderBy('transaction_date', 'desc');

        if (! empty($filters['budget_id'])) {
            $query->where('budget_id', $filters['budget_id']);
        }

        if (! empty($filters['event_id'])) {
            $query->where('event_id', $filters['event_id']);
        }

        if (! empty($filters['type'])) {
            $query->where('type', $filters['type']);
        }

        if (! empty($filters['from'])) {
            $query->whereDate('transaction_date', '>=', $filters['from']);
        }

        if (! empty($filters['to'])) {
            $query->whereDate('transaction_date', '<=', $filters['to']);
        }

        return response()->json($query->paginate($filters['per_page'] ?? 20));
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

        if ($message = $this->validateAndNormalizeLinks($request, $data)) {
            return response()->json(['message' => $message], 422);
        }

        return DB::transaction(function () use ($data, $request) {
            if (empty($data['receipt_number'])) {
                $data['receipt_number'] = ((int) Transaction::where('organization_id', $request->user()->organization_id)
                    ->when(
                        ! empty($data['event_id']),
                        fn ($query) => $query->where('event_id', $data['event_id']),
                        fn ($query) => $query->whereNull('event_id'),
                    )
                    ->lockForUpdate()
                    ->max('receipt_number')) + 1;
            }

            $transaction = Transaction::create([
                ...$data,
                'recorded_by' => $request->user()->id,
                'organization_id' => $request->user()->organization_id,
            ]);

            if (empty($transaction->receipt_reference)) {
                $transaction->update([
                    'receipt_reference' => 'HIUSA-'.$request->user()->organization_id.'-'.str_pad((string) $transaction->id, 8, '0', STR_PAD_LEFT),
                ]);
            }

            $this->applyBudgetMovement($transaction, 1);
            $this->recordFinancialAudit($request, 'created', $transaction, null, $this->auditableValues($transaction->fresh()));

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

        if (! $transaction) {
            return response()->json(['message' => 'Transaction not found.'], 404);
        }

        $data = $request->validate($this->rules($request, true, $transaction));

        if ($message = $this->validateAndNormalizeLinks($request, $data, $transaction)) {
            return response()->json(['message' => $message], 422);
        }

        return DB::transaction(function () use ($transaction, $data, $request) {
            $oldValues = $this->auditableValues($transaction);
            $this->applyBudgetMovement($transaction, -1);
            $transaction->update($data);
            $this->applyBudgetMovement($transaction->fresh(), 1);
            $this->recordFinancialAudit($request, 'updated', $transaction, $oldValues, $this->auditableValues($transaction->fresh()));

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

        if (! $transaction) {
            return response()->json(['message' => 'Transaction not found.'], 404);
        }

        if ($transaction->recorded_by !== $request->user()->id && $request->user()->role !== 'ADMIN') {
            return response()->json(['message' => 'You can only delete transactions you recorded.'], 403);
        }

        DB::transaction(function () use ($transaction, $request) {
            $oldValues = $this->auditableValues($transaction);
            $this->applyBudgetMovement($transaction, -1);
            $transaction->delete();
            $this->recordFinancialAudit($request, 'deleted', $transaction, $oldValues, null);
        });

        return response()->json(['message' => 'Transaction deleted successfully.']);
    }

    private function validateAndNormalizeLinks(Request $request, array &$data, ?Transaction $transaction = null): ?string
    {
        $organizationId = $request->user()->organization_id;
        $budgetId = array_key_exists('budget_id', $data) ? $data['budget_id'] : $transaction?->budget_id;
        $eventId = array_key_exists('event_id', $data) ? $data['event_id'] : $transaction?->event_id;

        if (! empty($budgetId)) {
            $budget = Budget::where('organization_id', $organizationId)
                ->where('id', $budgetId)
                ->first();
            $latestApproval = ApprovalRequest::where('organization_id', $organizationId)
                ->where('entity_type', 'budget')
                ->where('entity_id', $budgetId)
                ->latest('id')
                ->first();

            if (! $budget || $latestApproval?->status !== 'approved') {
                return 'The selected budget must belong to this organization and be approved.';
            }

            if ($budget->event_id) {
                if ($eventId && (int) $eventId !== (int) $budget->event_id) {
                    return 'The selected budget is linked to a different event.';
                }

                $eventId = $budget->event_id;
                $data['event_id'] = $budget->event_id;
            }
        }

        if (! empty($eventId) && ! Event::where('organization_id', $organizationId)->where('id', $eventId)->exists()) {
            return 'The selected event does not belong to this organization.';
        }

        if (! empty($data['payer_id']) && ! User::where('organization_id', $organizationId)->where('school_id', $data['payer_id'])->exists()) {
            return 'The selected payer does not belong to this organization.';
        }

        return null;
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
        if (! $transaction->budget_id) {
            return;
        }

        $budget = Budget::lockForUpdate()->find($transaction->budget_id);

        if (! $budget) {
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

    private function auditableValues(Transaction $transaction): array
    {
        return $transaction->only([
            'id',
            'budget_id',
            'event_id',
            'payer_id',
            'type',
            'category',
            'amount',
            'description',
            'receipt_reference',
            'receipt_number',
            'transaction_date',
        ]);
    }

    private function recordFinancialAudit(Request $request, string $action, Transaction $transaction, ?array $oldValues, ?array $newValues): void
    {
        AuditLog::create([
            'organization_id' => $request->user()->organization_id,
            'user_id' => $request->user()->school_id,
            'module' => 'financial_ledger',
            'action' => $action,
            'record_type' => Transaction::class,
            'record_id' => $transaction->id,
            'old_values' => $oldValues,
            'new_values' => $newValues,
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);
    }
}
