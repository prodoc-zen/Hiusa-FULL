<?php

namespace App\Services;

use App\Models\SboPosition;
use App\Models\Task;
use App\Models\User;

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
            $total = round(
                ($weights['position'] * $roleScore)
                + ($weights['workload'] * $workloadScore)
                + ($weights['performance'] * $performanceScore),
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
                'final_score' => $total,
                'active_tasks' => $active,
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

    private function weights(): array
    {
        $weights = config('services.hiusa_ai.task_weights', []);
        $values = [
            'position' => (float) ($weights['position'] ?? 0.40),
            'workload' => (float) ($weights['workload'] ?? 0.35),
            'performance' => (float) ($weights['performance'] ?? 0.25),
        ];
        $sum = array_sum($values);

        return $sum > 0 ? array_map(fn (float $value) => round($value / $sum, 4), $values) : ['position' => 0.40, 'workload' => 0.35, 'performance' => 0.25];
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
