<?php

namespace App\Http\Controllers;

use App\Models\AiOutput;
use App\Models\FinancialForecast;
use App\Models\Transaction;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;

class FinancialForecastController extends Controller
{
    public function index(Request $request)
    {
        return response()->json(
            FinancialForecast::with('generator:school_id,first_name,last_name')
                ->where('organization_id', $request->user()->organization_id)
                ->orderBy('forecast_period', 'asc')
                ->get()
        );
    }

    public function store(Request $request)
    {
        $data = $request->validate($this->rules());
        $data = $this->deriveForecastFields($data);

        $forecast = FinancialForecast::create([
            ...$data,
            'generated_by' => $request->user()->id,
            'organization_id' => $request->user()->organization_id,
        ]);

        return response()->json($forecast->load('generator:school_id,first_name,last_name'), 201);
    }

    public function generate(Request $request)
    {
        $data = $request->validate([
            'months' => ['nullable', 'integer', 'min:2', 'max:36'],
        ]);

        $months = $data['months'] ?? 12;
        $rows = Transaction::query()
            ->where('organization_id', $request->user()->organization_id)
            ->whereDate('transaction_date', '>=', now()->startOfMonth()->subMonths($months - 1))
            ->orderBy('transaction_date')
            ->get(['id', 'type', 'amount', 'transaction_date']);

        $monthly = $rows
            ->groupBy(fn (Transaction $transaction) => Carbon::parse($transaction->transaction_date)->format('Y-m'))
            ->map(fn ($transactions, string $period) => [
                'period' => $period,
                'income' => (float) $transactions->where('type', 'income')->sum('amount'),
                'expense' => (float) $transactions->where('type', 'expense')->sum('amount'),
            ])
            ->sortBy('period')
            ->values();

        if ($monthly->count() < 2) {
            return response()->json([
                'message' => 'At least two months of transaction history are required to generate an OLS forecast.',
            ], 422);
        }

        $firstPeriod = Carbon::createFromFormat('Y-m', $monthly->first()['period'])->startOfMonth();
        $points = $monthly->map(fn (array $month) => [
            ...$month,
            'x' => $firstPeriod->diffInMonths(Carbon::createFromFormat('Y-m', $month['period'])->startOfMonth()),
        ]);
        $nextPeriod = Carbon::createFromFormat('Y-m', $monthly->last()['period'])->startOfMonth()->addMonth();
        $nextX = $firstPeriod->diffInMonths($nextPeriod);
        $incomeModel = $this->ols($points->pluck('x')->all(), $points->pluck('income')->all());
        $expenseModel = $this->ols($points->pluck('x')->all(), $points->pluck('expense')->all());
        $predictedIncome = round(max(0, $incomeModel['intercept'] + ($incomeModel['slope'] * $nextX)), 2);
        $predictedExpense = round(max(0, $expenseModel['intercept'] + ($expenseModel['slope'] * $nextX)), 2);
        $predictedBalance = round($predictedIncome - $predictedExpense, 2);
        $safeSpendingLimit = round(max(0, $predictedBalance * 0.8), 2);
        $risk = $predictedBalance < 0 ? 'deficit' : ($predictedExpense > $predictedIncome * 0.9 ? 'overspending' : 'stable');
        $summary = $this->financialSummary($nextPeriod->format('F Y'), $predictedIncome, $predictedExpense, $predictedBalance, $safeSpendingLimit, $risk);

        $aiOutput = AiOutput::create([
            'organization_id' => $request->user()->organization_id,
            'feature_type' => 'financial_summary',
            'reference_type' => FinancialForecast::class,
            'reference_id' => null,
            'prompt_text' => "Forecast period: {$nextPeriod->format('F Y')}; predicted income: {$predictedIncome}; predicted expense: {$predictedExpense}; predicted balance: {$predictedBalance}; safe spending limit: {$safeSpendingLimit}; risk: {$risk}.",
            'output_text' => $summary['text'],
            'model_name' => $summary['model'],
            'requested_by' => $request->user()->id,
            'created_at' => now(),
        ]);

        $forecast = FinancialForecast::updateOrCreate(
            [
                'organization_id' => $request->user()->organization_id,
                'forecast_period' => $nextPeriod->format('Y-m'),
            ],
            [
                'predicted_income' => $predictedIncome,
                'predicted_expense' => $predictedExpense,
                'predicted_balance' => $predictedBalance,
                'safe_spending_limit' => $safeSpendingLimit,
                'confidence_note' => $summary['text'],
                'model_details' => [
                    'algorithm' => 'ordinary_least_squares',
                    'sample_months' => $monthly->count(),
                    'income' => $incomeModel,
                    'expense' => $expenseModel,
                    'risk' => $risk,
                    'ai_output_id' => $aiOutput->id,
                ],
                'generated_by' => $request->user()->id,
            ]
        );

        $aiOutput->update(['reference_id' => $forecast->id]);

        return response()->json($forecast->fresh()->load('generator:school_id,first_name,last_name'), 201);
    }

