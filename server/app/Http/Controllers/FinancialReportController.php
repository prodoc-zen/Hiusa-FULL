<?php

namespace App\Http\Controllers;

use App\Models\AiOutput;
use App\Models\Event;
use App\Models\FinancialReport;
use App\Models\Transaction;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

class FinancialReportController extends Controller
{
    public function index(Request $request)
    {
        return response()->json(
            FinancialReport::with([
                'event:id,title',
                'generator:school_id,first_name,last_name',
            ])
                ->where('organization_id', $request->user()->organization_id)
                ->orderByDesc('generated_at')
                ->get()
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
        $summary = $this->summary($title, $income, $expense, $balance, $transactions->count());

        $result = DB::transaction(function () use ($request, $data, $event, $start, $end, $title, $summary, $transactions, $income, $expense, $balance, $organizationId) {
            $aiOutput = AiOutput::create([
                'organization_id' => $organizationId,
                'feature_type' => 'financial_summary',
                'reference_type' => FinancialReport::class,
                'reference_id' => null,
                'prompt_text' => "{$title}; income: {$income}; expenses: {$expense}; balance: {$balance}; records: {$transactions->count()}.",
                'output_text' => $summary['text'],
                'model_name' => $summary['model'],
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

            return [
                'report' => $report->load(['event:id,title', 'generator:school_id,first_name,last_name']),
                'totals' => [
                    'income' => round($income, 2),
                    'expense' => round($expense, 2),
                    'balance' => round($balance, 2),
                ],
                'by_category' => $transactions
                    ->groupBy(fn (Transaction $transaction) => $transaction->category.'|'.$transaction->type)
                    ->map(fn ($rows) => [
                        'category' => $rows->first()->category,
                        'type' => $rows->first()->type,
                        'total' => round((float) $rows->sum('amount'), 2),
                    ])->values(),
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

    private function summary(string $title, float $income, float $expense, float $balance, int $count): array
    {
        $fallback = "{$title} includes {$count} ledger record(s). Total income is PHP ".number_format($income, 2).', total expenses are PHP '.number_format($expense, 2).', and net balance is PHP '.number_format($balance, 2).'.';
        $apiKey = env('GROQ_API_KEY');
        $model = env('GROQ_MODEL', 'llama-3.1-8b-instant');

        if (! $apiKey) {
            return ['text' => $fallback, 'model' => 'deterministic-fallback'];
        }

        try {
            $response = Http::withToken($apiKey)->timeout(25)->post('https://api.groq.com/openai/v1/chat/completions', [
                'model' => $model,
                'messages' => [
                    ['role' => 'system', 'content' => 'Summarize this student-organization financial report concisely. Preserve every supplied figure.'],
                    ['role' => 'user', 'content' => "{$title}; records: {$count}; income: {$income}; expenses: {$expense}; balance: {$balance}."],
                ],
                'temperature' => 0.2,
                'max_tokens' => 220,
            ]);
            $text = trim((string) data_get($response->json(), 'choices.0.message.content'));
            if ($response->successful() && $text !== '') {
                return ['text' => $text, 'model' => $model];
            }
        } catch (\Throwable) {
            // Keep report generation available when Groq cannot be reached.
        }

        return ['text' => $fallback, 'model' => 'deterministic-fallback'];
    }
}
