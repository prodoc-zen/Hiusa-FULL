<?php

namespace App\Http\Controllers;

use App\Models\AiOutput;
use App\Models\AuditLog;
use App\Models\Budget;
use App\Models\Event;
use App\Models\FinancialForecast;
use App\Models\FinancialReport;
use App\Models\Transaction;
use App\Services\GroqResponsesService;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class FinancialReportController extends Controller
{
    public function __construct(private readonly GroqResponsesService $groq) {}

    public function index(Request $request)
    {
        $paging = $request->validate([
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);

        return response()->json(
            FinancialReport::with([
                'event:id,title',
                'generator:school_id,first_name,last_name',
            ])
                ->where('organization_id', $request->user()->organization_id)
                ->orderByDesc('generated_at')
                ->orderByDesc('id')
                ->paginate($paging['per_page'] ?? 20)
        );
    }

    public function generate(Request $request)
    {
        $data = $request->validate([
            'report_type' => ['required', 'in:monthly,semester,custom,event'],
            'period_start' => ['nullable', 'date', 'required_if:report_type,custom'],
            'period_end' => ['nullable', 'date', 'after_or_equal:period_start', 'required_if:report_type,custom'],
            'event_id' => ['nullable', 'integer', 'required_if:report_type,event'],
        ]);

        $organizationId = $request->user()->organization_id;
        $event = null;
        if (! empty($data['event_id'])) {
            $event = Event::where('organization_id', $organizationId)->find($data['event_id']);
            if (! $event) {
                return response()->json(['message' => 'Selected event does not belong to this organization.'], 422);
            }
        }

        [$start, $end] = $this->period($data, $event);
        $transactions = Transaction::with(['event:id,title', 'budget:id,title'])
            ->where('organization_id', $organizationId)
            ->when($event, fn ($query) => $query->where('event_id', $event->id))
            ->when(! $event, fn ($query) => $query
                ->whereDate('transaction_date', '>=', $start)
                ->whereDate('transaction_date', '<=', $end))
            ->orderBy('transaction_date')
            ->get();

        $income = (float) $transactions->where('type', 'income')->sum('amount');
        $expense = (float) $transactions->where('type', 'expense')->sum('amount');
        $balance = $income - $expense;
        $title = $this->title($data['report_type'], $start, $end, $event);
        $byCategory = $transactions
            ->groupBy(fn (Transaction $transaction) => $transaction->category.'|'.$transaction->type)
            ->map(fn ($rows) => [
                'category' => $rows->first()->category,
                'type' => $rows->first()->type,
                'total' => round((float) $rows->sum('amount'), 2),
            ])->values();
        $latestForecast = FinancialForecast::where('organization_id', $organizationId)
            ->orderByDesc('forecast_period')
            ->first();
        $budgets = Budget::where('organization_id', $organizationId)
            ->when($event, fn ($query) => $query->where('event_id', $event->id))
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
            'income_statement' => [
                'record_count' => $transactions->count(),
                'total_income' => round($income, 2),
                'total_expense' => round($expense, 2),
                'net_balance' => round($balance, 2),
            ],
            'expense_and_income_by_category' => $byCategory->all(),
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

        $result = DB::transaction(function () use ($request, $data, $event, $start, $end, $title, $summary, $transactions, $income, $expense, $balance, $organizationId, $byCategory, $latestForecast, $budgets, $auditLogs, $reportContext) {
            $aiOutput = AiOutput::create([
                'organization_id' => $organizationId,
                'feature_type' => 'FINANCIAL_SUMMARY',
                'reference_type' => FinancialReport::class,
                'reference_id' => null,
                'prompt_text' => json_encode($reportContext, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR),
                'output_text' => $summary['text'],
                'model_name' => $summary['model'],
                'context_version' => 'financial-report-v2',
                'structured_input' => $reportContext,
                'structured_output' => ['summary' => $summary['text']],
                'status' => 'completed',
                'decision_status' => 'accepted',
                'decided_by' => $request->user()->school_id,
                'decided_at' => now(),
                'requested_by' => $request->user()->school_id,
                'created_at' => now(),
            ]);

            $report = FinancialReport::create([
                'organization_id' => $organizationId,
                'event_id' => $event?->id,
                'report_type' => $data['report_type'],
                'title' => $title,
                'period_start' => $start,
                'period_end' => $end,
                'summary_text' => $summary['text'],
                'source_transaction_ids' => $transactions->pluck('id')->all(),
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
                'totals' => [
                    'income' => round($income, 2),
                    'expense' => round($expense, 2),
                    'balance' => round($balance, 2),
                ],
                'by_category' => $byCategory,
                'latest_ols_forecast' => $latestForecast,
                'budget_advisories' => $budgets,
                'audit_logs' => $auditLogs,
                'transactions' => $transactions,
            ];
        });

        return response()->json($result, 201);
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

    private function title(string $type, string $start, string $end, ?Event $event): string
    {
        return match ($type) {
            'monthly' => 'Monthly Financial Report - '.Carbon::parse($start)->format('F Y'),
            'semester' => 'Semester Financial Report - '.Carbon::parse($start)->format('M Y').' to '.Carbon::parse($end)->format('M Y'),
            'event' => 'Event Financial Report - '.$event->title,
            default => 'Custom Financial Report - '.Carbon::parse($start)->format('M j, Y').' to '.Carbon::parse($end)->format('M j, Y'),
        };
    }

    private function summary(array $context): array
    {
        $title = $context['report_title'];
        $statement = $context['income_statement'];
        $fallback = "{$title} includes {$statement['record_count']} ledger record(s). Total income is PHP ".number_format($statement['total_income'], 2).', total expenses are PHP '.number_format($statement['total_expense'], 2).', and net balance is PHP '.number_format($statement['net_balance'], 2).'. The report also includes the latest available OLS forecast, budget-advisory outputs, and '.$context['audit_log_summary']['entry_count'].' financial audit log entry or entries.';

        return $this->groq->generate(
            'Write a concise, human-readable student-organization financial report using only the supplied data. Cover the income statement, expense summary, latest OLS forecast when available, budget-advisory results, and audit-log summary. Preserve every figure and risk label. Clearly say when an input section has no data.',
            json_encode($context, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR),
            650,
            0.2,
        ) ?? ['text' => $fallback, 'model' => 'deterministic-fallback'];
    }
}
