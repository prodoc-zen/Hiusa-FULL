<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\Budget;
use App\Models\CashAdvance;
use App\Models\CashAdvanceRepayment;
use App\Models\Collection;
use App\Models\Event;
use App\Models\Invoice;
use App\Models\InvoicePayment;
use App\Models\Order;
use App\Models\Remittance;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class FinancialAccountabilityController extends Controller
{
    public function dashboard(Request $request)
    {
        $organizationId = $request->user()->organization_id;
        $collections = Collection::where('organization_id', $organizationId)->where('status', 'verified');
        $collected = (float) (clone $collections)->sum('amount_collected');
        $remitted = (float) Remittance::whereIn('collection_id', (clone $collections)->select('id'))->where('status', 'recorded')->sum('amount');
        $advances = CashAdvance::where('organization_id', $organizationId)->whereIn('status', ['released', 'partially_repaid', 'fully_repaid']);
        $borrowed = (float) (clone $advances)->sum('amount');
        $repaid = (float) CashAdvanceRepayment::whereIn('cash_advance_id', (clone $advances)->select('id'))->sum('amount');
        $income = (float) Transaction::where('organization_id', $organizationId)->where('type', 'income')->sum('amount');
        $expense = (float) Transaction::where('organization_id', $organizationId)->where('type', 'expense')->sum('amount');

        return response()->json(['total_collections' => $collected, 'total_remitted' => $remitted, 'unremitted_collections' => round($collected - $remitted, 2), 'total_borrowed' => $borrowed, 'total_repaid' => $repaid, 'outstanding_borrowed' => round($borrowed - $repaid, 2), 'total_expenses' => $expense, 'available_funds' => round($income - $expense, 2), 'pending_financial_approvals' => Collection::where('organization_id', $organizationId)->where('status', 'pending')->count() + CashAdvance::where('organization_id', $organizationId)->where('status', 'pending')->count(), 'recent_transactions' => Transaction::where('organization_id', $organizationId)->latest('transaction_date')->limit(10)->get()]);
    }

    public function collections(Request $request)
    {
        $query = Collection::with(['remittances'])->where('organization_id', $request->user()->organization_id)->latest('collected_at');
        if ($request->filled('search')) {
            $query->where(fn ($q) => $q->where('reference', 'like', '%'.$request->search.'%')->orWhere('source', 'like', '%'.$request->search.'%'));
        }

        return response()->json($query->get()->map(fn (Collection $collection) => $this->collectionData($collection)));
    }

    public function storeCollection(Request $request)
    {
        $data = $request->validate(['expected_amount' => ['nullable', 'decimal:0,2', 'min:0'], 'amount_collected' => ['required', 'decimal:0,2', 'gt:0'], 'source' => ['required', 'string', 'max:100'], 'event_id' => ['nullable', 'integer'], 'order_id' => ['nullable', 'integer'], 'notes' => ['nullable', 'string', 'max:2000'], 'collected_at' => ['nullable', 'date']]);
        if ($message = $this->validateLinks($request, $data)) {
            return response()->json(['message' => $message], 422);
        }

        return DB::transaction(function () use ($request, $data) {
            $row = Collection::create([...$data, 'organization_id' => $request->user()->organization_id, 'reference' => 'COL-'.strtoupper(Str::random(10)), 'collected_by' => $request->user()->school_id, 'collected_at' => $data['collected_at'] ?? now()]);
            $this->audit($request, 'collections', 'recorded', $row);

            return response()->json($this->collectionData($row), 201);
        });
    }

    public function verifyCollection(Request $request, Collection $collection)
    {
        $this->sameOrganization($request, $collection->organization_id);

        return DB::transaction(function () use ($request, $collection) {
            $locked = Collection::where('organization_id', $request->user()->organization_id)->lockForUpdate()->findOrFail($collection->id);
            if ($locked->status !== 'pending') {
                return response()->json(['message' => 'Only pending collections can be verified.'], 409);
            } if ($locked->collected_by === $request->user()->school_id) {
                return response()->json(['message' => 'You cannot verify your own collection.'], 403);
            } $transaction = $this->ledger($request, 'income', $locked->amount_collected, 'Collection', 'Collection '.$locked->reference, null, $locked->id);
            $locked->update(['status' => 'verified', 'verified_by' => $request->user()->school_id, 'verified_at' => now(), 'ledger_transaction_id' => $transaction->id]);
            $this->audit($request, 'collections', 'verified', $locked);

            return response()->json($this->collectionData($locked->fresh()));
        });
    }

    public function storeRemittance(Request $request, Collection $collection)
    {
        $this->sameOrganization($request, $collection->organization_id);
        $data = $request->validate(['amount' => ['required', 'decimal:0,2', 'gt:0'], 'notes' => ['nullable', 'string', 'max:2000'], 'remitted_at' => ['nullable', 'date']]);
        if ($collection->status !== 'verified') {
            return response()->json(['message' => 'Only verified collections can be remitted.'], 422);
        }

        return DB::transaction(function () use ($request, $collection, $data) {
            $locked = Collection::lockForUpdate()->findOrFail($collection->id);
            $already = (float) Remittance::where('collection_id', $locked->id)->where('status', 'recorded')->sum('amount');
            if ((float) $data['amount'] > (float) $locked->amount_collected - $already + 0.00001) {
                return response()->json(['message' => 'Remittance cannot exceed the unremitted collection balance.'], 422);
            } $row = Remittance::create([...$data, 'collection_id' => $locked->id, 'reference' => 'REM-'.strtoupper(Str::random(10)), 'remitted_by' => $request->user()->school_id, 'remitted_at' => $data['remitted_at'] ?? now(), 'status' => 'recorded']);
            $this->audit($request, 'remittances', 'recorded', $row);

            return response()->json($row, 201);
        });
    }

    public function advances(Request $request)
    {
        return response()->json(CashAdvance::with('repayments')->where('organization_id', $request->user()->organization_id)->latest()->get()->map(fn ($a) => $this->advanceData($a)));
    }

    public function storeAdvance(Request $request)
    {
        $data = $request->validate(['amount' => ['required', 'decimal:0,2', 'gt:0'], 'purpose' => ['required', 'string', 'max:2000'], 'event_id' => ['nullable', 'integer'], 'notes' => ['nullable', 'string', 'max:2000']]);
        if ($message = $this->validateLinks($request, $data)) {
            return response()->json(['message' => $message], 422);
        }

        return DB::transaction(function () use ($request, $data) {
            $row = CashAdvance::create([...$data, 'organization_id' => $request->user()->organization_id, 'reference' => 'ADV-'.strtoupper(Str::random(10)), 'borrower_id' => $request->user()->school_id]);
            $this->audit($request, 'cash_advances', 'requested', $row);

            return response()->json($this->advanceData($row), 201);
        });
    }

    public function approveAdvance(Request $request, CashAdvance $advance)
    {
        $this->sameOrganization($request, $advance->organization_id);
        if ($advance->borrower_id === $request->user()->school_id) {
            return response()->json(['message' => 'You cannot approve your own cash advance.'], 403);
        } if ($advance->status !== 'pending') {
            return response()->json(['message' => 'Only pending cash advances can be approved.'], 409);
        } $advance->update(['status' => 'approved', 'approved_by' => $request->user()->school_id, 'approved_at' => now()]);
        $this->audit($request, 'cash_advances', 'approved', $advance);

        return response()->json($this->advanceData($advance->fresh()));
    }

    public function releaseAdvance(Request $request, CashAdvance $advance)
    {
        $this->sameOrganization($request, $advance->organization_id);

        return DB::transaction(function () use ($request, $advance) {
            $locked = CashAdvance::where('organization_id', $request->user()->organization_id)->lockForUpdate()->findOrFail($advance->id);
            if ($locked->status !== 'approved') {
                return response()->json(['message' => 'Only approved cash advances can be released.'], 409);
            }$tx = $this->ledger($request, 'expense', $locked->amount, 'Cash Advance', 'Cash advance '.$locked->reference, $locked->borrower_id, $locked->id);
            $locked->update(['status' => 'released', 'released_by' => $request->user()->school_id, 'released_at' => now(), 'release_transaction_id' => $tx->id]);
            $this->audit($request, 'cash_advances', 'released', $locked);

            return response()->json($this->advanceData($locked->fresh()));
        });
    }

    public function repayAdvance(Request $request, CashAdvance $advance)
    {
        $this->sameOrganization($request, $advance->organization_id);
        $data = $request->validate(['amount' => ['required', 'decimal:0,2', 'gt:0'], 'notes' => ['nullable', 'string', 'max:2000']]);
        if (! in_array($advance->status, ['released', 'partially_repaid'], true)) {
            return response()->json(['message' => 'This cash advance is not repayable.'], 422);
        }

        return DB::transaction(function () use ($request, $advance, $data) {
            $locked = CashAdvance::lockForUpdate()->findOrFail($advance->id);
            $repaid = (float) CashAdvanceRepayment::where('cash_advance_id', $locked->id)->sum('amount');
            if ((float) $data['amount'] > (float) $locked->amount - $repaid + 0.00001) {
                return response()->json(['message' => 'Repayment cannot exceed the outstanding balance.'], 422);
            }$tx = $this->ledger($request, 'income', $data['amount'], 'Cash Advance Repayment', 'Repayment for '.$locked->reference, $locked->borrower_id, $locked->id);
            CashAdvanceRepayment::create([...$data, 'cash_advance_id' => $locked->id, 'recorded_by' => $request->user()->school_id, 'repaid_at' => now(), 'ledger_transaction_id' => $tx->id]);
            $remaining = (float) $locked->amount - $repaid - (float) $data['amount'];
            $locked->update(['status' => $remaining < 0.005 ? 'fully_repaid' : 'partially_repaid']);
            $this->audit($request, 'cash_advances', 'repaid', $locked);

            return response()->json($this->advanceData($locked->fresh()));
        });
    }

    public function invoices(Request $request)
    {
        $query = Invoice::with('payments')->where('organization_id', $request->user()->organization_id);
        if ($request->user()->role !== 'ADMIN') {
            $query->where('student_id', $request->user()->school_id);
        }

        return response()->json($query->latest()->get()->map(fn ($i) => $this->invoiceData($i)));
    }

    public function studentDebts(Request $request)
    {
        $filters = $request->validate([
            'student_id' => ['nullable', 'integer'], 'search' => ['nullable', 'string', 'max:100'],
            'department' => ['nullable', 'string', 'max:150'], 'program' => ['nullable', 'string', 'max:150'],
            'year_level' => ['nullable', 'string', 'max:50'], 'status' => ['nullable', 'in:all,owing,cleared,overdue,pending_payment'],
            'sort' => ['nullable', 'in:highest_debt,name,recent'], 'page' => ['nullable', 'integer', 'min:1'],
            'per_page' => ['nullable', 'integer', 'in:10'],
        ]);
        $organizationId = $request->user()->organization_id;
        $students = User::where('organization_id', $organizationId)->where('role', 'STUDENT')
            ->when($request->user()->role === 'STUDENT', fn ($query) => $query->where('school_id', $request->user()->school_id))
            ->when(! empty($filters['student_id']), fn ($query) => $query->where('school_id', $filters['student_id']))
            ->get(['school_id', 'first_name', 'last_name', 'email', 'account_status', 'department', 'program', 'major', 'section', 'year_level', 'created_at']);
        $accounts = $this->studentAccountRows($students, $organizationId);

        if (! empty($filters['student_id'])) {
            return response()->json($accounts->values());
        }

        $summary = [
            'total_students' => $accounts->count(), 'students_owing' => $accounts->where('total_debt', '>', 0)->count(),
            'students_cleared' => $accounts->where('total_debt', '<=', 0)->count(), 'students_overdue' => $accounts->where('overdue_invoice_count', '>', 0)->count(),
            'total_outstanding' => round((float) $accounts->sum('total_debt'), 2), 'invoice_outstanding' => round((float) $accounts->sum('invoice_debt'), 2),
            'merchandise_outstanding' => round((float) $accounts->sum('reserved_order_debt'), 2),
        ];
        $filterOptions = [
            'departments' => $accounts->pluck('student.department')->filter()->unique()->sort()->values(),
            'programs' => $accounts->pluck('student.program')->filter()->unique()->sort()->values(),
            'year_levels' => $accounts->pluck('student.year_level')->filter()->unique()->sort()->values(),
        ];
        if (! empty($filters['search'])) {
            $search = mb_strtolower(trim($filters['search']));
            $accounts = $accounts->filter(function (array $account) use ($search) {
                $student = $account['student'];

                return str_contains(mb_strtolower(implode(' ', array_filter([$student['school_id'], $student['name'], $student['email'], $student['department'], $student['program'], $student['year_level']]))), $search);
            });
        }
        foreach (['department', 'program', 'year_level'] as $field) {
            if (! empty($filters[$field])) {
                $accounts = $accounts->where('student.'.$field, $filters[$field]);
            }
        }
        $accounts = match ($filters['status'] ?? 'all') {
            'owing' => $accounts->where('total_debt', '>', 0), 'cleared' => $accounts->where('total_debt', '<=', 0),
            'overdue' => $accounts->where('overdue_invoice_count', '>', 0), 'pending_payment' => $accounts->where('pending_payment_count', '>', 0), default => $accounts,
        };
        $accounts = match ($filters['sort'] ?? 'highest_debt') {
            'name' => $accounts->sortBy('student.name', SORT_NATURAL | SORT_FLAG_CASE), 'recent' => $accounts->sortByDesc('last_activity_at'), default => $accounts->sortByDesc('total_debt'),
        };
        $page = (int) ($filters['page'] ?? 1);
        $perPage = 10;
        $accounts = $accounts->values();
        $paginator = new LengthAwarePaginator($accounts->forPage($page, $perPage)->values(), $accounts->count(), $perPage, $page, ['path' => $request->url(), 'query' => $request->query()]);
        $payload = $paginator->toArray();
        $payload['summary'] = $summary;
        $payload['filter_options'] = $filterOptions;

        return response()->json($payload);
    }

    public function storeInvoice(Request $request)
    {
        $data = $request->validate(['student_id' => ['required', 'integer'], 'description' => ['required', 'string', 'max:255'], 'amount_due' => ['required', 'decimal:0,2', 'gt:0'], 'due_date' => ['nullable', 'date'], 'event_id' => ['nullable', 'integer'], 'order_id' => ['nullable', 'integer']]);
        $organizationId = $request->user()->organization_id;
        $student = User::where('organization_id', $organizationId)->where('school_id', $data['student_id'])->where('role', 'STUDENT')->first();
        if (! $student) {
            return response()->json(['message' => 'The student must belong to your organization.'], 422);
        }
        if ($message = $this->validateLinks($request, $data)) {
            return response()->json(['message' => $message], 422);
        }
        if (! empty($data['order_id'])) {
            $order = Order::where('organization_id', $organizationId)->find($data['order_id']);
            if (! $order || (int) $order->student_id !== (int) $data['student_id']) {
                return response()->json(['message' => 'The selected order must belong to this student.'], 422);
            }
            if (Invoice::where('order_id', $order->id)->exists()) {
                return response()->json(['message' => 'This order already has a student charge.'], 422);
            }
        }
        try {
            $row = Invoice::create([...$data, 'organization_id' => $organizationId, 'reference' => 'INV-'.strtoupper(Str::random(10))]);
        } catch (QueryException $exception) {
            if (! empty($data['order_id']) && str_contains(strtolower($exception->getMessage()), 'unique')) {
                return response()->json(['message' => 'This order already has a student charge.'], 422);
            } throw $exception;
        }
        $this->audit($request, 'invoices', 'created', $row);

        return response()->json($this->invoiceData($row), 201);
    }

    public function recordInvoicePayment(Request $request, Invoice $invoice)
    {
        $this->sameOrganization($request, $invoice->organization_id);
        $data = $request->validate(['amount' => ['required', 'decimal:0,2', 'gt:0']]);

        return DB::transaction(function () use ($request, $invoice, $data) {
            $locked = Invoice::where('organization_id', $request->user()->organization_id)->lockForUpdate()->findOrFail($invoice->id);
            $paid = (float) InvoicePayment::where('invoice_id', $locked->id)->where('status', 'approved')->sum('amount');
            if ((float) $data['amount'] > (float) $locked->amount_due - $paid + 0.00001) {
                return response()->json(['message' => 'Payment cannot exceed the invoice balance.'], 422);
            }$tx = $this->ledger($request, 'income', $data['amount'], 'Student Payment', 'Payment for '.$locked->reference, $locked->student_id, $locked->id);
            InvoicePayment::create(['invoice_id' => $locked->id, 'amount' => $data['amount'], 'recorded_by' => $request->user()->school_id, 'status' => 'approved', 'ledger_transaction_id' => $tx->id]);
            $remaining = (float) $locked->amount_due - $paid - (float) $data['amount'];
            $locked->update(['status' => $remaining < 0.005 ? 'paid' : ($remaining < (float) $locked->amount_due ? 'partially_paid' : 'unpaid')]);
            $this->audit($request, 'invoices', 'payment_approved', $locked);

            return response()->json($this->invoiceData($locked->fresh()));
        });
    }

    public function auditLogs(Request $request)
    {
        $organizationId = $request->user()->organization_id;
        $filters = $request->validate(['user_id' => ['nullable', 'integer'], 'role' => ['nullable', 'string', 'max:30'], 'department' => ['nullable', 'string', 'max:120'], 'program' => ['nullable', 'string', 'max:120'], 'year_level' => ['nullable', 'string', 'max:30'], 'section' => ['nullable', 'string', 'max:60'], 'position_title' => ['nullable', 'string', 'max:100'], 'module' => ['nullable', 'string', 'max:50'], 'action' => ['nullable', 'string', 'max:100'], 'category' => ['nullable', 'string', 'max:30'], 'search' => ['nullable', 'string', 'max:150'], 'from' => ['nullable', 'date'], 'to' => ['nullable', 'date', 'after_or_equal:from'], 'sort' => ['nullable', 'in:newest,oldest,user,role,module,action,category'], 'per_page' => ['nullable', 'integer', 'in:10']]);
        $query = AuditLog::with('user:school_id,first_name,last_name,email,role,position_title,department,program,major,year_level,section,account_status,created_at')->where('organization_id', $organizationId);
        foreach (['user_id', 'module', 'action'] as $field) {
            if (! empty($filters[$field])) {
                $query->where($field, $filters[$field]);
            }
        }
        foreach (['role', 'department', 'program', 'year_level', 'section', 'position_title'] as $userField) {
            if (! empty($filters[$userField])) {
                $query->whereHas('user', fn ($q) => $q->where($userField, $filters[$userField]));
            }
        }
        if (! empty($filters['from'])) {
            $query->whereDate('created_at', '>=', $filters['from']);
        } if (! empty($filters['to'])) {
            $query->whereDate('created_at', '<=', $filters['to']);
        }
        if (! empty($filters['search'])) {
            $search = $filters['search'];
            $query->where(fn ($q) => $q->where('module', 'like', "%$search%")->orWhere('action', 'like', "%$search%")->orWhere('record_id', 'like', "%$search%")->orWhereHas('user', fn ($u) => $u->where('first_name', 'like', "%$search%")->orWhere('last_name', 'like', "%$search%")->orWhere('school_id', 'like', "%$search%")));
        }
        if (! empty($filters['category'])) {
            $query->whereIn('action', $this->actionsForCategory($filters['category']));
        }
        match ($filters['sort'] ?? 'newest') {
            'oldest' => $query->oldest('created_at'), 'user' => $query->orderBy(User::select('last_name')->whereColumn('users.school_id', 'audit_logs.user_id'))->orderBy(User::select('first_name')->whereColumn('users.school_id', 'audit_logs.user_id')), 'role' => $query->orderBy(User::select('role')->whereColumn('users.school_id', 'audit_logs.user_id')), 'module' => $query->orderBy('module')->orderByDesc('created_at'), 'action','category' => $query->orderBy('action')->orderByDesc('created_at'), default => $query->latest('created_at')
        };
        $logs = $query->paginate(10);
        $logs->getCollection()->transform(fn (AuditLog $log) => $this->auditLogData($log, $organizationId));

        return response()->json($logs);
    }

    private function ledger(Request $request, string $type, $amount, string $category, string $description, ?int $payerId, int $entityId): Transaction
    {
        return Transaction::create(['organization_id' => $request->user()->organization_id, 'recorded_by' => $request->user()->school_id, 'payer_id' => $payerId, 'type' => $type, 'amount' => $amount, 'category' => $category, 'description' => $description, 'receipt_reference' => 'FIN-'.strtoupper(Str::random(12)), 'transaction_date' => now()]);
    }

    private function audit(Request $r, string $module, string $action, $model): void
    {
        AuditLog::create(['organization_id' => $r->user()->organization_id, 'user_id' => $r->user()->school_id, 'module' => $module, 'action' => $action, 'record_type' => $model::class, 'record_id' => $model->id, 'new_values' => $model->getAttributes(), 'ip_address' => $r->ip(), 'created_at' => now()]);
    }

    private function sameOrganization(Request $r, int $organizationId): void
    {
        abort_unless($r->user()->organization_id === $organizationId, 404);
    }

    private function validateLinks(Request $request, array $data): ?string
    {
        $organizationId = $request->user()->organization_id;
        if (! empty($data['event_id']) && ! Event::where('organization_id', $organizationId)->whereKey($data['event_id'])->exists()) {
            return 'The selected event does not belong to this organization.';
        } if (! empty($data['order_id']) && ! Order::where('organization_id', $organizationId)->whereKey($data['order_id'])->exists()) {
            return 'The selected order does not belong to this organization.';
        }

        return null;
    }

    private function auditLogData(AuditLog $log, int $organizationId): array
    {
        $recordType = $log->record_type;
        $subject = null;
        $affectedUser = null;
        if ($recordType === User::class) {
            $affectedUser = User::where('organization_id', $organizationId)->find($log->record_id);
            $subject = $affectedUser ? 'User account: '.$this->userLabel($affectedUser) : 'User account #'.$log->record_id;
        } elseif ($recordType === Transaction::class) {
            $record = Transaction::with('payer:school_id,first_name,last_name,department,program,year_level')->where('organization_id', $organizationId)->find($log->record_id);
            $affectedUser = $record?->payer;
            $subject = $record ? 'Ledger entry: '.$record->description : 'Ledger entry #'.$log->record_id;
        } elseif ($recordType === Order::class) {
            $record = Order::with(['student:school_id,first_name,last_name,department,program,year_level', 'merchandise:id,name'])->where('organization_id', $organizationId)->find($log->record_id);
            $affectedUser = $record?->student;
            $subject = $record ? 'Order ORD-'.$record->id.' — '.($record->merchandise?->name ?? 'Merchandise') : 'Order #'.$log->record_id;
        } elseif ($recordType === Invoice::class) {
            $record = Invoice::where('organization_id', $organizationId)->find($log->record_id);
            $affectedUser = $record ? User::where('organization_id', $organizationId)->find($record->student_id) : null;
            $subject = $record ? 'Invoice '.$record->reference.' — '.$record->description : 'Invoice #'.$log->record_id;
        } elseif ($recordType === CashAdvance::class) {
            $record = CashAdvance::where('organization_id', $organizationId)->find($log->record_id);
            $affectedUser = $record ? User::where('organization_id', $organizationId)->find($record->borrower_id) : null;
            $subject = $record ? 'Cash advance '.$record->reference : 'Cash advance #'.$log->record_id;
        } elseif ($recordType === Collection::class) {
            $record = Collection::where('organization_id', $organizationId)->find($log->record_id);
            $affectedUser = $record ? User::where('organization_id', $organizationId)->find($record->collected_by) : null;
            $subject = $record ? 'Collection '.$record->reference.' — '.$record->source : 'Collection #'.$log->record_id;
        } elseif ($recordType === Budget::class) {
            $record = Budget::where('organization_id', $organizationId)->find($log->record_id);
            $subject = $record ? 'Budget: '.$record->title : 'Budget #'.$log->record_id;
        }
        $values = is_array($log->new_values) ? $log->new_values : (is_array($log->old_values) ? $log->old_values : []);
        if (! $subject && ! empty($values['entity_type'])) {
            $subject = Str::headline($values['entity_type']).' #'.($values['entity_id'] ?? $log->record_id);
        }
        $actionLabel = Str::headline(str_replace(['_', '.'], ' ', $log->action));
        $moduleLabel = Str::headline(str_replace('_', ' ', $log->module));
        $actor = $log->user ? $this->profileData($log->user) : ['name' => 'System'];
        $subject = $subject ?? Str::headline(class_basename((string) $recordType)).' #'.$log->record_id;

        return [...$log->toArray(), 'action_label' => $actionLabel, 'action_category' => $this->actionCategory($log->action), 'module_label' => $moduleLabel, 'actor' => $actor, 'subject' => $subject, 'description' => $actor['name'].' '.$this->descriptionVerb($log->action).' '.$subject.'.', 'affected_user' => $affectedUser ? $this->profileData($affectedUser) : null, 'changes' => $this->auditChanges($log)];
    }

    private function profileData(User $user): array
    {
        return ['school_id' => $user->school_id, 'name' => $this->userLabel($user), 'role' => $user->role, 'position_title' => $user->position_title, 'account_status' => $user->account_status, 'department' => $user->department, 'program' => $user->program, 'major' => $user->major, 'section' => $user->section, 'year_level' => $user->year_level, 'email' => $user->email, 'created_at' => $user->created_at];
    }

    private function userLabel(User $user): string
    {
        return trim($user->first_name.' '.$user->last_name).' ('.$user->school_id.')';
    }

    private function auditChanges(AuditLog $log): array
    {
        $old = is_array($log->old_values) ? $log->old_values : [];
        $new = is_array($log->new_values) ? $log->new_values : [];

        return collect($new)->reject(fn ($value, $key) => in_array($key, ['password', 'password_hash', 'biometric_template', 'updated_at', 'created_at'], true))->map(fn ($value, $key) => ['field' => Str::headline(str_replace('_', ' ', $key)), 'from' => array_key_exists($key, $old) ? $this->displayValue($old[$key]) : null, 'to' => $this->displayValue($value)])->values()->all();
    }

    private function displayValue(mixed $value): string
    {
        if (is_array($value)) {
            return 'Updated details';
        } if (is_bool($value)) {
            return $value ? 'Yes' : 'No';
        }

        return $value === null || $value === '' ? 'Not set' : (string) $value;
    }

    private function actionCategory(string $action): string
    {
        $action = strtolower($action);
        if (str_contains($action, 'approve')) {
            return 'APPROVE';
        } if (str_contains($action, 'reject')) {
            return 'REJECT';
        } if (str_contains($action, 'delete')) {
            return 'DELETE';
        } if (str_contains($action, 'payment')) {
            return 'PAYMENT';
        } if (str_contains($action, 'collection')) {
            return 'COLLECTION';
        } if (str_contains($action, 'remit')) {
            return 'REMITTANCE';
        } if (str_contains($action, 'attendance')) {
            return 'ATTENDANCE';
        } if (str_contains($action, 'created') || str_contains($action, 'create')) {
            return 'CREATE';
        } if (str_contains($action, 'updated') || str_contains($action, 'update')) {
            return 'UPDATE';
        }

        return 'STATUS_CHANGE';
    }

    private function actionsForCategory(string $category): array
    {
        return match ($category) {
            'CREATE' => ['created', 'submitted'], 'UPDATE' => ['updated'], 'DELETE' => ['deleted'], 'APPROVE' => ['approved', 'reviewed_approved', 'payment_approved'], 'REJECT' => ['rejected', 'reviewed_rejected', 'payment_rejected'], 'PAYMENT' => ['payment_submitted', 'payment_approved', 'payment_rejected'], 'COLLECTION' => ['recorded', 'verified'], 'REMITTANCE' => ['recorded'], default => []
        };
    }

    private function descriptionVerb(string $action): string
    {
        return strtolower(str_replace('_', ' ', $action));
    }

    private function collectionData(Collection $c): array
    {
        $remitted = (float) $c->remittances()->where('status', 'recorded')->sum('amount');

        return [...$c->toArray(), 'total_remitted' => round($remitted, 2), 'unremitted_balance' => round((float) $c->amount_collected - $remitted, 2)];
    }

    private function advanceData(CashAdvance $a): array
    {
        $repaid = (float) $a->repayments()->sum('amount');

        return [...$a->toArray(), 'amount_repaid' => round($repaid, 2), 'remaining_balance' => round((float) $a->amount - $repaid, 2)];
    }

    private function invoiceData(Invoice $i): array
    {
        $paid = (float) $i->payments()->where('status', 'approved')->sum('amount');

        return [...$i->toArray(), 'amount_paid' => round($paid, 2), 'remaining_balance' => round((float) $i->amount_due - $paid, 2), 'clearance_status' => ((float) $i->amount_due - $paid) < 0.005 ? 'financially_cleared' : 'pending_clearance'];
    }

    private function studentAccountRows($students, int $organizationId)
    {
        $studentIds = $students->pluck('school_id');
        $invoices = Invoice::with('payments')->where('organization_id', $organizationId)->whereIn('student_id', $studentIds)
            ->whereNotIn('status', ['paid', 'cancelled', 'waived'])->get()->groupBy('student_id');
        $orders = Order::with('merchandise:id,name,image_url')->where('organization_id', $organizationId)->whereIn('student_id', $studentIds)
            ->where('status', 'pending')->whereDoesntHave('transaction')->get()->groupBy('student_id');

        return $students->map(function (User $student) use ($invoices, $orders) {
            $studentInvoices = $invoices->get($student->school_id, collect())->map(fn (Invoice $invoice) => $this->invoiceData($invoice))->values();
            $studentOrders = $orders->get($student->school_id, collect())->values();
            $invoiceDebt = (float) $studentInvoices->sum('remaining_balance');
            $orderDebt = (float) $studentOrders->sum('total_price');
            $overdueCount = $studentInvoices->filter(fn (array $invoice) => ! empty($invoice['due_date']) && $invoice['remaining_balance'] > 0 && now()->startOfDay()->gt($invoice['due_date']))->count();
            $pendingPayments = $studentOrders->whereNotNull('payment_proof_url')->count() + $studentInvoices->where('status', 'partially_paid')->count();
            $activityDates = $studentInvoices->pluck('updated_at')->merge($studentOrders->pluck('updated_at'))->filter();

            return [
                'student' => ['school_id' => $student->school_id, 'name' => trim($student->first_name.' '.$student->last_name), 'email' => $student->email, 'account_status' => $student->account_status, 'department' => $student->department, 'program' => $student->program, 'major' => $student->major, 'section' => $student->section, 'year_level' => $student->year_level],
                'invoice_debt' => round($invoiceDebt, 2), 'reserved_order_debt' => round($orderDebt, 2), 'total_debt' => round($invoiceDebt + $orderDebt, 2),
                'clearance_status' => ($invoiceDebt + $orderDebt) < 0.005 ? 'financially_cleared' : 'pending_clearance', 'unpaid_invoice_count' => $studentInvoices->count(),
                'pending_order_count' => $studentOrders->count(), 'pending_payment_count' => $pendingPayments, 'overdue_invoice_count' => $overdueCount,
                'last_activity_at' => $activityDates->sortDesc()->first(), 'invoices' => $studentInvoices, 'reserved_orders' => $studentOrders,
            ];
        });
    }
}
