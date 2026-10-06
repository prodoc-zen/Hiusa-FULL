<?php

namespace App\Services\Objectives;

use App\Models\User;
use App\Services\Dashboard\ClientRouteAccess;
use Carbon\CarbonInterface;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Live evidence that each objective of the study is being met, counted from
 * real records at the viewer's scope (their organization, or the whole
 * university for SUPER_ADMIN). Nothing is estimated or padded: a zero is
 * reported as zero.
 *
 * Every metric is one aggregate query, so the query count does not grow with
 * the size of an organization. Finance evidence for SUPER_ADMIN deliberately
 * avoids ledger rows (the SAO has no ledger access) and counts forecasts,
 * advisories and approved financial reports instead.
 */
class ObjectivesEvidenceService
{
    private const LIVE_WINDOW_DAYS = 90;

    /** @var callable(string): ?string */
    private $href;

    public function __construct(private readonly ClientRouteAccess $routes)
    {
    }

    public function overview(User $viewer): array
    {
        $isSao = $viewer->role === 'SUPER_ADMIN';
        $orgId = $isSao ? null : $viewer->organization_id;
        $this->href = fn (string $path): ?string => $this->routes->hrefFor($viewer->role, $path);

        return [
            'scope' => $isSao
                ? ['type' => 'university', 'organization' => null]
                : ['type' => 'organization', 'organization' => $this->organization($orgId)],
            'objectives' => [
                $this->generalObjective($orgId, $isSao),
                $this->so1(),
                $this->financial($orgId, $isSao),
                $this->events($orgId),
                $this->tasks($orgId),
                $this->elections($orgId),
                $this->merchandise($orgId),
                $this->communication($orgId, $isSao),
                $this->so3($orgId),
                $this->so4(),
            ],
        ];
    }

    private function generalObjective(?int $orgId, bool $isSao): array
    {
        $evidence = [];
        if ($isSao) {
            $evidence[] = $this->metric('Organizations onboarded', DB::table('organizations')
                ->where(fn (Builder $q) => $q->whereNull('organization_type')->orWhere('organization_type', '!=', 'SYSTEM_ADMINISTRATION'))
                ->count(), 'count', '/dashboard/super-admin/organizations');
        }
        $evidence[] = $this->metric('Active member accounts', $this->scoped(DB::table('users'), $orgId)
            ->where('account_status', 'active')->count(), 'count', null);

        return $this->objective(
            'GO',
            'A centralized, AI-integrated platform',
            'Analyze, design, develop, test and evaluate a student body organization management system that uses AI-integrated functionalities to improve financial management, event and task coordination, elections, merchandise management and organizational communication through one centralized platform.',
            'One platform for every organization, with role-based access and organization-scoped data.',
            $evidence,
            $this->latest($this->scoped(DB::table('audit_logs'), $orgId), 'created_at'),
        );
    }

    private function so1(): array
    {
        return $this->objective(
            'SO1',
            'Assess current practices and problems',
            'Identify and assess the current student governance and financial management practices of student body organizations, according to their processes and the problems they encounter.',
            'Assessed through the study research process outside the application.',
            [],
            null,
        );
    }

    private function financial(?int $orgId, bool $isSao): array
    {
        $evidence = [
            $this->metric('Expense forecasts generated (OLS regression)', $this->scoped(DB::table('financial_forecasts'), $orgId)->count(), 'count', '/dashboard/finance/financial-insights'),
            $this->metric('Budget advisories issued', $this->scoped(DB::table('budgets'), $orgId)->whereNotNull('overspending_risk')->count(), 'count', '/dashboard/finance/budget-allocation'),
            $this->metric('AI financial summaries', $this->aiOutputs($orgId, 'FINANCIAL_SUMMARY')->count(), 'count', null),
        ];

        if ($isSao) {
            $evidence[] = $this->metric('Financial reports approved', DB::table('financial_reports')->where('submission_status', 'approved')->count(), 'count', '/dashboard/super-admin/financial-reports');
        } else {
            $transactions = $this->scoped(DB::table('transactions'), $orgId);
            $evidence[] = $this->metric('Transactions recorded in the ledger', (clone $transactions)->count(), 'count', '/dashboard/finance/transaction-history');
            $evidence[] = $this->metric('Digital receipts issued', (clone $transactions)->whereNotNull('receipt_reference')->count(), 'count', '/dashboard/finance/personal-receipts');
        }

        return $this->objective(
            'SO2.1',
            'Financial management',
            'Determine the mechanisms or techniques for AI-integrated financial management.',
            'Ordinary Least Squares regression forecasting and the Budget Advisory System, explained in plain language.',
            $evidence,
            $this->latest($this->scoped(DB::table('financial_forecasts'), $orgId), 'created_at'),
        );
    }

