<?php

namespace App\Http\Controllers;

use App\Models\AiOutput;
use App\Models\ApprovalRequest;
use App\Models\AuditLog;
use App\Models\Budget;
use App\Models\Collection;
use App\Models\Event;
use App\Models\FinancialForecast;
use App\Models\FinancialReport;
use App\Models\FinancialSemester;
use App\Models\Remittance;
use App\Models\Transaction;
use App\Services\FinancialReportPdfService;
use App\Services\FinancialReportStatement;
use App\Services\GroqResponsesService;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

class FinancialReportController extends Controller
{
    public function __construct(
        private readonly GroqResponsesService $groq,
        private readonly FinancialReportPdfService $pdf,
    ) {}

    public function index(Request $request)
    {
        $filters = $request->validate([
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
            'page' => ['nullable', 'integer', 'min:1'],
            'organization_id' => ['nullable', 'integer', Rule::exists('organizations', 'id')->where('organization_type', 'STUDENT_ORGANIZATION')],
            'status' => ['nullable', 'in:draft,pending_department_head,pending_sao,approved,rejected'],
            'document_type' => ['nullable', 'in:financial_report,income_statement'],
            'search' => ['nullable', 'string', 'max:120'],
        ]);

        $query = FinancialReport::with([
            'organization:id,name,acronym',
            'event:id,title',
            'generator:school_id,first_name,last_name',
            'deadline:id,deadline_at',
            'departmentHeadApprover:school_id,first_name,last_name',
            'saoApprover:school_id,first_name,last_name',
        ]);
        if ($request->user()->role === 'SUPER_ADMIN') {
            $query->when($filters['organization_id'] ?? null, fn ($builder, $organizationId) => $builder->where('organization_id', $organizationId));
            $query->whereNotNull('department_head_approved_at');
        } elseif ($request->user()->role === 'DEPARTMENT_HEAD') {
            $query->where('organization_id', $request->user()->organization_id)
                ->whereNotNull('submitted_at');
        } else {
            $query->where('organization_id', $request->user()->organization_id);
        }
        $query
            ->when($filters['status'] ?? null, fn ($builder, $status) => $builder->where('submission_status', $status))
            ->when($filters['document_type'] ?? null, fn ($builder, $documentType) => $builder->where('document_type', $documentType))
            ->when($filters['search'] ?? null, fn ($builder, $search) => $builder->where('title', 'like', '%'.trim($search).'%'));

        return response()->json($query->orderByDesc('generated_at')->orderByDesc('id')->paginate($filters['per_page'] ?? 20));
    }

    public function show(Request $request, FinancialReport $financialReport)
    {
        if (! $this->canAccessReport($request, $financialReport)) {
            return response()->json(['message' => 'Financial report not found.'], 404);
        }

        $transactions = $financialReport->savedTransactions();

        return response()->json([
            'report' => $financialReport->load([
                'organization:id,name,acronym', 'event:id,title', 'generator:school_id,first_name,last_name',
                'deadline:id,deadline_at', 'departmentHeadApprover:school_id,first_name,last_name',
                'saoApprover:school_id,first_name,last_name',
            ]),
            'transactions' => $transactions,
            ...FinancialReportStatement::from($transactions, $this->openingBalanceFor($financialReport)),
        ]);
    }

