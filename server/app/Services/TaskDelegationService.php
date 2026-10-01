<?php

namespace App\Services;

use App\Models\SboPosition;
use App\Models\Task;
use App\Models\User;
use Illuminate\Support\Carbon;

class TaskDelegationService
{
    private const POSITION_RELEVANCE_MAP = [
        'finance' => [
            'keywords' => ['budget', 'financ', 'liquidat', 'receipt', 'audit', 'funds', 'funding', 'expense', 'payment', 'treasury', 'collection'],
            'primary' => ['Treasurer', 'Auditor'],
            'secondary' => ['President', 'Business Manager'],
        ],
        'publicity' => [
            'keywords' => ['publicity', 'announce', 'social media', 'poster', 'promot', 'marketing', 'campaign', 'press release', 'media'],
            'primary' => ['Public Information Officer', 'Public Relations Officer'],
            'secondary' => ['Secretary', 'Vice President – External', 'Vice President'],
        ],
        'documentation' => [
            'keywords' => ['document', 'minutes', 'attendance record', 'report', 'record', 'memo', 'correspondence', 'certificate', 'letter'],
            'primary' => ['Secretary', 'Assistant Secretary'],
            'secondary' => ['Auditor', 'Vice President – Internal', 'Vice President'],
        ],
        'logistics' => [
            'keywords' => ['logistic', 'venue', 'equipment', 'setup', 'supplies', 'materials', 'booth', 'layout', 'transport', 'inventory', 'vendor'],
            'primary' => ['Business Manager', 'Vice President – Internal'],
            'secondary' => ['Vice President', 'President', 'Representative'],
        ],
        'coordination' => [
            'keywords' => ['coordinat', 'overall', 'program', 'hosting', 'host', 'planning', 'organize', 'oversee', 'lead'],
            'primary' => ['President', 'Vice President – Internal', 'Vice President – External', 'Vice President'],
            'secondary' => ['Business Manager', 'Secretary', 'Representative'],
        ],
    ];

    public function recommend(int $organizationId, string $taskTitle, ?string $taskType = null, ?string $preferredRole = null): array
    {
        $maxActive = max(1, (int) config('services.hiusa_ai.task_max_active_tasks', 5));
        $weights = $this->weights();
        $area = $this->inferArea($taskTitle, $taskType);

        $officers = User::where('users.organization_id', $organizationId)
            ->where('users.role', 'SBO_OFFICER')
            ->orderBy('users.school_id')
            ->get();
        $activePositions = SboPosition::where('organization_id', $organizationId)
            ->where('role', 'SBO_OFFICER')
            ->where('is_active', true)
            ->pluck('title')
            ->all();

        $rankings = [];
        $ineligible = [];
        foreach ($officers as $officer) {
            $base = Task::where('organization_id', $organizationId)->where('assigned_to', $officer->school_id);
            $active = (clone $base)->whereIn('status', ['pending', 'in_progress', 'overdue'])->count();
            $eligibilityResult = match (true) {
                $officer->account_status !== 'active' => 'inactive_account',
                trim((string) $officer->position_title) === '' => 'missing_position',
                ! in_array($officer->position_title, $activePositions, true) => 'inactive_position',
                $active >= $maxActive => 'overloaded',
                default => 'eligible',
            };
            if ($eligibilityResult !== 'eligible') {
                $ineligible[] = [
                    'officer_id' => $officer->school_id,
                    'name' => trim("{$officer->first_name} {$officer->last_name}"),
                    'position_title' => $officer->position_title,
                    'position_tier' => null,
                    'role_score' => null,
                    'workload_score' => null,
                    'performance_score' => null,
                    'recency_score' => null,
                    'final_score' => null,
                    'active_tasks' => $active,
                    'max_active_tasks' => $maxActive,
                    'rank' => null,
                    'eligibility_result' => $eligibilityResult,
                ];

                continue;
            }

            $completed = (clone $base)->where('status', 'completed')->count();
            $overdue = (clone $base)->where('status', 'overdue')->count();
            [$roleScore, $tier] = $this->roleScore($officer->position_title, $area, $preferredRole);
            $workloadScore = round(100 * (1 - ($active / $maxActive)), 2);
            $performanceScore = ($completed + $overdue) > 0 ? round($completed / ($completed + $overdue) * 100, 2) : 70.0;
            $daysSinceAssignment = $this->daysSinceLastAssignment($organizationId, $officer->school_id);
            $recencyScore = $this->recencyScore($daysSinceAssignment);
            $total = round(
                ($weights['position'] * $roleScore)
                + ($weights['workload'] * $workloadScore)
                + ($weights['performance'] * $performanceScore)
                + ($weights['recency'] * $recencyScore),
                2
            );

            $rankings[] = [
                'officer_id' => $officer->school_id,
                'name' => trim("{$officer->first_name} {$officer->last_name}"),
                'position_title' => $officer->position_title,
                'position_tier' => $tier,
                'role_score' => $roleScore,
                'workload_score' => $workloadScore,
                'performance_score' => $performanceScore,
                'recency_score' => $recencyScore,
                'final_score' => $total,
                'active_tasks' => $active,
                'days_since_last_assignment' => $daysSinceAssignment,
                'max_active_tasks' => $maxActive,
                'eligibility_result' => 'eligible',
            ];
        }

        usort($rankings, fn (array $a, array $b) => $a['final_score'] === $b['final_score']
            ? $a['officer_id'] <=> $b['officer_id']
            : $b['final_score'] <=> $a['final_score']);
        foreach ($rankings as $index => &$ranking) {
            $ranking['rank'] = $index + 1;
        }

        return [
            'algorithm' => 'rule_based_weighted_scoring',
            'weights' => $weights,
            'task_area' => $area,
            'eligibility_rules' => [
                'required_role' => 'SBO_OFFICER',
                'required_account_status' => 'active',
                'requires_active_position' => true,
                'max_active_tasks' => $maxActive,
            ],
            'recommended_officer_id' => $rankings[0]['officer_id'] ?? null,
            'rankings' => $rankings,
            'evaluations' => [...$rankings, ...$ineligible],
        ];
    }