    private function events(?int $orgId): array
    {
        $scopedEventIds = $this->scoped(DB::table('events'), $orgId)->select('id');
        $attendance = DB::table('attendance')->whereIn('event_id', $scopedEventIds);

        return $this->objective(
            'SO2.2',
            'Event management',
            'Determine the mechanisms or techniques for AI-integrated event management.',
            'Event Planning Assistant (LLM) and biometric attendance through the DigitalPersona fingerprint reader.',
            [
                $this->metric('AI event plans generated', $this->aiOutputs($orgId, 'EVENT_WORKFLOW')->count(), 'count', '/dashboard/events/event-planner'),
                $this->metric('Events completed', $this->scoped(DB::table('events'), $orgId)->where('status', 'completed')->count(), 'count', '/dashboard/events/activity-calendar'),
                $this->metric('Check-ins by fingerprint', (clone $attendance)->where('method', 'biometric')->count(), 'count', '/dashboard/events/check-in'),
                $this->metric('Check-ins recorded manually', (clone $attendance)->where('method', '!=', 'biometric')->count(), 'count', '/dashboard/events/check-in'),
            ],
            $this->latest(DB::table('attendance')->whereIn('event_id', $this->scoped(DB::table('events'), $orgId)->select('id')), 'check_in_time'),
        );
    }

    private function tasks(?int $orgId): array
    {
        $recommendations = $this->scoped(DB::table('task_recommendations'), $orgId);

        return $this->objective(
            'SO2.3',
            'Task management',
            'Determine the mechanisms or techniques for AI-integrated task management.',
            'Rule-Based Weighted Scoring of role relevance, workload and past performance, with a decision-support ranking an officer can override.',
            [
                $this->metric('Officer scores calculated for delegation', (clone $recommendations)->count(), 'count', '/dashboard/tasks/ai-delegation'),
                $this->metric('Tasks delegated with a recorded ranking', $this->scoped(DB::table('tasks'), $orgId)->whereNotNull('delegation_snapshot')->count(), 'count', '/dashboard/tasks/task-board'),
                $this->metric('AI delegation explanations', $this->aiOutputs($orgId, 'TASK_EXPLANATION')->count(), 'count', null),
            ],
            $this->latest($recommendations, 'calculated_at'),
        );
    }

    private function elections(?int $orgId): array
    {
        $electionIds = $this->scoped(DB::table('elections'), $orgId)->select('id');
        $latestClosedId = $this->scoped(DB::table('elections'), $orgId)->where('status', 'closed')->orderByDesc('end_time')->value('id');

        return $this->objective(
            'SO2.4',
            'Elections',
            'Determine the mechanisms or techniques for AI-integrated elections.',
            'One-vote enforcement per position, automated tallying and real-time results.',
            [
                $this->metric('Elections completed with automated tallies', $this->scoped(DB::table('elections'), $orgId)->where('status', 'closed')->count(), 'count', '/dashboard/elections/election-results'),
                $this->metric('Votes cast', DB::table('votes')->whereIn('election_id', $electionIds)->count(), 'count', '/dashboard/elections'),
                $this->metric('Voters in the latest completed election', $latestClosedId ? DB::table('votes')->where('election_id', $latestClosedId)->distinct()->count('voter_id') : 0, 'count', '/dashboard/elections/election-results'),
            ],
            $this->latest(DB::table('votes')->whereIn('election_id', $this->scoped(DB::table('elections'), $orgId)->select('id')), 'cast_at'),
        );
    }

