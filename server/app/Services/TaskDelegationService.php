<?php

namespace App\Services;

use App\Models\AccountProfile;
use App\Models\SboPosition;
use App\Models\Task;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

class TaskDelegationService
{
    // The one PHP copy of ai-service/app/engines/task_delegation.py POSITION_RELEVANCE_MAP;
    // TaskController's fallback and the event planner both score through this class.
    // Position names must match the seeded sbo_positions.title values.
    private const POSITION_RELEVANCE_MAP = [
        'finance' => [
            'keywords' => ['budget', 'financ', 'liquidat', 'receipt', 'audit', 'funds', 'funding', 'fundraising', 'expense', 'payment', 'treasury', 'reimburse', 'collection'],
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
            'keywords' => ['logistic', 'venue', 'equipment', 'setup', 'supplies', 'materials', 'booth', 'layout', 'transport', 'inventory'],
            'primary' => ['Business Manager', 'Vice President – Internal'],
            'secondary' => ['Vice President', 'President', 'Representative'],
        ],
        'coordination' => [
            'keywords' => ['coordinat', 'overall', 'program', 'hosting', 'host', 'emcee', 'planning', 'organize', 'oversee', 'lead'],
            'primary' => ['President', 'Vice President – Internal', 'Vice President – External', 'Vice President'],
            'secondary' => ['Business Manager', 'Secretary', 'Representative'],
        ],
    ];

    public const DEFAULT_TASK_AREA = 'coordination';

    private const PRIMARY_POSITION_MATCH_SCORE = 100.0;

    private const RELATED_POSITION_MATCH_SCORE = 70.0;

    private const UNRELATED_POSITION_SCORE = 40.0;

    private const UNKNOWN_POSITION_SCORE = 55.0;

    // Neutral prior for officers with no completed/overdue task history: neither
    // punishes new officers nor lets them outscore officers with a proven record.
    public const NEUTRAL_PERFORMANCE_SCORE = 70.0;

    private const TIER_PHRASE = [
        'primary' => 'a primary match',
        'secondary' => 'a related match',
        'unrelated' => 'not closely related',
        'unknown' => 'unspecified, so a neutral score was applied',
    ];

