<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\Budget;
use App\Models\CashAdvance;
use App\Models\CashAdvanceRepayment;
use App\Models\Collection;
use App\Models\Event;
use App\Models\FinancialReport;
use App\Models\Invoice;
use App\Models\InvoicePayment;
use App\Models\Notification;
use App\Models\Order;
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
            'per_page' => ['nullable', 'integer', 'in:10'],
            'page' => ['nullable', 'integer', 'min:1'],
            'search' => ['nullable', 'string', 'max:150'],
            'event_search' => ['nullable', 'string', 'max:150'],
        ]);

        $query = Transaction::with([
            'budget:id,title',
            'event:id,title',
            'recorder:school_id,first_name,last_name',
            'payer:school_id,first_name,last_name,department,program,year_level',
            'organization:id,name,acronym',
        ])->withSystemSource()->orderBy('transaction_date', 'desc');

        $query->whereIn('organization_id', $this->readableOrganizationIds($request));

        if (! empty($filters['budget_id'])) {
            $query->where('budget_id', $filters['budget_id']);
        }

        if (! empty($filters['event_id'])) {
            $query->where('event_id', $filters['event_id']);
        }

        if (! empty($filters['event_search'])) {
            $eventSearch = trim($filters['event_search']);
            $query->whereHas('event', fn ($event) => $event->where('title', 'like', "%{$eventSearch}%"));
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

        if (! empty($filters['search'])) {
            $search = trim($filters['search']);
            $query->where(function ($nested) use ($search) {
                $nested->where('description', 'like', "%{$search}%")
                    ->orWhere('category', 'like', "%{$search}%")
                    ->orWhere('receipt_reference', 'like', "%{$search}%")
                    ->orWhereHas('event', fn ($event) => $event->where('title', 'like', "%{$search}%"))
                    ->orWhereHas('budget', fn ($budget) => $budget->where('title', 'like', "%{$search}%"));

                $nested->orWhereHas('payer', fn ($payer) => $payer->where('school_id', 'like', "%{$search}%")->orWhere('first_name', 'like', "%{$search}%")->orWhere('last_name', 'like', "%{$search}%")->orWhere('department', 'like', "%{$search}%")->orWhere('program', 'like', "%{$search}%")->orWhere('year_level', 'like', "%{$search}%"));

                if (ctype_digit($search)) {
                    $nested->orWhere('receipt_number', (int) $search);
                }
            });
        }

        $page = $query->paginate(10);
        $this->exposeLedgerFlags($page->getCollection());

        return response()->json($page);
    }

    public function summary(Request $request)
    {
        $request->validate([
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date', 'after_or_equal:from'],
            'event_id' => ['nullable', 'integer'],
            'event_search' => ['nullable', 'string', 'max:150'],
            'type' => ['nullable', 'in:income,expense'],
        ]);

        $query = Transaction::whereIn('organization_id', $this->readableOrganizationIds($request));

        if ($request->filled('event_id')) {
            $query->where('event_id', $request->event_id);
        }

        if ($request->filled('event_search')) {
            $eventSearch = trim($request->string('event_search')->toString());
            $query->whereHas('event', fn ($event) => $event->where('title', 'like', "%{$eventSearch}%"));
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
            $this->notifyReceiptOwner($transaction);

            $transaction->load([
                'budget:id,title',
                'event:id,title',
                'recorder:school_id,first_name,last_name',
                'payer:school_id,first_name,last_name',
            ])->loadSystemSource();
            $this->exposeLedgerFlags([$transaction]);

            return response()->json($transaction, 201);
        });
    }

    public function update(Request $request, $id)
    {
        $transaction = Transaction::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $transaction) {
            return response()->json(['message' => 'Transaction not found.'], 404);
        }

        if ($message = $this->systemSourceMessage($transaction)) {
            return response()->json(['message' => $message], 409);
        }

        $data = $request->validate($this->rules($request, true, $transaction));

        if ($message = $this->validateAndNormalizeLinks($request, $data, $transaction)) {
            return response()->json(['message' => $message], 422);
        }

        return DB::transaction(function () use ($transaction, $data, $request) {
            $transaction = Transaction::where('organization_id', $transaction->organization_id)->lockForUpdate()->find($transaction->id);

            if (! $transaction) {
                return response()->json(['message' => 'Transaction not found.'], 404);
            }

            if ($message = $this->reportLockMessage($transaction)) {
                return response()->json(['message' => $message], 409);
            }

            $oldValues = $this->auditableValues($transaction);
            $this->applyBudgetMovement($transaction, -1);
            $transaction->update($data);
            $this->applyBudgetMovement($transaction->fresh(), 1);
            $this->recordFinancialAudit($request, 'updated', $transaction, $oldValues, $this->auditableValues($transaction->fresh()));

            $updated = $transaction->fresh()->load([
                'budget:id,title',
                'event:id,title',
                'recorder:school_id,first_name,last_name',
                'payer:school_id,first_name,last_name',
            ])->loadSystemSource();
            $this->exposeLedgerFlags([$updated]);

            return response()->json($updated);
        });
    }

    public function personalReceipts(Request $request)
    {
        $userId = $request->user()->id;

        $receipts = Transaction::with([
            'organization:id,name',
            'merchandiseOrder' => fn ($query) => $query
                ->where('organization_id', $request->user()->organization_id)
                ->select(['id', 'transaction_id', 'payment_method', 'approved_by']),
            'merchandiseOrder.approver:school_id,first_name,last_name',
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

        if ($message = $this->systemSourceMessage($transaction)) {
            return response()->json(['message' => $message], 409);
        }

        if ($transaction->recorded_by !== $request->user()->id && $request->user()->role !== 'ADMIN') {
            return response()->json(['message' => 'You can only delete transactions you recorded.'], 403);
        }

        return DB::transaction(function () use ($transaction, $request) {
            $transaction = Transaction::where('organization_id', $transaction->organization_id)->lockForUpdate()->find($transaction->id);

            if (! $transaction) {
                return response()->json(['message' => 'Transaction not found.'], 404);
            }

            if ($message = $this->reportLockMessage($transaction)) {
                return response()->json(['message' => $message], 409);
            }

            $oldValues = $this->auditableValues($transaction);
            $this->applyBudgetMovement($transaction, -1);
            $transaction->delete();
            $this->recordFinancialAudit($request, 'deleted', $transaction, $oldValues, null);

            return response()->json(['message' => 'Transaction deleted successfully.']);
        });
    }

    private function systemSourceMessage(Transaction $transaction): ?string
    {
        return match ($transaction->loadSystemSource()->systemSource()) {
            'collection' => 'This entry was recorded when collection '.Collection::where('ledger_transaction_id', $transaction->id)->value('reference').' was verified. Change it from Collections.',
            'cash_advance' => 'This entry was recorded when cash advance '.CashAdvance::where('release_transaction_id', $transaction->id)->value('reference').' was released. Change it from Cash Advances.',
            'repayment' => 'This entry was recorded when a repayment for cash advance '.CashAdvance::whereKey(CashAdvanceRepayment::where('ledger_transaction_id', $transaction->id)->value('cash_advance_id'))->value('reference').' was received. Change it from Cash Advances.',
            'invoice_payment' => 'This entry was recorded when a payment for invoice '.Invoice::whereKey(InvoicePayment::where('ledger_transaction_id', $transaction->id)->value('invoice_id'))->value('reference').' was approved. Change it from Student Financial Accounts.',
            'order' => 'This entry was recorded when merchandise order ORD-'.Order::where('transaction_id', $transaction->id)->value('id').' was paid. Change it from Manage Orders.',
            default => null,
        };
    }

    private function reportLockMessage(Transaction $transaction): ?string
    {
        $title = FinancialReport::lockingTitles([$transaction])[$transaction->id] ?? null;

        return $title === null
            ? null
            : "This entry is part of the financial report '{$title}' that has been submitted. Ask the Department Head to return the report before changing it.";
    }

    /**
     * Tells the client which entries it must not offer to change: the system-generated
     * ones and the ones inside a submitted report. One report query covers the whole page.
     *
     * @param  iterable<Transaction>  $transactions
     */
    private function exposeLedgerFlags(iterable $transactions): void
    {
        $titles = FinancialReport::lockingTitles($transactions);

        foreach ($transactions as $transaction) {
            $transaction->exposeSystemSource()
                ->setAttribute('is_locked_by_report', isset($titles[$transaction->id]))
                ->setAttribute('locking_report_title', $titles[$transaction->id] ?? null);
        }
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

            // Single source of truth: Budget::submission_status, not the latest
            // ApprovalRequest row. Under the two-stage Department Head -> SAO
            // chain the latest request can be an 'approved' Department Head
            // sign-off while the budget itself is still only pending_sao.
            if (! $budget || $budget->submission_status !== 'approved') {
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

        if (! empty($data['payer_id']) && ! User::whereHas('accountProfiles', fn ($profiles) => $profiles->where('organization_id', $organizationId)->where('account_status', 'active'))->where('school_id', $data['payer_id'])->exists()) {
            return 'The selected payer does not belong to this organization.';
        }

        return null;
    }

    private function rules(Request $request, bool $partial = false, ?Transaction $transaction = null): array
    {
        $required = $partial ? ['sometimes', 'required'] : ['required'];
        $eventId = $request->input('event_id', $transaction?->event_id);

        return [
            'type' => [...$required, 'in:income,expense'],
            'amount' => [...$required, 'numeric', 'min:0.01'],
            'category' => [...$required, 'string', 'max:100'],
            'description' => [...$required, 'string'],
            'budget_id' => ['nullable', 'exists:budgets,id'],
            'event_id' => ['nullable', 'exists:events,id'],
            'payer_id' => ['nullable', 'exists:users,school_id'],
            'transaction_date' => [...$required, 'date'],
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
            'overspending_risk' => Budget::overspendingRiskFor((float) $current + $delta, (float) $budget->warning_threshold),
        ]);
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

    private function notifyReceiptOwner(Transaction $transaction): void
    {
        if (! $transaction->payer_id || $transaction->payer_id === $transaction->recorded_by) {
            return;
        }

        Notification::create([
            'organization_id' => $transaction->organization_id,
            'user_id' => $transaction->payer_id,
            'title' => 'Receipt Available',
            'message' => 'Receipt '.$transaction->receipt_reference.' is now available in My Receipts.',
            'notification_type' => 'financial',
            'reference_type' => Transaction::class,
            'reference_id' => $transaction->id,
            'is_read' => false,
            'sent_at' => now(),
        ]);
    }
}