    public function generate(Request $request)
    {
        $missingColumns = collect(['document_type', 'letterhead_path', 'letter_details', 'opening_balance_snapshot', 'transactions_snapshot', 'custody_snapshot'])
            ->reject(fn (string $column) => Schema::hasColumn('financial_reports', $column))
            ->values();

        if ($missingColumns->isNotEmpty()) {
            return response()->json([
                'error_code' => 'FINANCIAL_REPORT_SCHEMA_OUTDATED',
                'message' => 'Financial report generation is unavailable because this server has not applied the latest database migration. Run "php artisan migrate" and try again.',
            ], 503);
        }

        $data = $request->validate([
            'document_type' => ['nullable', 'in:financial_report,income_statement'],
            'report_type' => ['required', 'in:monthly,semester,custom,event'],
            'financial_semester_id' => ['required_if:report_type,semester', 'prohibited_unless:report_type,semester', 'nullable', 'integer'],
            'period_start' => ['required_if:report_type,custom', 'prohibited_unless:report_type,custom', 'nullable', 'date'],
            'period_end' => ['required_if:report_type,custom', 'prohibited_unless:report_type,custom', 'nullable', 'date', 'after_or_equal:period_start'],
            'event_id' => ['required_if:report_type,event', 'prohibited_unless:report_type,event', 'nullable', 'integer'],
            'signatories' => ['required', 'array:treasurer,president,adviser,sbo_adviser'],
            'signatories.treasurer' => ['required', 'string', 'max:255'],
            'signatories.president' => ['required', 'string', 'max:255'],
            'signatories.adviser' => ['required', 'string', 'max:255'],
            'signatories.sbo_adviser' => ['required', 'string', 'max:255'],
            'letterhead' => ['nullable', 'image', 'mimes:jpg,jpeg,png', 'max:5120'],
            'letter_date' => ['nullable', 'date'],
            'letter_subject' => ['nullable', 'string', 'max:255'],
            'letter_recipient' => ['nullable', 'string', 'max:255'],
            'letter_body' => ['nullable', 'string', 'max:2000'],
            'letter_closing' => ['nullable', 'string', 'max:255'],
        ]);
        $data['document_type'] ??= 'financial_report';

        $organizationId = $request->user()->organization_id;
        $semester = null;
        if ($data['report_type'] === 'semester') {
            $semester = FinancialSemester::where('organization_id', $organizationId)->find($data['financial_semester_id']);
            if (! $semester) {
                return response()->json(['message' => 'Selected semester does not belong to this organization.'], 422);
            }
        }
        $event = null;
        if (! empty($data['event_id'])) {
            $event = Event::where('organization_id', $organizationId)->find($data['event_id']);
            if (! $event) {
                return response()->json(['message' => 'Selected event does not belong to this organization.'], 422);
            }
        }

        [$start, $end] = $semester
            ? [$semester->starts_on->toDateString(), $semester->ends_on->toDateString()]
            : $this->period($data, $event);
        $transactions = Transaction::with(['event:id,title', 'budget:id,title'])
            ->where('organization_id', $organizationId)
            ->when($event, fn ($query) => $query->where('event_id', $event->id))
            ->when(! $event, fn ($query) => $query
                ->whereDate('transaction_date', '>=', $start)
                ->whereDate('transaction_date', '<=', $end))
            ->orderBy('transaction_date')
            ->get();

        $cashAdvanceKinds = Transaction::cashAdvanceKinds($transactions->pluck('id'));
        $transactions->each(fn (Transaction $transaction) => $transaction->setAttribute('cash_advance', $cashAdvanceKinds[$transaction->id] ?? null));
        $openingBalance = $event ? 0.0 : $this->openingBalance($organizationId, $start);
        $statement = FinancialReportStatement::from($transactions, $openingBalance);
        $title = $this->title($data['document_type'], $data['report_type'], $start, $end, $event);
        if ($semester) {
            $title = ($data['document_type'] === 'income_statement' ? 'Income Statement' : 'Financial Report').' - '.$semester->name;
        }
        $byCategory = FinancialReportStatement::ordinary($transactions)
            ->groupBy(fn (Transaction $transaction) => $transaction->category.'|'.$transaction->type)
            ->map(fn ($rows) => [
                'category' => $rows->first()->category,
                'type' => $rows->first()->type,
                'total' => round((float) $rows->sum('amount'), 2),
            ])->values();
        $collectionQuery = Collection::where('organization_id', $organizationId)->where('status', 'verified')
            ->when($event, fn ($query) => $query->where('event_id', $event->id))
            ->when(! $event, fn ($query) => $query->whereDate('verified_at', '>=', $start)->whereDate('verified_at', '<=', $end));
        $remittanceQuery = Remittance::where('status', 'recorded')
            ->whereHas('collection', fn ($query) => $query->where('organization_id', $organizationId)
                ->when($event, fn ($builder) => $builder->where('event_id', $event->id)))
            ->when(! $event, fn ($query) => $query->whereDate('remitted_at', '>=', $start)->whereDate('remitted_at', '<=', $end));
        $custody = [
            'verified_collections' => round((float) $collectionQuery->sum('amount_collected'), 2),
            'recorded_remittances' => round((float) $remittanceQuery->sum('amount'), 2),
        ];
        $latestForecast = FinancialForecast::latestFor($organizationId);
        $budgets = Budget::where('organization_id', $organizationId)
            ->when($event, fn ($query) => $query->where('event_id', $event->id))
            ->when($semester, fn ($query) => $query->where('financial_semester_id', $semester->id))
            ->whereNotNull('advice_generated_at')
            ->get([
                'id', 'event_id', 'title', 'allocated_amount', 'remaining_amount',
                'recommended_allocation', 'safe_spending_limit', 'overspending_risk',
                'advisory_note', 'advice_generated_at',
            ]);
        $auditLogs = AuditLog::where('organization_id', $organizationId)
            ->whereIn('module', ['financial_ledger', 'budgets', 'financial_reports'])
            ->whereDate('created_at', '>=', $start)
            ->whereDate('created_at', '<=', $end)
            ->latest('created_at')
            ->limit(100)
            ->get(['id', 'user_id', 'module', 'action', 'record_type', 'record_id', 'created_at']);
        $reportContext = [
            'report_title' => $title,
            'document_type' => $data['document_type'],
            'income_statement' => [
                'record_count' => $transactions->count(),
                'total_income' => $statement['totals']['income'],
                'total_expense' => $statement['totals']['expense'],
                'net_balance' => $statement['totals']['balance'],
                'opening_balance' => $statement['totals']['opening_balance'],
                'closing_balance' => $statement['totals']['closing_balance'],
            ],
            'expense_and_income_by_category' => $byCategory->all(),
            'custody_movements' => $custody,
            'cash_advances' => $statement['cash_advances'],
            'latest_ols_forecast' => $latestForecast?->only([
                'forecast_period', 'predicted_income', 'predicted_expense', 'predicted_balance',
                'safe_spending_limit', 'confidence_note', 'model_details',
            ]),
            'budget_advisories' => $budgets->toArray(),
            'audit_log_summary' => [
                'entry_count' => $auditLogs->count(),
                'actions' => $auditLogs->countBy(fn (AuditLog $log) => $log->module.'.'.$log->action)->all(),
            ],
        ];
        $summary = $this->summary($reportContext);

        $letterheadPath = $request->hasFile('letterhead')
            ? $request->file('letterhead')->store('financial-report-letterheads/'.$organizationId, 'local')
            : null;
        $letterDetails = [
            'date' => $data['letter_date'] ?? now()->toDateString(),
            'subject' => trim((string) ($data['letter_subject'] ?? '')),
            'recipient' => trim((string) ($data['letter_recipient'] ?? '')),
            'body' => trim((string) ($data['letter_body'] ?? '')),
            'closing' => trim((string) ($data['letter_closing'] ?? '')),
            'letterhead_name' => $request->file('letterhead')?->getClientOriginalName(),
        ];

        try {
            $result = DB::transaction(function () use ($request, $data, $event, $semester, $start, $end, $title, $summary, $transactions, $openingBalance, $statement, $organizationId, $byCategory, $custody, $latestForecast, $budgets, $auditLogs, $reportContext, $letterheadPath, $letterDetails) {
                $aiOutput = AiOutput::create([
                    'organization_id' => $organizationId,
                    'feature_type' => 'FINANCIAL_SUMMARY',
                    'reference_type' => FinancialReport::class,
                    'reference_id' => null,
                    'prompt_text' => json_encode($reportContext, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR),
                    'output_text' => $summary['ai_generated'] ? $summary['text'] : '',
                    'model_name' => $summary['model'],
                    'context_version' => 'financial-report-v2',
                    'structured_input' => $reportContext,
                    'structured_output' => ['deterministic_summary' => $summary['text']],
                    'status' => $summary['ai_generated'] ? 'completed' : 'failed',
                    'error_message' => $summary['ai_generated'] ? null : 'Groq summary was unavailable; the calculated financial report was still saved.',
                    'decision_status' => $summary['ai_generated'] ? 'accepted' : 'rejected',
                    'decided_by' => $summary['ai_generated'] ? $request->user()->school_id : null,
                    'decided_at' => $summary['ai_generated'] ? now() : null,
                    'requested_by' => $request->user()->school_id,
                    'created_at' => now(),
                ]);

                $report = FinancialReport::create([
                    'organization_id' => $organizationId,
                    'event_id' => $event?->id,
                    'financial_semester_id' => $semester?->id,
                    'report_type' => $data['report_type'],
                    'document_type' => $data['document_type'],
                    'title' => $title,
                    'period_start' => $start,
                    'period_end' => $end,
                    'summary_text' => $summary['text'],
                    'letterhead_path' => $letterheadPath,
                    'letter_details' => $letterDetails,
                    'signatories' => $data['signatories'],
                    'source_transaction_ids' => $transactions->pluck('id')->all(),
                    'opening_balance_snapshot' => round($openingBalance, 2),
                    'transactions_snapshot' => $transactions->map(fn (Transaction $transaction) => [
                        ...$transaction->only([
                            'id', 'organization_id', 'event_id', 'budget_id', 'transaction_date',
                            'description', 'category', 'type', 'amount', 'receipt_reference',
                        ]),
                        'cash_advance' => $transaction->getAttribute('cash_advance'),
                        'event' => $transaction->event?->only(['id', 'title']),
                        'budget' => $transaction->budget?->only(['id', 'title']),
                    ])->all(),
                    'custody_snapshot' => $custody,
                    'submission_status' => 'draft',
                    'ai_output_id' => $aiOutput->id,
                    'generated_by' => $request->user()->school_id,
                    'generated_at' => now(),
                ]);

                $aiOutput->update(['reference_id' => $report->id]);

                AuditLog::create([
                    'organization_id' => $organizationId,
                    'user_id' => $request->user()->school_id,
                    'module' => 'financial_reports',
                    'action' => 'generated',
                    'record_type' => FinancialReport::class,
                    'record_id' => $report->id,
                    'new_values' => [
                        'title' => $title,
                        'report_type' => $data['report_type'],
                        'document_type' => $data['document_type'],
                        'period_start' => $start,
                        'period_end' => $end,
                        'transaction_count' => $transactions->count(),
                        'audit_entry_count' => $auditLogs->count(),
                        'forecast_id' => $latestForecast?->id,
                    ],
                    'ip_address' => $request->ip(),
                    'created_at' => now(),
                ]);

                return [
                    'report' => $report->load(['event:id,title', 'generator:school_id,first_name,last_name']),
                    ...$statement,
                    'by_category' => $byCategory,
                    'custody' => $custody,
                    'latest_ols_forecast' => $latestForecast,
                    'budget_advisories' => $budgets,
                    'audit_logs' => $auditLogs,
                    'transactions' => $transactions,
                    'ai_summary_status' => $summary['ai_generated'] ? 'generated' : 'unavailable',
                ];
            });
        } catch (\Throwable $exception) {
            if ($letterheadPath) {
                Storage::disk('local')->delete($letterheadPath);
            }
            throw $exception;
        }

        return response()->json($result, 201);
    }

