<?php

namespace App\Services;

// Mirrors ai-service/app/engines/budget_advisory.py - keep in sync (AiFallbackParityTest compares them).
class BudgetAdviceRules
{
    public static function riskFor(float $available, float $warningThreshold): string
    {
        return self::evaluate([
            'predicted_income' => 0,
            'predicted_expense' => 0,
            'current_available_budget' => $available,
            'warning_threshold' => $warningThreshold,
        ])['overspending_risk'];
    }

    public static function isStale(?array $storedInputs, float $remaining, float $warningThreshold): bool
    {
        return ! isset($storedInputs['current_available_budget'], $storedInputs['warning_threshold'])
            || abs((float) $storedInputs['current_available_budget'] - $remaining) > 0.005
            || abs((float) $storedInputs['warning_threshold'] - $warningThreshold) > 0.005;
    }

    public static function evaluate(array $payload): array
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

        if ($possibleDeficit) {
            $risk = 'high';
            $forecastRisk = 'deficit';
            $advice = 'A deficit is projected. Pause discretionary spending, review committed costs, and secure additional income before approving new expenses.';
        } elseif ($expense > $income || ($warningThreshold > 0 && $available <= $warningThreshold)) {
            $risk = 'high';
            $forecastRisk = 'overspending';
            $advice = 'Overspending risk is high. Keep new commitments below the safe spending limit and reduce nonessential expenses.';
        } elseif ($ratio !== null && $ratio >= 0.9) {
            $risk = 'medium';
            $forecastRisk = 'overspending';
            $advice = 'Expenses are close to forecast income. Use the safe spending limit as the cap for new commitments and monitor the ledger frequently.';
        } else {
            $risk = 'low';
            $forecastRisk = 'stable';
            $advice = 'The projection is stable. New spending should remain at or below the safe spending limit while preserving the configured safety reserve.';
        }

        // Status reflects actual financial risk, not merely whether the safety reserve
        // is being held back (holding a reserve during a stable forecast is normal).
        $allocationStatus = $recommendedAllocation <= 0
            ? 'no_funds'
            : ($forecastRisk === 'stable' ? 'within_limit' : 'reduce_allocation');

        return [
            'estimated_available_budget' => $available,
            'safe_spending_limit' => $safeLimit,
            'recommended_allocation' => $recommendedAllocation,
            'reserve_amount' => $reserveAmount,
            'allocation_status' => $allocationStatus,
            'overspending_risk' => $risk,
            'forecast_risk' => $forecastRisk,
            'possible_deficit' => $possibleDeficit,
            'expense_to_income_ratio' => $ratio,
            'advice' => $advice,
            'rules_applied' => ['Laravel deterministic fallback'],
        ];
    }
}
