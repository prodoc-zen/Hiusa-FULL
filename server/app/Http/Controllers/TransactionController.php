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
use App\Support\SemesterScope;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class TransactionController extends Controller
{
    private const RECEIPT_REQUIRED_MESSAGE = 'Attach the official receipt for this expense.';

    private const RECEIPT_FILE_MESSAGE = 'Attach the official receipt as a JPG, PNG, WEBP or PDF up to 5 MB.';

    private const ARCHIVED_MESSAGE = 'This transaction is archived.';

    /** The audit actions the history shows, and the kind each is shown as; a budget unlinked by the system reads as an edit. */
    private const HISTORY_ACTIONS = ['created' => 'created', 'updated' => 'updated', 'budget_unlinked' => 'updated', 'archived' => 'archived'];

    /** The fields an edit can change, in the words the history shows them in. */
    private const FIELD_LABELS = [
        'amount' => 'Amount',
        'type' => 'Type',
        'category' => 'Category',
        'transaction_date' => 'Date',
        'description' => 'Description',
        'budget_id' => 'Linked budget (title)',
        'event_id' => 'Linked event (title)',
        'payer_id' => 'Payer (school ID)',
        'receipt_reference' => 'Receipt reference',
        'receipt_number' => 'Receipt number',
        'receipt_file' => 'Official receipt file',
    ];

    public function index(Request $request, TransactionReceiptFiles $files)
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
            'archived' => ['nullable', 'boolean'],
            'search' => ['nullable', 'string', 'max:150'],
            'event_search' => ['nullable', 'string', 'max:150'],
        ]);

        // The archived list is read only and reaches the archived rows through the one place that lifts the scope.
        $base = $request->boolean('archived')
            ? Transaction::withoutGlobalScope(Transaction::NOT_ARCHIVED)->whereNotNull('archived_at')
            : Transaction::query();
        $query = $base->with([
            'budget:id,title',
            'event:id,title',
            'recorder:school_id,first_name,last_name',
            'payer:school_id,first_name,last_name,department,program,year_level',
            'organization:id,name,acronym',
            'archiver:school_id,first_name,last_name',
            'lastEditor:school_id,first_name,last_name',
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
        $this->exposeLedgerFlags($page->getCollection(), $files);

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

        $query = Transaction::whereIn('organization_id', $this->readableOrganizationIds($request));

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

    public function store(Request $request, TransactionReceiptFiles $files)
    {
        $data = $request->validate($this->rules($request), $this->messages());
        $organizationId = $request->user()->organization_id;
        $upload = $request->file('receipt_file');
        unset($data['receipt_file']);

        // A kept path is accepted only when it is a file this organization's receipt folder holds, so a typed string cannot stand in for the receipt.
        if (isset($data['receipt_file_url']) && ! $files->isKeptFor($data['receipt_file_url'], $organizationId)) {
            unset($data['receipt_file_url']);
        }

        if ($upload === null && empty($data['receipt_file_url']) && $data['type'] === 'expense') {
            throw ValidationException::withMessages(['receipt_file' => [self::RECEIPT_REQUIRED_MESSAGE]]);
        }

        if ($message = $this->validateAndNormalizeLinks($request, $data)) {
            return response()->json(['message' => $message], 422);
        }

        $stored = null;
        if ($upload !== null) {
            $stored = $files->storeUploaded($organizationId, $upload);
            if ($stored === null) {
                throw ValidationException::withMessages(['receipt_file' => ['The receipt file could not be saved. Try again.']]);
            }
            $data['receipt_file_url'] = $stored;
        }

        try {
            return $this->createEntry($request, $data, $files);
        } catch (\Throwable $exception) {
            if ($stored !== null) {
                $files->discard($stored);
            }

            throw $exception;
        }
    }

    private function createEntry(Request $request, array $data, TransactionReceiptFiles $files)
    {
        return DB::transaction(function () use ($data, $request, $files) {
            if (empty($data['receipt_number'])) {
                // Archived entries keep their number, so the next one must clear them too.
                $data['receipt_number'] = ((int) Transaction::withoutGlobalScope(Transaction::NOT_ARCHIVED)->where('organization_id', $request->user()->organization_id)
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
            $this->exposeLedgerFlags([$transaction], $files);

            return response()->json($transaction, 201);
        });
    }

    public function update(Request $request, TransactionReceiptFiles $files, $id)
    {
        $transaction = Transaction::withoutGlobalScope(Transaction::NOT_ARCHIVED)->where('organization_id', $request->user()->organization_id)->find($id);

        if (! $transaction) {
            return response()->json(['message' => 'Transaction not found.'], 404);
        }

        if ($transaction->archived_at !== null) {
            return response()->json(['message' => self::ARCHIVED_MESSAGE], 409);
        }

        if ($message = $this->systemSourceMessage($transaction)) {
            return response()->json(['message' => $message], 409);
        }

        if ($transaction->recorded_by !== $request->user()->id && $request->user()->role !== 'ADMIN') {
            return response()->json(['message' => 'You can only change transactions you recorded.'], 403);
        }

        $data = $request->validate([...$this->rules($request, true, $transaction), 'edit_reason' => ['required', 'string', 'min:5', 'max:500']], $this->messages());
        $reason = trim($data['edit_reason']);
        $upload = $request->file('receipt_file');
        // The file changes only through an upload; a typed path is never taken.
        unset($data['edit_reason'], $data['receipt_file'], $data['receipt_file_url']);

        if ($message = $this->validateAndNormalizeLinks($request, $data, $transaction)) {
            return response()->json(['message' => $message], 422);
        }

        $newPath = null;
        $oldPath = null;
        $saved = false;

        try {
            $response = DB::transaction(function () use ($transaction, $data, $request, $files, $upload, $reason, &$newPath, &$oldPath, &$saved) {
                $transaction = Transaction::withoutGlobalScope(Transaction::NOT_ARCHIVED)->where('organization_id', $transaction->organization_id)->lockForUpdate()->find($transaction->id);

                if (! $transaction) {
                    return response()->json(['message' => 'Transaction not found.'], 404);
                }

                if ($transaction->archived_at !== null) {
                    return response()->json(['message' => self::ARCHIVED_MESSAGE], 409);
                }

                if ($message = $this->reportLockMessage($transaction)) {
                    return response()->json(['message' => $message], 409);
                }

                // The date picker sends a day, not a time, so the same day is not a change and keeps the time it was recorded with.
                if (isset($data['transaction_date']) && Carbon::parse($data['transaction_date'], config('app.timezone'))->setTimezone(config('app.timezone'))->toDateString() === $transaction->transaction_date->copy()->setTimezone(config('app.timezone'))->toDateString()) {
                    unset($data['transaction_date']);
                }

                if ($upload !== null) {
                    $newPath = $files->storeUploaded($transaction->organization_id, $upload);

                    if ($newPath === null) {
                        throw ValidationException::withMessages(['receipt_file' => ['The receipt file could not be saved. Try again.']]);
                    }

                    $data['receipt_file_url'] = $newPath;
                    $oldPath = $transaction->receipt_file_url;
                }

                $oldValues = $this->auditableValues($transaction);
                $changed = $this->changedFields($oldValues, $this->auditableValues((clone $transaction)->fill($data)));

                if ($changed === []) {
                    return response()->json(['message' => 'Nothing changed.'], 422);
                }

                // Only a change to the amount, the type or the budget moves the budget; the rest leaves it alone.
                $movesBudget = array_intersect(['amount', 'type', 'budget_id'], $changed) !== [];
                if ($movesBudget) {
                    $this->applyBudgetMovement($transaction, -1);
                }

                $transaction->fill($data);
                $transaction->last_edited_at = now();
                $transaction->last_edited_by = $request->user()->school_id;
                $transaction->edit_count = (int) $transaction->edit_count + 1;
                $transaction->save();

                if ($movesBudget) {
                    $this->applyBudgetMovement($transaction->fresh(), 1);
                }

                $this->recordFinancialAudit($request, 'updated', $transaction, $oldValues, [
                    ...$this->auditableValues($transaction->fresh()),
                    'changed_fields' => $changed,
                    'edit_reason' => $reason,
                ]);
                $saved = true;

                $updated = $transaction->fresh()->load([
                    'budget:id,title',
                    'event:id,title',
                    'recorder:school_id,first_name,last_name',
                    'payer:school_id,first_name,last_name',
                ])->loadSystemSource();
                $this->exposeLedgerFlags([$updated], $files);

                return response()->json($updated);
            });
        } finally {
            // A file that was stored for an edit that did not commit is not kept.
            if (! $saved && $newPath !== null) {
                $files->discard($newPath);
            }
        }

        // The replaced file goes only after the commit, and only when no entry, archived or not, still points at it.
        if ($saved && $oldPath !== null) {
            $files->discardIfUnreferenced($oldPath, $transaction->organization_id);
        }

        return $response;
    }

    /** The receipts for payments this person made: a student's from every organization they belong to, anyone else's from their own. */
    private function ownReceipts(Request $request)
    {
        $userId = $request->user()->id;
        $organizationIds = $request->user()->role === 'STUDENT' ? $request->user()->memberOrganizationIds() : [$request->user()->organization_id];

        // A payer keeps the receipt for what they paid even after the organization archives the entry.
        return Transaction::withoutGlobalScope(Transaction::NOT_ARCHIVED)->with([
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
        // An archived entry keeps its receipt file, so the file opens for it too.
        $transaction = Transaction::withoutGlobalScope(Transaction::NOT_ARCHIVED)->whereIn('organization_id', $this->readableOrganizationIds($request))->find($id);
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

    /** Takes an entry out of the books without deleting it: the reason, who and when are kept, the budget is given back, and the receipt file stays. */
    public function archive(Request $request, $id)
    {
        $data = $request->validate(['reason' => ['required', 'string', 'min:5', 'max:500']], [
            'reason.required' => 'Give the reason for archiving this transaction.',
            'reason.string' => 'Give the reason for archiving this transaction.',
            'reason.min' => 'Give the reason for archiving this transaction.',
            'reason.max' => 'Keep the reason for archiving to 500 characters.',
        ]);
        $reason = trim($data['reason']);

        $transaction = Transaction::withoutGlobalScope(Transaction::NOT_ARCHIVED)->where('organization_id', $request->user()->organization_id)->find($id);

        if (! $transaction) {
            return response()->json(['message' => 'Transaction not found.'], 404);
        }

        if ($transaction->archived_at !== null) {
            return response()->json(['message' => self::ARCHIVED_MESSAGE], 409);
        }

        if ($message = $this->systemSourceMessage($transaction)) {
            return response()->json(['message' => $message], 409);
        }

        if ($transaction->recorded_by !== $request->user()->id && $request->user()->role !== 'ADMIN') {
            return response()->json(['message' => 'You can only archive transactions you recorded.'], 403);
        }

        return DB::transaction(function () use ($transaction, $request, $reason) {
            $transaction = Transaction::withoutGlobalScope(Transaction::NOT_ARCHIVED)->where('organization_id', $transaction->organization_id)->lockForUpdate()->find($transaction->id);

            if (! $transaction) {
                return response()->json(['message' => 'Transaction not found.'], 404);
            }

            if ($transaction->archived_at !== null) {
                return response()->json(['message' => self::ARCHIVED_MESSAGE], 409);
            }

            if ($message = $this->reportLockMessage($transaction)) {
                return response()->json(['message' => $message], 409);
            }

            $oldValues = $this->auditableValues($transaction);
            $this->applyBudgetMovement($transaction, -1);
            $transaction->forceFill([
                'archived_at' => now(),
                'archived_by' => $request->user()->school_id,
                'archive_reason' => $reason,
            ])->save();
            $this->recordFinancialAudit($request, 'archived', $transaction, $oldValues, [
                'archived_at' => $transaction->archived_at->toIso8601String(),
                'archive_reason' => $reason,
            ]);

            return response()->json(['message' => 'Transaction archived.']);
        });
    }

    /** Who recorded, edited and archived an entry, newest first, read from the financial audit log. */
    public function history(Request $request, $id)
    {
        $transaction = Transaction::withoutGlobalScope(Transaction::NOT_ARCHIVED)->whereIn('organization_id', $this->readableOrganizationIds($request))->find($id);

        if (! $transaction) {
            return response()->json(['message' => 'Transaction not found.'], 404);
        }

        $logs = AuditLog::where('record_type', Transaction::class)
            ->where('record_id', $transaction->id)
            ->whereIn('action', array_keys(self::HISTORY_ACTIONS))
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->get();

        $names = User::whereIn('school_id', $logs->pluck('user_id')->filter()->unique())->get(['school_id', 'first_name', 'last_name'])
            ->mapWithKeys(fn (User $user) => [$user->school_id => trim($user->first_name.' '.$user->last_name)]);

        $values = $logs->flatMap(fn (AuditLog $log) => [(array) $log->old_values, (array) $log->new_values]);
        $budgetTitles = Budget::whereIn('id', $values->pluck('budget_id')->filter()->unique())->pluck('title', 'id');
        $eventTitles = Event::whereIn('id', $values->pluck('event_id')->filter()->unique())->pluck('title', 'id');

        return response()->json(['data' => $logs->map(function (AuditLog $log) use ($names, $budgetTitles, $eventTitles) {
            $action = self::HISTORY_ACTIONS[$log->action];
            $old = (array) $log->old_values;
            $new = (array) $log->new_values;

            return [
                'action' => $action,
                'at' => $log->created_at?->setTimezone(config('app.timezone'))->toIso8601String(),
                'by' => ['user_id' => $log->user_id, 'name' => $log->user_id === null ? 'System' : ($names[$log->user_id] ?? 'Unknown user')],
                'reason' => match ($log->action) {
                    'updated' => $new['edit_reason'] ?? null,
                    'archived' => $new['archive_reason'] ?? null,
                    'budget_unlinked' => $new['reason'] ?? $log->description ?? 'Budget not approved',
                    default => null,
                },
                'changes' => $action === 'updated' ? $this->historyChanges($old, $new, $budgetTitles, $eventTitles) : [],
            ];
        })->values()]);
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
     * It also names who edited or archived each entry and says whether a receipt file is kept, never giving out where it is stored.
     *
     * @param  iterable<Transaction>  $transactions
     */
    private function exposeLedgerFlags(iterable $transactions, TransactionReceiptFiles $files): void
    {
        $locking = FinancialReport::lockingReports($transactions);

        foreach ($transactions as $transaction) {
            $transaction->exposeSystemSource()
                ->setAttribute('is_locked_by_report', isset($locking[$transaction->id]))
                ->setAttribute('locking_report_title', $locking[$transaction->id]['title'] ?? null)
                ->setAttribute('locking_report_status', $locking[$transaction->id]['status'] ?? null);

            $path = $transaction->receipt_file_url;
            $kept = $files->isKeptFor($path, $transaction->organization_id);
            $transaction->setAttribute('has_receipt_file', $kept || (is_string($path) && $path !== '' && ! $files->isOurs($path)))
                ->setAttribute('receipt_file_open_url', $kept ? '/transactions/'.$transaction->id.'/receipt-file' : null)
                ->setAttribute('archived_by_name', $this->nameOf($transaction, 'archiver', 'archived_by'))
                ->setAttribute('last_edited_by_name', $this->nameOf($transaction, 'lastEditor', 'last_edited_by'))
                ->makeHidden(['archiver', 'lastEditor']);
        }
    }

    private function nameOf(Transaction $transaction, string $relation, string $column): ?string
    {
        if ($transaction->getAttribute($column) === null) {
            return null;
        }

        $user = $transaction->loadMissing($relation.':school_id,first_name,last_name')->getRelation($relation);

        return $user ? trim($user->first_name.' '.$user->last_name) : null;
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
            'receipt_file.file' => self::RECEIPT_FILE_MESSAGE,
            'receipt_file.uploaded' => self::RECEIPT_FILE_MESSAGE,
            'receipt_file.mimes' => self::RECEIPT_FILE_MESSAGE,
            'receipt_file.max' => self::RECEIPT_FILE_MESSAGE,
            'edit_reason.required' => 'Give the reason for this edit.',
            'edit_reason.string' => 'Give the reason for this edit.',
            'edit_reason.min' => 'Give the reason for this edit.',
            'edit_reason.max' => 'Keep the reason for this edit to 500 characters.',
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
            'receipt_file' => ['nullable', 'file', 'mimes:jpg,jpeg,png,webp,pdf', 'max:5120'],
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
        return [
            ...$transaction->only([
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
            ]),
            // A short fingerprint of the file, never its path, so the audit log can show that the file changed without saying where it is.
            'receipt_file' => $transaction->receipt_file_url ? substr(sha1($transaction->receipt_file_url), 0, 12) : null,
        ];
    }

    /** One value in a form two audit values can be compared in. */
    private function comparable(string $field, mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        return match ($field) {
            'amount' => number_format((float) $value, 2, '.', ''),
            'transaction_date' => Carbon::parse($value)->setTimezone(config('app.timezone'))->format('Y-m-d H:i:s'),
            default => (string) $value,
        };
    }

    /** @return list<string> the fields whose value differs between the two sets of audit values */
    private function changedFields(array $old, array $new): array
    {
        return collect(array_keys(self::FIELD_LABELS))
            ->filter(fn (string $field) => $this->comparable($field, $old[$field] ?? null) !== $this->comparable($field, $new[$field] ?? null))
            ->values()
            ->all();
    }

    /**
     * What an edit changed, field by field, in words. A field the edit's record does not carry (an older entry,
     * or the file before it was tracked) is not reported rather than guessed.
     *
     * @return list<array{field: string, label: string, from: ?string, to: ?string}>
     */
    private function historyChanges(array $old, array $new, $budgetTitles, $eventTitles): array
    {
        return collect(self::FIELD_LABELS)
            ->filter(fn (string $label, string $field) => array_key_exists($field, $new) && $this->comparable($field, $old[$field] ?? null) !== $this->comparable($field, $new[$field]))
            ->map(function (string $label, string $field) use ($old, $new, $budgetTitles, $eventTitles) {
                $from = $this->comparable($field, $old[$field] ?? null);
                $to = $this->comparable($field, $new[$field]);

                return [
                    'field' => $field,
                    'label' => $label,
                    'from' => $this->shownValue($field, $from, $to, $budgetTitles, $eventTitles, true),
                    'to' => $this->shownValue($field, $to, $from, $budgetTitles, $eventTitles, false),
                ];
            })
            ->values()
            ->all();
    }

    /** A stored value as a person reads it: a title for a link, a day for a date, a word for the file. */
    private function shownValue(string $field, ?string $value, ?string $other, $budgetTitles, $eventTitles, bool $isFrom): ?string
    {
        if ($field === 'receipt_file') {
            return $value === null ? 'None' : ($other === null ? 'File attached' : ($isFrom ? 'Previous file' : 'Replacement file'));
        }

        if ($value === null) {
            return null;
        }

        return match ($field) {
            'budget_id' => $budgetTitles[(int) $value] ?? 'Budget #'.$value,
            'event_id' => $eventTitles[(int) $value] ?? 'Event #'.$value,
            'type' => ucfirst($value),
            'transaction_date' => substr($value, 0, 10),
            default => $value,
        };
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
