<?php

namespace App\Services\Dashboard;

use App\Services\TaskDelegationService;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Turns the output of HIUSA's existing deterministic engines into advisory
 * dashboard insights. This class never recomputes or triggers those engines
 * (budget advisory, OLS financial forecast, weighted task delegation) - it
 * only reads what they already persisted, plus one small reused formula
 * (election turnout pace, reusing the same ratio ElectionController::voters
 * already computes). Wording is always advisory ("may", "consider"); nothing
 * here writes to the database.
 */
class DashboardInsightEngine
{
    public function __construct(private readonly TaskDelegationService $taskDelegation) {}

    /**
     * Up to 4 candidate insights for one organization. Callers slice to the
     * 0-3 the briefing contract allows.
     *
     * @return array<int, array<string, mixed>>
     */
    public function forOrganization(int $organizationId, bool $includeTaskWorkload = true): array
    {
        $insights = [];

        if ($budget = $this->budgetRisk($organizationId)) {
            $insights[] = $budget;
        }
        if ($turnout = $this->electionTurnoutPace($organizationId)) {
            $insights[] = $turnout;
        }
        if ($includeTaskWorkload && ($workload = $this->taskWorkloadBalance($organizationId))) {
            $insights[] = $workload;
        }
        if ($forecast = $this->forecastTrend($organizationId)) {
            $insights[] = $forecast;
        }

        return $insights;
    }

    /**
     * The single university-wide insight SUPER_ADMIN sees: how many
     * organizations currently carry a high-risk budget. Kept to one bounded
     * aggregate query so it never scales with total record volume.
     *
     * @param  Collection<int, int>  $organizationIds
     * @return array<int, array<string, mixed>>
     */
    public function forUniversity(Collection $organizationIds): array
    {
        $highRiskOrgs = DB::table('budgets')
            ->whereIn('organization_id', $organizationIds)
            ->where('overspending_risk', 'high')
            ->distinct()
            ->count('organization_id');

        if ($highRiskOrgs === 0) {
            return [];
        }

        return [[
            'engine' => 'budget_advisory',
            'title' => "{$highRiskOrgs} organization(s) show high budget risk",
            'body' => 'These organizations have at least one budget flagged high risk by the budget-advisory engine and may need a closer look before their next approval.',
            'why' => [
                'method' => 'Deterministic budget-advisory engine (BudgetController::advice), aggregated across organizations',
                'inputs' => ['organizations_at_high_risk' => $highRiskOrgs],
                'formula' => 'Counts distinct organizations with at least one budget where overspending_risk = high.',
            ],
            'generated_at' => now()->toIso8601String(),
            'href' => '/dashboard/super-admin/organizations',
        ]];
    }

    private function budgetRisk(int $organizationId): ?array
    {
        $budget = DB::table('budgets')
            ->where('organization_id', $organizationId)
            ->whereIn('overspending_risk', ['high', 'medium'])
            ->whereNotNull('advice_generated_at')
            ->orderByRaw("CASE overspending_risk WHEN 'high' THEN 0 ELSE 1 END")
            ->orderByDesc('advice_generated_at')
            ->first();

        if (! $budget) {
            return null;
        }

        return [
            'engine' => 'budget_advisory',
            'title' => "\"{$budget->title}\" is at {$budget->overspending_risk} overspending risk",
            'body' => (string) ($budget->advisory_note ?? 'This budget may need a closer look before approving new spending.'),
            'why' => [
                'method' => 'Deterministic budget-advisory engine (BudgetController::advice)',
                'inputs' => [
                    'allocated_amount' => (float) $budget->allocated_amount,
                    'remaining_amount' => (float) $budget->remaining_amount,
                    'warning_threshold' => (float) $budget->warning_threshold,
                    'safe_spending_limit' => $budget->safe_spending_limit !== null ? (float) $budget->safe_spending_limit : null,
                    'recommended_allocation' => $budget->recommended_allocation !== null ? (float) $budget->recommended_allocation : null,
                ],
                'formula' => 'available = current_available_budget + predicted_income - predicted_expense - committed_expenses; safe_spending_limit = max(0, available) * 0.8; risk escalates when predicted expense exceeds predicted income or available funds fall at/under the warning threshold.',
            ],
            'generated_at' => $budget->advice_generated_at ? \Illuminate\Support\Carbon::parse($budget->advice_generated_at)->toIso8601String() : now()->toIso8601String(),
            'href' => '/dashboard/finance/budget-allocation',
        ];
    }