    /**
     * The four delegation weights (role, workload, performance, recency),
     * normalized to sum to 1 so a misconfigured env never skews the scale.
     */
    public function weights(): array
    {
        $defaults = ['position' => 0.35, 'workload' => 0.30, 'performance' => 0.20, 'recency' => 0.15];
        $configured = config('services.hiusa_ai.task_weights', []);
        $values = [];
        foreach ($defaults as $key => $default) {
            $values[$key] = (float) ($configured[$key] ?? $default);
        }
        $sum = array_sum($values);

        return $sum > 0 ? array_map(fn (float $value) => round($value / $sum, 4), $values) : $defaults;
    }

    /** Whole days since this officer was last handed a task here; null when never. */
    public function daysSinceLastAssignment(int $organizationId, int $officerId): ?int
    {
        $last = Task::where('organization_id', $organizationId)->where('assigned_to', $officerId)->max('assigned_at');

        return $last === null ? null : (int) floor(Carbon::parse($last)->diffInDays(now(), true));
    }

    /** Officers not handed work recently score higher, spreading delegation over time. */
    public function recencyScore(?int $daysSinceAssignment): float
    {
        if ($daysSinceAssignment === null) {
            return 100.0;
        }

        return round(min(1, $daysSinceAssignment / $this->recencyWindowDays()) * 100, 2);
    }

    public function recencyWindowDays(): int
    {
        return max(1, (int) config('services.hiusa_ai.task_recency_window_days', 14));
    }

    private function inferArea(string $title, ?string $type): string
    {
        $haystack = strtolower($title.' '.($type ?? ''));
        foreach (self::POSITION_RELEVANCE_MAP as $area => $spec) {
            foreach ($spec['keywords'] as $keyword) {
                if (preg_match('/\b'.preg_quote($keyword, '/').'/', $haystack) === 1) {
                    return $area;
                }
            }
        }

        return 'coordination';
    }

    private function roleScore(?string $position, string $area, ?string $preferredRole): array
    {
        $position = trim((string) $position);
        if ($preferredRole && strcasecmp($position, trim($preferredRole)) === 0) {
            return [100.0, 'primary'];
        }
        if (in_array($position, self::POSITION_RELEVANCE_MAP[$area]['primary'], true)) {
            return [100.0, 'primary'];
        }
        if (in_array($position, self::POSITION_RELEVANCE_MAP[$area]['secondary'], true)) {
            return [70.0, 'secondary'];
        }

        return [40.0, 'unrelated'];
    }
}