    /**
     * $preferredRole only steers which officer is recommended (the best-ranked
     * holder of that position, when one is eligible). It never changes a score,
     * so every officer's numbers match the Python engine and TaskController.
     */
    public function recommend(int $organizationId, string $taskTitle, ?string $taskType = null, ?string $preferredRole = null): array
    {
        $maxActive = max(1, (int) config('services.hiusa_ai.task_max_active_tasks', 5));
        $weights = $this->weights();
        $area = $this->inferArea($taskTitle, $taskType);

        $officers = $this->officerPool($organizationId);
        $activePositions = $this->activePositionTitles($organizationId);
        $stats = $this->officerStats($organizationId);

        $rankings = [];
        $ineligible = [];
        foreach ($officers as $officer) {
            $history = $this->statsFor($stats, $officer->school_id);
            $active = $history['active'];
            $canonical = $this->canonicalPosition($officer->position_title, $activePositions);
            $eligibilityResult = match (true) {
                ! $this->accountIsActive($officer) => 'inactive_account',
                trim((string) $officer->position_title) === '' => 'missing_position',
                $canonical === null => 'inactive_position',
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

            $completed = $history['completed'];
            $overdue = $history['overdue'];
            [$roleScore, $tier] = $this->roleScore($canonical, $area);
            $workloadScore = round(100 * (1 - ($active / $maxActive)), 2);
            $hasHistory = ($completed + $overdue) > 0;
            $performanceScore = $hasHistory ? round($completed / ($completed + $overdue) * 100, 2) : self::NEUTRAL_PERFORMANCE_SCORE;
            $daysSinceAssignment = $this->daysSince($history['last_assigned_at']);
            $recencyScore = $this->recencyScore($daysSinceAssignment);
            $total = round(
                ($weights['position'] * $roleScore)
                + ($weights['workload'] * $workloadScore)
                + ($weights['performance'] * $performanceScore)
                + ($weights['recency'] * $recencyScore),
                2
            );

            $ranking = [
                'officer_id' => $officer->school_id,
                'name' => trim("{$officer->first_name} {$officer->last_name}"),
                'position_title' => $canonical,
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
            $ranking['explanation'] = $this->explanation($ranking, $area, $hasHistory);
            $rankings[] = $ranking;
        }

        usort($rankings, fn (array $a, array $b) => $a['final_score'] === $b['final_score']
            ? $a['officer_id'] <=> $b['officer_id']
            : $b['final_score'] <=> $a['final_score']);
        foreach ($rankings as $index => &$ranking) {
            $ranking['rank'] = $index + 1;
        }
        unset($ranking);

        $recommended = $rankings[0]['officer_id'] ?? null;
        if ($preferredRole !== null && trim($preferredRole) !== '') {
            foreach ($rankings as $ranking) {
                if (SboPosition::normaliseTitle((string) $ranking['position_title']) === SboPosition::normaliseTitle($preferredRole)) {
                    $recommended = $ranking['officer_id'];
                    break;
                }
            }
        }

        return [
            'algorithm' => 'rule_based_weighted_scoring',
            'weights' => $weights,
            'task_area' => $area,
            'eligibility_rules' => $this->eligibilityRules($maxActive),
            'engine' => 'php-service',
            'recommended_officer_id' => $recommended,
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
        return $this->daysSince(Task::where('organization_id', $organizationId)->where('assigned_to', $officerId)->max('assigned_at'));
    }

    public function daysSince(?string $last): ?int
    {
        return $last === null ? null : (int) floor(Carbon::parse($last)->diffInDays(now(), true));
    }

    /**
     * Everyone holding an officer seat in the organization, read the way the rest of the app reads membership: through
     * the account profile, since an election hand over or an appointment moves the profile and leaves the users row behind.
     * Each user comes back with that profile active, so role, status and position are the profile's.
     *
     * @return Collection<int, User>
     */
    public function officerPool(int $organizationId): Collection
    {
        return AccountProfile::with(['user', 'organization'])
            ->where('account_profiles.organization_id', $organizationId)
            ->where('account_profiles.role', 'SBO_OFFICER')
            ->orderBy('account_profiles.user_school_id')
            ->get()
            ->filter(fn (AccountProfile $profile) => $profile->user !== null)
            ->map(function (AccountProfile $profile) {
                $profile->user->activateProfile($profile);

                return $profile->user;
            })
            ->values();
    }

    /** A profile and its account must both be active for the officer to be delegated work. */
    public function accountIsActive(User $officer): bool
    {
        return $officer->account_status === 'active' && $officer->getRawOriginal('account_status') === 'active';
    }

    /** @return array<int, string> */
    public function activePositionTitles(int $organizationId): array
    {
        return SboPosition::where('organization_id', $organizationId)
            ->where('role', 'SBO_OFFICER')
            ->where('is_active', true)
            ->pluck('title')
            ->all();
    }

    /**
     * The active position row an officer's saved title stands for: an exact match first, then the same
     * title once case, spacing and dash type are ignored (the way hand-overs and venue booking match seats).
     *
     * @param  list<string>  $activeTitles
     */
    public function canonicalPosition(?string $title, array $activeTitles): ?string
    {
        $title = trim((string) $title);
        if ($title === '') {
            return null;
        }
        if (in_array($title, $activeTitles, true)) {
            return $title;
        }
        $wanted = SboPosition::normaliseTitle($title);
        foreach ($activeTitles as $active) {
            if (SboPosition::normaliseTitle($active) === $wanted) {
                return $active;
            }
        }

        return null;
    }

    /**
     * Open, completed and overdue counts and the last assignment date for every assignee in one grouped query.
     *
     * @return array<int, array{active: int, completed: int, overdue: int, last_assigned_at: ?string}>
     */
    public function officerStats(int $organizationId): array
    {
        return Task::where('organization_id', $organizationId)
            ->whereNotNull('assigned_to')
            ->groupBy('assigned_to')
            ->selectRaw("assigned_to, SUM(CASE WHEN status IN ('pending', 'in_progress', 'overdue') THEN 1 ELSE 0 END) AS active_count, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count, SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END) AS overdue_count, MAX(assigned_at) AS last_assigned_at")
            ->get()
            ->mapWithKeys(fn ($row) => [(int) $row->assigned_to => [
                'active' => (int) $row->active_count,
                'completed' => (int) $row->completed_count,
                'overdue' => (int) $row->overdue_count,
                'last_assigned_at' => $row->last_assigned_at,
            ]])
            ->all();
    }

    /** @return array{active: int, completed: int, overdue: int, last_assigned_at: ?string} */
    public function statsFor(array $stats, int $officerId): array
    {
        return $stats[$officerId] ?? ['active' => 0, 'completed' => 0, 'overdue' => 0, 'last_assigned_at' => null];
    }

    /** The same rule list ai-service/app/engines/task_delegation.py returns, so every saved delegation reads alike. */
    public function eligibilityRules(int $maxActiveTasks): array
    {
        return [
            'role must be SBO_OFFICER',
            'account status must be active',
            'an SBO position must be assigned',
            'officer must be marked available',
            'officer must satisfy organization policy',
            "active task count must be below {$maxActiveTasks}",
        ];
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

    public function inferArea(string $title, ?string $type): string
    {
        // An area the Admin picked outright is the area; the title is only read when none was given.
        $chosen = strtolower(trim((string) $type));
        if (isset(self::POSITION_RELEVANCE_MAP[$chosen])) {
            return $chosen;
        }

        $haystack = strtolower($title.' '.($type ?? ''));
        foreach (self::POSITION_RELEVANCE_MAP as $area => $spec) {
            foreach ($spec['keywords'] as $keyword) {
                // Anchored at the START of a word only: the keywords are stem
                // prefixes ("financ", "promot") that must still match inflected
                // forms, and collision-prone ones are spelled out ("funds",
                // "funding", "fundraising" rather than a bare "fund").
                if (preg_match('/\b'.preg_quote($keyword, '/').'/', $haystack) === 1) {
                    return $area;
                }
            }
        }

        return self::DEFAULT_TASK_AREA;
    }

    /** @return array{0: float, 1: string} [score, tier] */
    public function roleScore(?string $position, string $area): array
    {
        $position = trim((string) $position);
        if ($position === '') {
            return [self::UNKNOWN_POSITION_SCORE, 'unknown'];
        }
        if (in_array($position, self::POSITION_RELEVANCE_MAP[$area]['primary'], true)) {
            return [self::PRIMARY_POSITION_MATCH_SCORE, 'primary'];
        }
        if (in_array($position, self::POSITION_RELEVANCE_MAP[$area]['secondary'], true)) {
            return [self::RELATED_POSITION_MATCH_SCORE, 'secondary'];
        }

        return [self::UNRELATED_POSITION_SCORE, 'unrelated'];
    }

    public function tierPhrase(string $tier): string
    {
        return self::TIER_PHRASE[$tier] ?? $tier;
    }

    /** The sentence ai-service/app/engines/task_delegation.py builds for a ranking row. */
    public function explanation(array $ranking, string $area, bool $hasHistory): string
    {
        $position = trim((string) $ranking['position_title']);
        $days = $ranking['days_since_last_assignment'] ?? null;

        return sprintf(
            "%s scored %.2f for a task inferred as '%s': position '%s' is %s for this area (%.2f pts), workload %.2f (%d/%d active tasks), past performance %.2f%s, and assignment recency %.2f (%s).",
            $ranking['name'],
            $ranking['final_score'],
            $area,
            $position !== '' ? $position : 'no position on file',
            $this->tierPhrase($ranking['position_tier']),
            $ranking['role_score'],
            $ranking['workload_score'],
            $ranking['active_tasks'],
            $ranking['max_active_tasks'],
            $ranking['performance_score'],
            $hasHistory ? '' : sprintf(' (no task history yet, so the neutral baseline of %d was used)', self::NEUTRAL_PERFORMANCE_SCORE),
            $ranking['recency_score'],
            $days === null ? 'never assigned a task here' : sprintf('last assigned %d day(s) ago', $days)
        );
    }
}
