<?php

namespace App\Services\Dashboard;

use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Turns the output of HIUSA's existing deterministic engines into advisory
 * dashboard insights. This class never recomputes or triggers those engines
 * (budget advisory, OLS financial forecast) - it only reads what they
 * already persisted, plus two small self-contained formulas (task workload
 * balance and election turnout pace, reusing the same ratio
 * ElectionController::voters already computes). Wording is always advisory
 * ("may", "consider"); nothing here writes to the database.
 */
class DashboardInsightEngine
{
    public function __construct(private readonly ClientRouteAccess $routeAccess) {}

    /**
     * Up to 4 candidate insights for one organization. Callers slice to the
     * 0-3 the briefing contract allows. $role gates every insight's href
     * against config/client_routes.php so a role never receives a link to a
     * page it cannot open.
     *
     * @return array<int, array<string, mixed>>
     */
    public function forOrganization(int $organizationId, string $role, bool $includeTaskWorkload = true): array
    {
        $insights = [];

        if ($budget = $this->budgetRisk($organizationId, $role)) {
            $insights[] = $budget;
        }
        if ($turnout = $this->electionTurnoutPace($organizationId, $role)) {
            $insights[] = $turnout;
        }
        if ($includeTaskWorkload && ($workload = $this->taskWorkloadBalance($organizationId, $role))) {
            $insights[] = $workload;
        }
        if ($forecast = $this->forecastTrend($organizationId, $role)) {
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
    public function forUniversity(Collection $organizationIds, string $role = 'SUPER_ADMIN'): array
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
            'href' => $this->routeAccess->hrefFor($role, $role === 'SUPER_ADMIN' ? '/dashboard/super-admin/organizations' : '/dashboard/finance/budget-allocation'),
        ]];
    }

    private function budgetRisk(int $organizationId, string $role): ?array
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
            'generated_at' => $budget->advice_generated_at ? Carbon::parse($budget->advice_generated_at)->toIso8601String() : now()->toIso8601String(),
            'href' => $this->routeAccess->hrefFor($role, '/dashboard/finance/budget-allocation'),
        ];
    }

    /**
     * Forecasts generated by FinancialForecastController store "Y-m"; older and
     * seeded rows store a free-text label such as "Q4 2024 (Oct-Dec)". Only a
     * real "Y-m" is reformatted; anything else is shown as written.
     */
    private function periodLabel(string $period): string
    {
        return preg_match('/^\d{4}-\d{2}$/', $period) === 1
            ? Carbon::createFromFormat('!Y-m', $period)->format('F Y')
            : $period;
    }

    private function forecastTrend(int $organizationId, string $role): ?array
    {
        $forecast = DB::table('financial_forecasts')
            ->where('organization_id', $organizationId)
            ->orderByDesc('updated_at')
            ->orderByDesc('id')
            ->first();

        if (! $forecast) {
            return null;
        }

        $details = json_decode((string) $forecast->model_details, true) ?? [];
        $risk = $details['risk'] ?? 'stable';
        $period = $this->periodLabel((string) $forecast->forecast_period);

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
            'generated_at' => Carbon::parse($forecast->updated_at)->toIso8601String(),
            'href' => $this->routeAccess->hrefFor($role, '/dashboard/finance/financial-insights'),
        ];
    }

    /**
     * Whether task load is unevenly split across an organization's SBO
     * officers. This used to delegate to TaskDelegationService::recommend(),
     * which runs 3 separate queries (active/completed/overdue) per officer
     * purely to compute a delegation-style score irrelevant to this
     * yes/no-imbalance check; a single grouped count replaces that whole
     * per-officer fan-out.
     */
    private function taskWorkloadBalance(int $organizationId, string $role): ?array
    {
        $maxActive = max(1, (int) config('services.hiusa_ai.task_max_active_tasks', 5));

        // Membership in $organizationId is decided by account_profiles, not
        // users.organization_id: every user already has a profile row for
        // their home organization (kept in sync by User::booted()), and an
        // officer invited into a suborganization (AccountProfileController::
        // invite) holds an additional profile there while users.organization_id
        // still points at their original org. Same join UserController uses
        // to list an organization's members.
        $officers = DB::table('users')
            ->join('account_profiles as membership', 'membership.user_school_id', '=', 'users.school_id')
            ->where('membership.organization_id', $organizationId)
            ->where('membership.role', 'SBO_OFFICER')
            ->where('membership.account_status', 'active')
            ->whereNotNull('membership.position_title')
            ->where('membership.position_title', '!=', '')
            ->get(['users.school_id', 'users.first_name', 'users.last_name', 'membership.position_title as position_title']);

        if ($officers->count() < 2) {
            return null;
        }

        $activePositions = DB::table('sbo_positions')
            ->where('organization_id', $organizationId)
            ->where('role', 'SBO_OFFICER')
            ->where('is_active', true)
            ->pluck('title');

        $eligibleOfficers = $officers->filter(fn ($officer) => $activePositions->contains($officer->position_title))->values();

        if ($eligibleOfficers->count() < 2) {
            return null;
        }

        $officerIds = $eligibleOfficers->pluck('school_id');
        $activeStatuses = ['pending', 'in_progress', 'overdue'];

        $taskCountsByOfficer = DB::table('tasks')
            ->where('organization_id', $organizationId)
            ->whereIn('assigned_to', $officerIds)
            ->select('assigned_to', 'status', DB::raw('COUNT(*) as total'))
            ->groupBy('assigned_to', 'status')
            ->get()
            ->groupBy('assigned_to');

        $workloads = $eligibleOfficers->map(function ($officer) use ($taskCountsByOfficer, $maxActive, $activeStatuses) {
            $rows = $taskCountsByOfficer->get($officer->school_id, collect());
            $active = (int) $rows->whereIn('status', $activeStatuses)->sum('total');

            return [
                'officer_id' => $officer->school_id,
                'name' => trim("{$officer->first_name} {$officer->last_name}"),
                'active_tasks' => $active,
                'workload_score' => round(100 * (1 - min($active, $maxActive) / $maxActive), 2),
            ];
        })->filter(fn ($workload) => $workload['active_tasks'] < $maxActive)->values();

        if ($workloads->count() < 2) {
            return null;
        }

        $sorted = $workloads->sortBy('workload_score')->values();
        $busiest = $sorted->first();
        $freest = $sorted->last();
        $gap = (float) $freest['workload_score'] - (float) $busiest['workload_score'];

        if ($gap < 40) {
            return null;
        }

        return [
            'engine' => 'task_workload_balance',
            'title' => 'Task workload is unbalanced among officers',
            'body' => "{$busiest['name']} is carrying {$busiest['active_tasks']} active task(s) while {$freest['name']} has {$freest['active_tasks']}. Consider assigning the next task to a less loaded officer.",
            'why' => [
                'method' => 'Grouped active-task count per eligible officer (DashboardInsightEngine::taskWorkloadBalance)',
                'inputs' => [
                    'max_active_tasks' => $maxActive,
                    'busiest' => ['name' => $busiest['name'], 'active_tasks' => $busiest['active_tasks'], 'workload_score' => $busiest['workload_score']],
                    'freest' => ['name' => $freest['name'], 'active_tasks' => $freest['active_tasks'], 'workload_score' => $freest['workload_score']],
                ],
                'formula' => 'workload_score = 100 * (1 - active_tasks / max_active_tasks); flagged once the gap between the busiest and freest eligible officer reaches 40+ points.',
            ],
            'generated_at' => now()->toIso8601String(),
            'href' => $this->routeAccess->hrefFor($role, '/dashboard/tasks/task-board'),
        ];
    }

    private function electionTurnoutPace(int $organizationId, string $role): ?array
    {
        $election = DB::table('elections')
            ->where('organization_id', $organizationId)
            ->where('status', 'active')
            ->orderBy('end_time')
            ->first();

        if (! $election || ! $election->start_time || ! $election->end_time) {
            return null;
        }

        $start = Carbon::parse($election->start_time);
        $end = Carbon::parse($election->end_time);
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
            ->whereIn('role', ['ADMIN', 'SBO_OFFICER', 'STUDENT'])
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
            'href' => $this->routeAccess->hrefFor($role, '/dashboard/elections/election-results'),
        ];
    }
}