    public function update(Request $request, $id)
    {
        $forecast = FinancialForecast::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $forecast) {
            return response()->json(['message' => 'Forecast not found.'], 404);
        }

        $data = $request->validate($this->rules(true));
        $forecast->update($this->deriveForecastFields($data, $forecast));

        return response()->json($forecast->fresh()->load('generator:school_id,first_name,last_name'));
    }

    public function destroy(Request $request, $id)
    {
        $forecast = FinancialForecast::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $forecast) {
            return response()->json(['message' => 'Forecast not found.'], 404);
        }

        $forecast->delete();

        return response()->json(['message' => 'Forecast deleted successfully.']);
    }

    private function rules(bool $partial = false): array
    {
        $required = $partial ? 'sometimes|required' : 'required';

        return [
            'forecast_period' => [$required, 'string', 'max:100'],
            'predicted_income' => [$required, 'numeric', 'min:0'],
            'predicted_expense' => [$required, 'numeric', 'min:0'],
            'predicted_balance' => ['nullable', 'numeric'],
            'safe_spending_limit' => ['nullable', 'numeric', 'min:0'],
            'confidence_note' => ['nullable', 'string'],
            'model_details' => ['nullable', 'array'],
        ];
    }

    private function deriveForecastFields(array $data, ?FinancialForecast $forecast = null): array
    {
        $income = array_key_exists('predicted_income', $data) ? (float) $data['predicted_income'] : (float) ($forecast?->predicted_income ?? 0);
        $expense = array_key_exists('predicted_expense', $data) ? (float) $data['predicted_expense'] : (float) ($forecast?->predicted_expense ?? 0);

        if (! array_key_exists('predicted_balance', $data)) {
            $data['predicted_balance'] = round($income - $expense, 2);
        }

        if (! array_key_exists('safe_spending_limit', $data)) {
            $data['safe_spending_limit'] = round(max(0, ($income - $expense) * 0.8), 2);
        }

        return $data;
    }

    private function ols(array $xValues, array $yValues): array
    {
        $count = count($xValues);
        $meanX = array_sum($xValues) / $count;
        $meanY = array_sum($yValues) / $count;
        $numerator = 0.0;
        $denominator = 0.0;

        foreach ($xValues as $index => $x) {
            $numerator += ($x - $meanX) * ($yValues[$index] - $meanY);
            $denominator += ($x - $meanX) ** 2;
        }

        $slope = $denominator > 0 ? $numerator / $denominator : 0.0;

        return [
            'slope' => round($slope, 6),
            'intercept' => round($meanY - ($slope * $meanX), 6),
        ];
    }

    private function financialSummary(string $period, float $income, float $expense, float $balance, float $safeLimit, string $risk): array
    {
        $fallback = $risk === 'deficit'
            ? "The {$period} forecast indicates a possible deficit. Reduce discretionary expenses and secure additional income before committing new funds. The safe spending limit is PHP ".number_format($safeLimit, 2).'.'
            : "The {$period} forecast is {$risk}. Expected income is PHP ".number_format($income, 2).', expected expenses are PHP '.number_format($expense, 2).', and the safe spending limit is PHP '.number_format($safeLimit, 2).'.';
        $apiKey = env('GROQ_API_KEY');
        $model = env('GROQ_MODEL', 'llama-3.1-8b-instant');

        if (! $apiKey) {
            return ['text' => $fallback, 'model' => 'deterministic-fallback'];
        }

        try {
            $response = Http::withToken($apiKey)
                ->timeout(25)
                ->post('https://api.groq.com/openai/v1/chat/completions', [
                    'model' => $model,
                    'messages' => [
                        ['role' => 'system', 'content' => 'Provide a concise, practical budget summary for a student organization. Do not change the supplied figures.'],
                        ['role' => 'user', 'content' => "Period: {$period}; income: {$income}; expense: {$expense}; balance: {$balance}; safe limit: {$safeLimit}; risk: {$risk}."],
                    ],
                    'temperature' => 0.2,
                    'max_tokens' => 220,
                ]);
            $text = trim((string) data_get($response->json(), 'choices.0.message.content'));

            if ($response->successful() && $text !== '') {
                return ['text' => $text, 'model' => $model];
            }
        } catch (\Throwable) {
            // Use the deterministic summary when Groq is unavailable.
        }

        return ['text' => $fallback, 'model' => 'deterministic-fallback'];
    }
}