    public function downloadPdf(Request $request, FinancialReport $financialReport)
    {
        if (! $this->canAccessReport($request, $financialReport)) {
            return response()->json(['message' => 'Financial report not found.'], 404);
        }

        $financialReport->load(['organization:id,name,acronym', 'event:id,title']);
        $transactions = $financialReport->savedTransactions()
            ->map(fn (array|Transaction $row) => $row instanceof Transaction ? $row : new Transaction($row));
        $pdf = $this->pdf->render($financialReport, $transactions, $this->openingBalanceFor($financialReport));

        return response($pdf['content'], 200, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => ($request->boolean('inline') ? 'inline' : 'attachment').'; filename="'.$pdf['filename'].'"',
            'Cache-Control' => 'private, no-store, max-age=0',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    public function submit(Request $request, FinancialReport $financialReport)
    {
        if ($financialReport->organization_id !== $request->user()->organization_id) {
            return response()->json(['message' => 'Financial report not found.'], 404);
        }
        if (! in_array($financialReport->submission_status, ['draft', 'rejected'], true)) {
            return response()->json(['message' => 'Only draft or rejected reports can be submitted.'], 409);
        }

        $data = $request->validate([
            'supporting_documents' => ['nullable', 'array', 'max:10'],
            'supporting_documents.*' => ['file', 'mimes:pdf,jpg,jpeg,png,doc,docx,xls,xlsx', 'max:10240'],
        ]);
        unset($data);

        $documents = collect($financialReport->supporting_documents ?? []);
        foreach ($request->file('supporting_documents', []) as $file) {
            $path = $file->store('financial-reports/'.$financialReport->organization_id, 'public');
            $documents->push([
                'name' => $file->getClientOriginalName(),
                'path' => $path,
                'url' => Storage::disk('public')->url($path),
                'mime_type' => $file->getClientMimeType(),
                'size' => $file->getSize(),
            ]);
        }

        DB::transaction(function () use ($request, $financialReport, $documents) {
            ApprovalRequest::where('organization_id', $financialReport->organization_id)
                ->where('entity_type', 'financial_report')
                ->where('entity_id', $financialReport->id)
                ->where('status', 'pending')
                ->update(['status' => 'rejected', 'active_key' => null, 'remarks' => 'Superseded by a new submission.', 'reviewed_at' => now()]);

            $financialReport->update([
                'supporting_documents' => $documents->values()->all(),
                'submission_status' => 'pending_department_head',
                'submitted_at' => now(),
                'department_head_approved_by' => null,
                'department_head_approved_at' => null,
                'sao_approved_by' => null,
                'sao_approved_at' => null,
            ]);

            ApprovalRequest::create([
                'organization_id' => $financialReport->organization_id,
                'entity_type' => 'financial_report',
                'entity_id' => $financialReport->id,
                'requested_by' => $request->user()->school_id,
                'required_role' => 'DEPARTMENT_HEAD',
                'status' => 'pending',
                'active_key' => 'financial_report:'.$financialReport->organization_id.':'.$financialReport->id,
                'requested_at' => now(),
            ]);

            AuditLog::create([
                'organization_id' => $financialReport->organization_id,
                'user_id' => $request->user()->school_id,
                'actor_role' => $request->user()->role,
                'module' => 'financial_reports',
                'action' => 'submitted',
                'description' => 'Financial report submitted to the Department Head for first-stage review.',
                'record_type' => FinancialReport::class,
                'record_id' => $financialReport->id,
                'new_values' => ['document_count' => $documents->count()],
                'ip_address' => $request->ip(),
                'created_at' => now(),
            ]);
        });

        return response()->json($financialReport->fresh());
    }

    private function canAccessReport(Request $request, FinancialReport $report): bool
    {
        return match ($request->user()->role) {
            'ADMIN', 'SBO_OFFICER' => $report->organization_id === $request->user()->organization_id,
            'DEPARTMENT_HEAD' => $report->organization_id === $request->user()->organization_id
                && $report->submitted_at !== null,
            'SUPER_ADMIN' => $report->department_head_approved_at !== null,
            default => false,
        };
    }

    private function period(array $data, ?Event $event): array
    {
        return match ($data['report_type']) {
            'monthly' => [now()->startOfMonth()->toDateString(), now()->endOfMonth()->toDateString()],
            'semester' => [now()->subMonths(6)->startOfDay()->toDateString(), now()->endOfDay()->toDateString()],
            'event' => [Carbon::parse($event->start_time)->toDateString(), Carbon::parse($event->end_time)->toDateString()],
            default => [Carbon::parse($data['period_start'])->toDateString(), Carbon::parse($data['period_end'])->toDateString()],
        };
    }

    private function title(string $documentType, string $type, string $start, string $end, ?Event $event): string
    {
        $label = $documentType === 'income_statement' ? 'Income Statement' : 'Financial Report';

        return match ($type) {
            'monthly' => 'Monthly '.$label.' - '.Carbon::parse($start)->format('F Y'),
            'semester' => 'Semester '.$label.' - '.Carbon::parse($start)->format('M Y').' to '.Carbon::parse($end)->format('M Y'),
            'event' => 'Event '.$label.' - '.$event->title,
            default => 'Custom '.$label.' - '.Carbon::parse($start)->format('M j, Y').' to '.Carbon::parse($end)->format('M j, Y'),
        };
    }

    private function openingBalanceFor(FinancialReport $report): float
    {
        if ($report->opening_balance_snapshot !== null) {
            return (float) $report->opening_balance_snapshot;
        }

        return $report->event_id || ! $report->period_start
            ? 0.0
            : $this->openingBalance($report->organization_id, $report->period_start->toDateString());
    }

    private function openingBalance(int $organizationId, string $periodStart): float
    {
        $totals = Transaction::query()
            ->where('organization_id', $organizationId)
            ->whereDate('transaction_date', '<', $periodStart)
            ->selectRaw("SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as income_total")
            ->selectRaw("SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as expense_total")
            ->first();

        return (float) ($totals?->income_total ?? 0) - (float) ($totals?->expense_total ?? 0);
    }

    private function summary(array $context): array
    {
        $title = $context['report_title'];
        $statement = $context['income_statement'];
        $advances = $context['cash_advances'];
        $advanceNote = $advances['released'] > 0 || $advances['repayments'] > 0
            ? ' Cash advances released are ₱'.number_format($advances['released'], 2).' and cash advance repayments are ₱'.number_format($advances['repayments'], 2).'; they are money lent out and returned, so they are not counted as income or expense.'
            : '';
        $fallback = "{$title} includes {$statement['record_count']} ledger record(s). Total income is ₱".number_format($statement['total_income'], 2).', total expenses are ₱'.number_format($statement['total_expense'], 2).', and net activity is ₱'.number_format($statement['net_balance'], 2).'. Opening balance is ₱'.number_format($statement['opening_balance'], 2).' and closing balance is ₱'.number_format($statement['closing_balance'], 2).'. Verified collections are ₱'.number_format($context['custody_movements']['verified_collections'], 2).' and recorded remittances are ₱'.number_format($context['custody_movements']['recorded_remittances'], 2).'. Remittances are not counted again as income.'.$advanceNote;

        $generated = $this->groq->generate(
            'Write a concise, human-readable student-organization financial report using only the supplied data. Cover the income statement, expense summary, custody movements, latest OLS forecast when available, budget-advisory results, and audit-log summary. Distinguish period net activity from opening and closing balance. Remittances are custody movements and must never be added to income. Cash advances are money lent out and returned, never income or expense: report them separately when they are not zero. Preserve every figure and risk label. Clearly say when an input section has no data. Return plain text only; do not use Markdown, asterisks, backticks, or heading markers.',
            json_encode($context, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR),
            650,
            0.2,
        );
        if ($generated) {
            $generated['text'] = $this->groq->plainText($generated['text']);
            if ($generated['text'] === '') {
                $generated = null;
            }
        }
        if ($generated && ! $this->groq->preservesNumericFacts($generated['text'], $context)) {
            $generated = null;
        }

        return $generated
            ? [...$generated, 'ai_generated' => true]
            : ['text' => $fallback, 'model' => null, 'ai_generated' => false];
    }
}