    private function forecastTrend(int $organizationId): ?array
    {
        $forecast = DB::table('financial_forecasts')
            ->where('organization_id', $organizationId)
            ->orderByDesc('forecast_period')
            ->first();

        if (! $forecast) {
            return null;
        }

        $details = json_decode((string) $forecast->model_details, true) ?? [];
        $risk = $details['risk'] ?? 'stable';
        $period = \Illuminate\Support\Carbon::createFromFormat('Y-m-d', $forecast->forecast_period.'-01')->format('F Y');

        return [
            'engine' => 'financial_forecast',
            'title' => "Financial forecast for {$period}: {$risk}",
            'body' => (string) ($forecast->confidence_note ?? "The {$period} forecast is {$risk}."),
            'why' => [
                'method' => 'Ordinary least squares trend fit over monthly income and expense history (FinancialForecastController::generate)',
                'inputs' => [
                    'sample_months' => $details['sample_months'] ?? null,
                    'fit_quality' => $details['fit_quality'] ?? null,
                    'income_r_squared' => $details['income']['r_squared'] ?? null,
                    'expense_r_squared' => $details['expense']['r_squared'] ?? null,
                ],
                'formula' => 'Each series is fit as y = intercept + slope * month_index by ordinary least squares; the next month is projected from that line and clamped at zero.',
            ],
            'generated_at' => \Illuminate\Support\Carbon::parse($forecast->updated_at)->toIso8601String(),
            'href' => '/dashboard/finance/financial-insights',
        ];
    }

    private function taskWorkloadBalance(int $organizationId): ?array
    {
        $recommendation = $this->taskDelegation->recommend($organizationId, 'General organizational coordination task');
        $rankings = collect($recommendation['rankings'] ?? []);

        if ($rankings->count() < 2) {
            return null;
        }

        $busiest = $rankings->first();
        $freest = $rankings->last();
        $gap = (float) $busiest['workload_score'] - (float) $freest['workload_score'];

        if ($gap < 40) {
            return null;
        }

        return [
            'engine' => 'task_workload_balance',
            'title' => 'Task workload is unbalanced among officers',
            'body' => "{$busiest['name']} is carrying {$busiest['active_tasks']} active task(s) while {$freest['name']} has {$freest['active_tasks']}. Consider assigning the next task to a less loaded officer.",
            'why' => [
                'method' => 'Rule-based weighted scoring (TaskDelegationService::recommend)',
                'inputs' => [
                    'weights' => $recommendation['weights'],
                    'busiest' => ['name' => $busiest['name'], 'active_tasks' => $busiest['active_tasks'], 'workload_score' => $busiest['workload_score']],
                    'freest' => ['name' => $freest['name'], 'active_tasks' => $freest['active_tasks'], 'workload_score' => $freest['workload_score']],
                ],
                'formula' => 'workload_score = 100 * (1 - active_tasks / max_active_tasks); final_score = position_weight*role_score + workload_weight*workload_score + performance_weight*performance_score.',
            ],
            'generated_at' => now()->toIso8601String(),
            'href' => '/dashboard/tasks/task-board',
        ];
    }

    private function electionTurnoutPace(int $organizationId): ?array
    {
        $election = DB::table('elections')
            ->where('organization_id', $organizationId)
            ->where('status', 'active')
            ->orderBy('end_time')
            ->first();

        if (! $election || ! $election->start_time || ! $election->end_time) {
            return null;
        }

        $start = \Illuminate\Support\Carbon::parse($election->start_time);
        $end = \Illuminate\Support\Carbon::parse($election->end_time);
        $totalWindow = $end->timestamp - $start->timestamp;

        if ($totalWindow <= 0) {
            return null;
        }

        $elapsedPercent = max(0, min(100, ((now()->timestamp - $start->timestamp) / $totalWindow) * 100));

        if ($elapsedPercent < 20) {
            return null;
        }

        $eligibleTotal = DB::table('users')
            ->where('organization_id', $organizationId)
            ->where('account_status', 'active')
            ->whereIn('role', ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'])
            ->count();
        $votedCount = DB::table('votes')->where('election_id', $election->id)->distinct()->count('voter_id');
        $turnoutPercent = $eligibleTotal > 0 ? ($votedCount / $eligibleTotal) * 100 : 0;

        if ($turnoutPercent >= $elapsedPercent - 15) {
            return null;
        }

        return [
            'engine' => 'election_turnout_pace',
            'title' => 'Election turnout is trailing pace',
            'body' => sprintf(
                'With %s%% of the voting window elapsed, only %s%% of eligible voters have cast a ballot for "%s". A reminder push may help before it closes.',
                round($elapsedPercent), round($turnoutPercent, 1), $election->title
            ),
            'why' => [
                'method' => 'Turnout pace comparison (turnout formula reused from ElectionController::voters)',
                'inputs' => [
                    'eligible_total' => $eligibleTotal,
                    'voted_count' => $votedCount,
                    'turnout_percent' => round($turnoutPercent, 1),
                    'elapsed_percent' => round($elapsedPercent, 1),
                    'start_time' => $start->toIso8601String(),
                    'end_time' => $end->toIso8601String(),
                ],
                'formula' => 'turnout_percent = voted_count / eligible_total * 100; elapsed_percent = (now - start_time) / (end_time - start_time) * 100; flagged once 20%+ of the window has elapsed and turnout trails elapsed pace by 15+ points.',
            ],
            'generated_at' => now()->toIso8601String(),
            'href' => '/dashboard/elections/election-results',
        ];
    }
}