    private function merchandise(?int $orgId): array
    {
        $orders = $this->scoped(DB::table('orders'), $orgId);

        return $this->objective(
            'SO2.5',
            'Merchandise management',
            'Determine the mechanisms or techniques for AI-integrated merchandise management.',
            'Tokenized claim references and verified GCash proof of payment.',
            [
                $this->metric('Orders placed', (clone $orders)->count(), 'count', '/dashboard/merchandise/manage-orders'),
                $this->metric('Claim tokens issued', (clone $orders)->whereNotNull('claim_token')->count(), 'count', '/dashboard/merchandise/claim-tokens'),
                $this->metric('Orders claimed with a token', (clone $orders)->where('status', 'claimed')->count(), 'count', '/dashboard/merchandise/claim-tokens'),
                $this->metric('GCash payments verified', (clone $orders)->where('payment_method', 'gcash')->whereNotNull('payment_proof_url')->where('officer_review_status', 'approved')->count(), 'count', '/dashboard/merchandise/manage-orders'),
            ],
            $this->latest($orders, 'created_at'),
        );
    }

    private function communication(?int $orgId, bool $isSao): array
    {
        return $this->objective(
            'SO2.6',
            'Organizational communication',
            'Determine the mechanisms or techniques for AI-integrated organizational communication.',
            'AI announcement drafting (LLM) with human review, and automated notifications.',
            [
                $this->metric('Announcements published', $this->scoped(DB::table('announcements'), $orgId)->where('is_published', true)->count(), 'count', $isSao ? '/dashboard/super-admin/announcements' : '/dashboard/announcements/view-announcements'),
                $this->metric('AI-drafted announcements', $this->aiOutputs($orgId, 'ANNOUNCEMENT_DRAFT')->count(), 'count', '/dashboard/announcements/manage-announcements'),
                $this->metric('Notifications delivered', $this->scoped(DB::table('notifications'), $orgId)->count(), 'count', null),
            ],
            $this->latest($this->scoped(DB::table('announcements'), $orgId)->where('is_published', true), 'created_at'),
        );
    }

    private function so3(?int $orgId): array
    {
        $since = Carbon::now()->subDays(self::LIVE_WINDOW_DAYS);
        $modules = $this->scoped(DB::table('audit_logs'), $orgId)->where('module', '!=', 'evaluation')->where('created_at', '>=', $since)->distinct()->count('module');

        return $this->objective(
            'SO3',
            'The best features, in use',
            'Define and develop the best features of the proposed AI-integrated student governance and financial management system.',
            'Every feature records an accountable audit trail; this counts the modules with real activity in the last 90 days.',
            [$this->metric('Modules with activity in the last 90 days', $modules, 'count', null)],
            $this->latest($this->scoped(DB::table('audit_logs'), $orgId), 'created_at'),
        );
    }

    private function so4(): array
    {
        return $this->objective(
            'SO4',
            'Evaluate acceptability',
            'Evaluate the level of acceptability of the proposed system.',
            'Assessed through the study research process outside the application.',
            [],
            null,
        );
    }

    private function objective(string $code, string $title, string $statement, string $mechanism, array $evidence, ?CarbonInterface $lastActivity): array
    {
        $hasEvidence = collect($evidence)->contains(fn (array $item) => (float) $item['value'] > 0);
        $recent = $lastActivity && $lastActivity->greaterThanOrEqualTo(Carbon::now()->subDays(self::LIVE_WINDOW_DAYS));

        return [
            'code' => $code,
            'title' => $title,
            'statement' => $statement,
            'mechanism' => $mechanism,
            'status' => ! $hasEvidence ? 'no_data' : ($recent ? 'live' : 'partial'),
            'evidence' => $evidence,
            'last_activity_at' => $lastActivity?->toIso8601String(),
        ];
    }

    private function metric(string $label, int|float|null $value, string $unit, ?string $path): array
    {
        return [
            'label' => $label,
            'value' => $value ?? 0,
            'unit' => $unit,
            'href' => $path ? ($this->href)($path) : null,
        ];
    }

    private function scoped(Builder $query, ?int $orgId): Builder
    {
        return $orgId === null ? $query : $query->where('organization_id', $orgId);
    }

    private function aiOutputs(?int $orgId, string $featureType): Builder
    {
        return $this->scoped(DB::table('ai_outputs'), $orgId)->where('feature_type', $featureType);
    }

    private function latest(Builder $query, string $column): ?CarbonInterface
    {
        $value = (clone $query)->max($column);

        return $value ? Carbon::parse($value) : null;
    }

    private function organization(?int $orgId): ?array
    {
        $organization = DB::table('organizations')->where('id', $orgId)->first(['id', 'name']);

        return $organization ? ['id' => $organization->id, 'name' => $organization->name] : null;
    }
}
