<?php

namespace App\Http\Controllers;

use App\Models\AcademicSemester;
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
use App\Services\ReceiptPdfService;
use App\Services\TransactionReceiptFiles;
use App\Support\FilterValues;
use App\Support\LedgerScope;
use App\Support\SemesterScope;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class TransactionController extends Controller
{
    public function index(Request $request)
    {
        $filters = $request->validate([
            'budget_id' => ['nullable', FilterValues::rule(['nullable', 'integer'])],
            'event_id' => ['nullable', FilterValues::rule(['nullable', 'integer'])],
            'type' => ['nullable', FilterValues::rule(['nullable', 'in:income,expense'])],
            'academic_semester_id' => ['nullable', FilterValues::rule(['integer', 'exists:academic_semesters,id'])],
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
        ])->withSystemSource()->orderBy('transaction_date', 'desc')->orderByDesc('id');

        $query->whereIn('organization_id', $this->readableOrganizationIds($request));

        if (! empty($filters['academic_semester_id'])) {
            SemesterScope::dated($query, 'transaction_date', AcademicSemester::whereIn('id', FilterValues::values($filters['academic_semester_id']))->get());
        } else {
            SemesterScope::selected($query, 'transaction_date', AcademicSemester::selected($request));
        }

        if (! empty($filters['budget_id'])) {
            $query->whereIn('budget_id', FilterValues::values($filters['budget_id']));
        }

        if (! empty($filters['event_id'])) {
            $query->whereIn('event_id', FilterValues::values($filters['event_id']));
        }

        if (! empty($filters['event_search'])) {
            $eventSearch = trim($filters['event_search']);
            $query->whereHas('event', fn ($event) => $event->where('title', 'like', "%{$eventSearch}%"));
        }

        if (! empty($filters['type'])) {
            $query->whereIn('type', FilterValues::values($filters['type']));
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
        $filters = $request->validate([
            'budget_id' => ['nullable', FilterValues::rule(['nullable', 'integer'])],
            'event_id' => ['nullable', FilterValues::rule(['nullable', 'integer'])],
            'type' => ['nullable', FilterValues::rule(['nullable', 'in:income,expense'])],
            'academic_semester_id' => ['nullable', FilterValues::rule(['integer', 'exists:academic_semesters,id'])],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date', 'after_or_equal:from'],
            'search' => ['nullable', 'string', 'max:150'],
            'event_search' => ['nullable', 'string', 'max:150'],
        ]);

        $query = LedgerScope::query($request, $this->readableOrganizationIds($request), $filters);
        $totals = LedgerScope::totals($query);

        $byCategory = (clone $query)
            ->selectRaw('category, type, SUM(amount) as total')
            ->groupBy('category', 'type')
            ->orderBy('total', 'desc')
            ->get();

        return response()->json([
            ...$totals,
            'by_category' => $byCategory,
        ]);
    }

    /**
     * One ledger per event of the semester, the entries that belong to no event, and the totals row that adds them
     * all up. The totals are the Ledger summary for the same semester: they come from the same scope and cover the same
     * entries, so an event outside the semester that has entries dated inside it is listed too.
     */
    public function eventLedgers(Request $request)
    {
        $filters = $request->validate([
            'academic_semester_id' => ['nullable', FilterValues::rule(['integer', 'exists:academic_semesters,id'])],
        ]);
        $organizationIds = $this->readableOrganizationIds($request);

        $perEvent = LedgerScope::query($request, $organizationIds, $filters)
            ->toBase()
            ->selectRaw('transactions.event_id')
            ->selectRaw("COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income")
            ->selectRaw("COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense")
            ->selectRaw('COUNT(*) AS transaction_count')
            ->groupBy('transactions.event_id')
            ->get()
            ->keyBy(fn ($row) => $row->event_id ?? 0);

        $semesterIds = ! empty($filters['academic_semester_id'])
            ? array_map('intval', FilterValues::values($filters['academic_semester_id']))
            : array_filter([AcademicSemester::selected($request)?->id]);

        $events = Event::whereIn('organization_id', $organizationIds)
            ->when($semesterIds !== [], fn ($scoped) => $scoped->where(fn ($event) => $event
                ->whereIn('academic_semester_id', $semesterIds)
                ->orWhereIn('id', $perEvent->keys()->filter()->values()->all())))
            ->orderBy('start_time')
            ->orderBy('id')
            ->get(['id', 'title', 'start_time', 'status']);

        $budgets = $this->eventBudgetFigures($events->pluck('id')->all());

        $money = fn (float $amount) => number_format($amount, 2, '.', '');
        $figures = function ($row) use ($money) {
            $income = (float) ($row->income ?? 0);
            $expense = (float) ($row->expense ?? 0);

            return [
                'income' => $money($income),
                'expense' => $money($expense),
                'net' => $money($income - $expense),
                'transaction_count' => (int) ($row->transaction_count ?? 0),
            ];
        };

        $totals = (object) [
            'income' => $perEvent->sum(fn ($row) => (float) $row->income),
            'expense' => $perEvent->sum(fn ($row) => (float) $row->expense),
            'transaction_count' => $perEvent->sum(fn ($row) => (int) $row->transaction_count),
        ];

        return response()->json([
            'data' => $events->map(fn (Event $event) => [
                'event_id' => $event->id,
                'title' => $event->title,
                'start_time' => $event->start_time,
                'status' => $event->status,
                ...$figures($perEvent->get($event->id)),
                'budget' => $budgets[$event->id] ?? null,
            ])->values(),
            'unassigned' => $figures($perEvent->get(0)),
            'totals' => $figures($totals),
        ]);
    }

    /**
     * The budget each event shows on its ledger: the approved one when there is one, otherwise the latest.
     * A budget that is not approved is not released, so it reads nothing spent and its whole allocation left.
     *
     * @param  array<int>  $eventIds
     * @return array<int, array<string, mixed>>
     */
    private function eventBudgetFigures(array $eventIds): array
    {
        if ($eventIds === []) {
            return [];
        }

        $chosen = Budget::whereIn('event_id', $eventIds)
            ->orderBy('id')
            ->get()
            ->groupBy('event_id')
            ->map(fn ($budgets) => $budgets->firstWhere('submission_status', 'approved') ?? $budgets->last());
        $figures = Budget::figuresFor($chosen->values());

        return $chosen->map(fn (Budget $budget) => [
            'id' => $budget->id,
            'title' => $budget->title,
            'submission_status' => $budget->submission_status,
            'is_released' => $figures[$budget->id]['is_released'],
            'allocated_amount' => $figures[$budget->id]['allocated_amount'],
            'spent_amount' => $figures[$budget->id]['spent_amount'],
            'remaining_amount' => $figures[$budget->id]['remaining_amount'],
        ])->all();
    }

    public function store(Request $request)
    {
        $data = $request->validate($this->rules($request), $this->messages());

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

        if ($transaction->recorded_by !== $request->user()->id && $request->user()->role !== 'ADMIN') {
            return response()->json(['message' => 'You can only change transactions you recorded.'], 403);
        }

        $data = $request->validate($this->rules($request, true, $transaction), $this->messages());

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

    /** The receipts for payments this person made: a student's from every organization they belong to, anyone else's from their own. */
    private function ownReceipts(Request $request)
    {
        $userId = $request->user()->id;
        $organizationIds = $request->user()->role === 'STUDENT' ? $request->user()->memberOrganizationIds() : [$request->user()->organization_id];

        return Transaction::with([
            'organization:id,name',
            'merchandiseOrder' => fn ($query) => $query
                ->whereIn('organization_id', $organizationIds)
                ->select(['id', 'transaction_id', 'payment_method', 'approved_by']),
            'merchandiseOrder.approver:school_id,first_name,last_name',
            'budget:id,title',
            'event:id,title',
            'recorder:school_id,first_name,last_name',
            'payer:school_id,first_name,last_name',
        ])
            ->whereIn('organization_id', $organizationIds)
            ->where('payer_id', $userId)
            ->where(function ($query) {
                $query->whereNotNull('receipt_reference')
                    ->orWhereNotNull('receipt_number')
                    ->orWhereNotNull('receipt_file_url');
            });
    }

    public function personalReceipts(Request $request)
    {
        $receipts = $this->ownReceipts($request)
            ->orderBy('transaction_date', 'desc')
            ->orderByDesc('id')
            ->get();

        // The same protected-file shape the other documents use, so the client opens the PDF with openProtectedFile.
        $receipts->each(fn (Transaction $receipt) => $receipt->setAttribute('open_url', '/transactions/personal-receipts/'.$receipt->id.'/pdf'));

        return response()->json($receipts);
    }

    public function personalReceiptPdf(Request $request, ReceiptPdfService $pdf, int $id)
    {
        $receipt = $this->ownReceipts($request)->find($id);

        if (! $receipt) {
            return response()->json(['message' => 'Receipt not found.'], 404);
        }

        $rendered = $pdf->render($receipt);

        return response($rendered['content'], 200, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => ($request->boolean('inline') ? 'inline' : 'attachment').'; filename="'.$rendered['filename'].'"',
            'Cache-Control' => 'private, no-store, max-age=0',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    /** Opens the private receipt file kept for a transaction, for the people who can read that organization's ledger. */
    public function receiptFile(Request $request, TransactionReceiptFiles $files, int $id)
    {
        $transaction = Transaction::whereIn('organization_id', $this->readableOrganizationIds($request))->find($id);
        $path = $transaction?->receipt_file_url;

        if (! $transaction || ! $files->isOurs($path) || ! str_starts_with($path, 'finance-receipts/'.$transaction->organization_id.'/') || ! $files->exists($path)) {
            return response()->json(['message' => 'Receipt file not found.'], 404);
        }

        $extension = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        $type = ['jpg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp', 'pdf' => 'application/pdf'][$extension] ?? 'application/octet-stream';
        $response = response()->file($files->absolutePath($path), ['Content-Type' => $type, 'X-Content-Type-Options' => 'nosniff']);
        $response->setContentDisposition('inline', 'receipt-'.$transaction->id.'.'.$extension);
        $response->setPrivate();
        $response->headers->addCacheControlDirective('no-store');

        return $response;
    }

    public function destroy(Request $request, TransactionReceiptFiles $files, $id)
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

        $keptFile = null;
        $response = DB::transaction(function () use ($transaction, $request, &$keptFile) {
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
            $keptFile = $transaction->receipt_file_url;

            return response()->json(['message' => 'Transaction deleted successfully.']);
        });

        // The private copy goes only once the delete has committed, and only when it is this organization's own and no other entry points to it.
        if ($keptFile !== null && $response->getStatusCode() === 200 && $files->isOurs($keptFile)
            && str_starts_with($keptFile, 'finance-receipts/'.$transaction->organization_id.'/')
            && ! Transaction::where('receipt_file_url', $keptFile)->exists()) {
            $files->discard($keptFile);
        }

        return $response;
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
        $report = FinancialReport::lockingReports([$transaction])[$transaction->id] ?? null;

        return match ($report['status'] ?? null) {
            null => null,
            'approved' => "This entry is part of the financial report '{$report['title']}' that has been approved. An approved report is final, so this entry can no longer be changed.",
            default => "This entry is part of the financial report '{$report['title']}' that has been submitted. Ask the Department Head to return the report before changing it.",
        };
    }

    /**
     * Tells the client which entries it must not offer to change: the system-generated
     * ones and the ones inside a submitted report. One report query covers the whole page.
     *
     * @param  iterable<Transaction>  $transactions
     */
    private function exposeLedgerFlags(iterable $transactions): void
    {
        $locking = FinancialReport::lockingReports($transactions);

        foreach ($transactions as $transaction) {
            $transaction->exposeSystemSource()
                ->setAttribute('is_locked_by_report', isset($locking[$transaction->id]))
                ->setAttribute('locking_report_title', $locking[$transaction->id]['title'] ?? null)
                ->setAttribute('locking_report_status', $locking[$transaction->id]['status'] ?? null);
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

    private function messages(): array
    {
        return [
            'receipt_reference.unique' => 'This receipt reference is already used. Enter a different one.',
            'receipt_number.unique' => 'This receipt number is already used for this event. Enter a different one.',
        ];
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
