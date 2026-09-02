<?php

namespace App\Http\Controllers;

use App\Models\AiOutput;
use App\Models\ApprovalRequest;
use App\Models\Budget;
use App\Models\FinancialForecast;
use App\Models\Transaction;
use App\Services\GroqResponsesService;
use App\Services\HiusaAiService;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

class FinancialForecastController extends Controller
{
    // Mirrors ai-service/app/engines/financial_forecasting.py thresholds - keep in sync.
    private const MIN_SAMPLE_MONTHS_FOR_FIT_ASSESSMENT = 4;

    private const STRONG_FIT_R_SQUARED = 0.7;

    private const MODERATE_FIT_R_SQUARED = 0.4;

    public function __construct(
        private readonly HiusaAiService $aiService,
        private readonly GroqResponsesService $groq,
    ) {}

    public function index(Request $request)
    {
        $paging = $request->validate([
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);

        return response()->json(
            FinancialForecast::with('generator:school_id,first_name,last_name')
                ->where('organization_id', $request->user()->organization_id)
                ->orderBy('forecast_period', 'asc')
                ->paginate($paging['per_page'] ?? 20)
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

        $populatedMonthly = $rows
            ->groupBy(fn (Transaction $transaction) => Carbon::parse($transaction->transaction_date)->format('Y-m'))
            ->map(fn ($transactions, string $period) => [
                'period' => $period,
                'income' => (float) $transactions->where('type', 'income')->sum('amount'),
                'expense' => (float) $transactions->where('type', 'expense')->sum('amount'),
            ])
            ->sortBy('period')
            ->values();

        if ($populatedMonthly->count() < 2) {
            return response()->json([
                'message' => 'At least two months of transaction history are required to generate an OLS forecast.',
            ], 422);
        }

        $firstPeriod = Carbon::createFromFormat('Y-m', $populatedMonthly->first()['period'])->startOfMonth();
        $lastPeriod = Carbon::createFromFormat('Y-m', $populatedMonthly->last()['period'])->startOfMonth();
        $monthlyByPeriod = $populatedMonthly->keyBy('period');
        $monthly = collect();

        for ($period = $firstPeriod->copy(); $period->lte($lastPeriod); $period->addMonth()) {
            $key = $period->format('Y-m');
            $monthly->push($monthlyByPeriod->get($key, [
                'period' => $key,
                'income' => 0.0,
                'expense' => 0.0,
            ]));
        }

        $analysis = $this->pythonForecast($monthly->all()) ?? $this->localForecast($monthly->all());
        $nextPeriod = Carbon::createFromFormat('Y-m', $analysis['forecast_period'])->startOfMonth();
        $predictedIncome = $analysis['predicted_income'];
        $predictedExpense = $analysis['predicted_expense'];
        $predictedBalance = $analysis['predicted_balance'];
        $approvedBudgetIds = ApprovalRequest::query()
            ->where('organization_id', $request->user()->organization_id)
            ->where('entity_type', 'budget')
            ->where('status', 'approved')
            ->pluck('entity_id');
        $approvedBudgets = Budget::query()
            ->where('organization_id', $request->user()->organization_id)
            ->whereIn('id', $approvedBudgetIds);
        $currentAvailableBudget = (float) (clone $approvedBudgets)->sum('remaining_amount');
        $warningThreshold = (float) (clone $approvedBudgets)->sum('warning_threshold');
        $budgetAdvicePayload = [
            'predicted_income' => $predictedIncome,
            'predicted_expense' => $predictedExpense,
            'current_available_budget' => $currentAvailableBudget,
            'committed_expenses' => 0,
            'warning_threshold' => $warningThreshold,
            'safety_ratio' => 0.8,
        ];
        $advice = $this->aiService->budgetAdvice($budgetAdvicePayload);
        $adviceEngine = 'python-fastapi';

        if (! $this->validBudgetAdvice($advice)) {
            $advice = $this->localBudgetAdvice($budgetAdvicePayload);
            $adviceEngine = 'php-fallback';
        }

        $advice['engine'] = $adviceEngine;
        $safeSpendingLimit = round((float) $advice['safe_spending_limit'], 2);
        $risk = (string) $advice['forecast_risk'];
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
                    'populated_months' => $populatedMonthly->count(),
                    'current_available_budget' => round($currentAvailableBudget, 2),
                    'warning_threshold' => round($warningThreshold, 2),
                    'engine' => $analysis['engine'],
                    'income' => $analysis['income_model'],
                    'expense' => $analysis['expense_model'],
                    'raw_predicted_income' => $analysis['raw_predicted_income'] ?? $predictedIncome,
                    'raw_predicted_expense' => $analysis['raw_predicted_expense'] ?? $predictedExpense,
                    'income_clamped' => $analysis['income_clamped'] ?? false,
                    'expense_clamped' => $analysis['expense_clamped'] ?? false,
                    'fit_quality' => $analysis['fit_quality'] ?? null,
                    'is_reliable' => $analysis['is_reliable'] ?? null,
                    'confidence_note' => $analysis['confidence_note'] ?? null,
                    'risk' => $risk,
                    'budget_advice' => $advice,
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
        $intercept = $meanY - ($slope * $meanX);

        $residualSum = 0.0;
        $totalSum = 0.0;

        foreach ($xValues as $index => $x) {
            $residualSum += ($yValues[$index] - ($intercept + $slope * $x)) ** 2;
            $totalSum += ($yValues[$index] - $meanY) ** 2;
        }

        $rSquared = ($totalSum === 0.0 && $residualSum === 0.0)
            ? 1.0
            : ($totalSum > 0 ? 1 - ($residualSum / $totalSum) : 0.0);

        return [
            'slope' => round($slope, 6),
            'intercept' => round($intercept, 6),
            'r_squared' => round(max(0.0, min(1.0, $rSquared)), 6),
        ];
    }

    private function assessFitQuality(int $sampleMonths, float $incomeRSquared, float $expenseRSquared): array
    {
        if ($sampleMonths < self::MIN_SAMPLE_MONTHS_FOR_FIT_ASSESSMENT) {
            return [
                'fit_quality' => 'insufficient_data',
                'is_reliable' => false,
                'confidence_note' => "Only {$sampleMonths} month(s) of history were used. At least ".self::MIN_SAMPLE_MONTHS_FOR_FIT_ASSESSMENT.' months are needed before R'."\u{b2}".' is a meaningful signal, so treat this forecast as a rough estimate.',
            ];
        }

        $weakestFit = min($incomeRSquared, $expenseRSquared);
        $summary = "Based on {$sampleMonths} months of history with income R"."\u{b2} ".number_format($incomeRSquared, 3).' and expense R'."\u{b2} ".number_format($expenseRSquared, 3);

        if ($weakestFit >= self::STRONG_FIT_R_SQUARED) {
            return [
                'fit_quality' => 'strong',
                'is_reliable' => true,
                'confidence_note' => "{$summary}, the linear trend fits the data well.",
            ];
        }

        if ($weakestFit >= self::MODERATE_FIT_R_SQUARED) {
            return [
                'fit_quality' => 'moderate',
                'is_reliable' => true,
                'confidence_note' => "{$summary}, the trend is a fair but not tight fit; treat the projection as a general direction.",
            ];
        }

        return [
            'fit_quality' => 'weak',
            'is_reliable' => false,
            'confidence_note' => "{$summary}, actual figures vary widely from the linear trend; treat this projection with caution.",
        ];
    }

    private function pythonForecast(array $monthly): ?array
    {
        $result = $this->aiService->financialForecast($monthly);

        if (! is_array($result)
            || ! Carbon::hasFormat((string) ($result['forecast_period'] ?? ''), 'Y-m')
            || ! isset($result['income_model'], $result['expense_model'])
            || ! is_numeric($result['predicted_income'] ?? null)
            || ! is_numeric($result['predicted_expense'] ?? null)
            || ! is_numeric($result['predicted_balance'] ?? null)) {
            return null;
        }

        return [
            ...$result,
            'predicted_income' => round(max(0, (float) $result['predicted_income']), 2),
            'predicted_expense' => round(max(0, (float) $result['predicted_expense']), 2),
            'predicted_balance' => round((float) $result['predicted_balance'], 2),
            'engine' => 'python-fastapi',
        ];
    }

    private function localForecast(array $monthly): array
    {
        $firstPeriod = Carbon::createFromFormat('Y-m', $monthly[0]['period'])->startOfMonth();
        $points = collect($monthly)->map(fn (array $month) => [
            ...$month,
            'x' => $firstPeriod->diffInMonths(Carbon::createFromFormat('Y-m', $month['period'])->startOfMonth()),
        ]);
        $nextPeriod = Carbon::createFromFormat('Y-m', $monthly[array_key_last($monthly)]['period'])->startOfMonth()->addMonth();
        $nextX = $firstPeriod->diffInMonths($nextPeriod);
        $incomeModel = $this->ols($points->pluck('x')->all(), $points->pluck('income')->all());
        $expenseModel = $this->ols($points->pluck('x')->all(), $points->pluck('expense')->all());
        $rawPredictedIncome = round($incomeModel['intercept'] + ($incomeModel['slope'] * $nextX), 2);
        $rawPredictedExpense = round($expenseModel['intercept'] + ($expenseModel['slope'] * $nextX), 2);
        $predictedIncome = max(0.0, $rawPredictedIncome);
        $predictedExpense = max(0.0, $rawPredictedExpense);
        $fitAssessment = $this->assessFitQuality(count($monthly), $incomeModel['r_squared'], $expenseModel['r_squared']);

        return [
            'forecast_period' => $nextPeriod->format('Y-m'),
            'sample_months' => count($monthly),
            'predicted_income' => $predictedIncome,
            'predicted_expense' => $predictedExpense,
            'predicted_balance' => round($predictedIncome - $predictedExpense, 2),
            'raw_predicted_income' => $rawPredictedIncome,
            'raw_predicted_expense' => $rawPredictedExpense,
            'income_clamped' => $rawPredictedIncome < 0,
            'expense_clamped' => $rawPredictedExpense < 0,
            'income_model' => $incomeModel,
            'expense_model' => $expenseModel,
            'engine' => 'php-fallback',
            ...$fitAssessment,
        ];
    }

    private function localBudgetAdvice(array $payload): array
    {
        $income = (float) $payload['predicted_income'];
        $expense = (float) $payload['predicted_expense'];
        $currentAvailable = (float) $payload['current_available_budget'];
        $committed = (float) ($payload['committed_expenses'] ?? 0);
        $warningThreshold = (float) ($payload['warning_threshold'] ?? 0);
        $safetyRatio = (float) ($payload['safety_ratio'] ?? 0.8);

        $available = round($currentAvailable + $income - $expense - $committed, 2);
        $safeLimit = round(max(0, $available) * $safetyRatio, 2);
        $currentFunds = max(0, $currentAvailable);
        $recommendedAllocation = round(min($currentFunds, $safeLimit), 2);
        $reserveAmount = round(max(0, $currentFunds - $recommendedAllocation), 2);
        $ratio = $income > 0 ? round($expense / $income, 4) : null;
        $possibleDeficit = $available < 0;
        $forecastRisk = $possibleDeficit
            ? 'deficit'
            : (($expense > $income || ($ratio !== null && $ratio >= 0.9) || ($warningThreshold > 0 && $available <= $warningThreshold)) ? 'overspending' : 'stable');
        $overspendingRisk = $forecastRisk === 'stable' ? 'low' : ($forecastRisk === 'deficit' || $expense > $income ? 'high' : 'medium');

        // Status reflects actual financial risk, not merely whether the safety reserve
        // is being held back (holding a reserve during a stable forecast is normal).
        $allocationStatus = $recommendedAllocation <= 0
            ? 'no_funds'
            : (in_array($forecastRisk, ['deficit', 'overspending'], true) ? 'reduce_allocation' : 'within_limit');

        return [
            'estimated_available_budget' => $available,
            'safe_spending_limit' => $safeLimit,
            'recommended_allocation' => $recommendedAllocation,
            'reserve_amount' => $reserveAmount,
            'allocation_status' => $allocationStatus,
            'overspending_risk' => $overspendingRisk,
            'forecast_risk' => $forecastRisk,
            'possible_deficit' => $possibleDeficit,
            'expense_to_income_ratio' => $ratio,
            'advice' => $possibleDeficit
                ? 'A deficit is projected. Pause discretionary spending, review committed costs, and secure additional income before approving new expenses.'
                : ($forecastRisk === 'overspending'
                    ? 'Spending risk is elevated. Keep new commitments below the safe spending limit and reduce nonessential expenses.'
                    : 'The projection is stable. Keep new spending within the safe spending limit while preserving the safety reserve.'),
            'rules_applied' => ['Laravel deterministic fallback'],
        ];
    }

    private function validBudgetAdvice(?array $advice): bool
    {
        return is_array($advice)
            && is_numeric($advice['safe_spending_limit'] ?? null)
            && in_array($advice['forecast_risk'] ?? null, ['stable', 'overspending', 'deficit'], true);
    }

    private function financialSummary(string $period, float $income, float $expense, float $balance, float $safeLimit, string $risk): array
    {
        $fallback = $risk === 'deficit'
            ? "The {$period} forecast indicates a possible deficit. Reduce discretionary expenses and secure additional income before committing new funds. The safe spending limit is PHP ".number_format($safeLimit, 2).'.'
            : "The {$period} forecast is {$risk}. Expected income is PHP ".number_format($income, 2).', expected expenses are PHP '.number_format($expense, 2).', and the safe spending limit is PHP '.number_format($safeLimit, 2).'.';

        return $this->groq->generate(
            'Provide a concise, practical budget summary for a student organization. Do not alter any supplied figures.',
            "Period: {$period}; income: {$income}; expense: {$expense}; balance: {$balance}; safe limit: {$safeLimit}; risk: {$risk}.",
            220,
            0.2,
        ) ?? ['text' => $fallback, 'model' => 'deterministic-fallback'];
    }
}
