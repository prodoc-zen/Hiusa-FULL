<?php

namespace App\Http\Controllers;

use App\Models\Event;
use App\Models\Notification;
use App\Models\Task;
use App\Models\TaskProgressUpdate;
use App\Models\User;
use App\Services\GroqResponsesService;
use App\Services\HiusaAiService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class TaskController extends Controller
{
    private array $aiAssignmentScores = [];

    private array $aiAssignmentExplanations = [];

    // Mirrors ai-service/app/engines/task_delegation.py WEIGHTS - keep these in sync.
    private const WEIGHTS = ['position' => 0.40, 'workload' => 0.35, 'performance' => 0.25];

    // Mirrors ai-service/app/engines/task_delegation.py POSITION_RELEVANCE_MAP.
    // Position names must match the seeded sbo_positions.title values.
    private const POSITION_RELEVANCE_MAP = [
        'finance' => [
            'keywords' => ['budget', 'financ', 'liquidat', 'receipt', 'audit', 'funds', 'funding', 'fundraising', 'expense', 'payment', 'treasury', 'reimburse', 'collection'],
            'primary' => ['Treasurer', 'Auditor'],
            'secondary' => ['President', 'Business Manager'],
        ],
        'publicity' => [
            'keywords' => ['publicity', 'announce', 'social media', 'poster', 'promot', 'marketing', 'campaign', 'press release', 'media'],
            'primary' => ['Public Relations Officer'],
            'secondary' => ['Secretary', 'Vice President'],
        ],
        'documentation' => [
            'keywords' => ['document', 'minutes', 'attendance record', 'report', 'record', 'memo', 'correspondence', 'certificate', 'letter'],
            'primary' => ['Secretary'],
            'secondary' => ['Auditor', 'Vice President'],
        ],
        'logistics' => [
            'keywords' => ['logistic', 'venue', 'equipment', 'setup', 'supplies', 'materials', 'booth', 'layout', 'transport', 'inventory'],
            'primary' => ['Business Manager'],
            'secondary' => ['Vice President', 'President'],
        ],
        'coordination' => [
            'keywords' => ['coordinat', 'overall', 'program', 'hosting', 'host', 'emcee', 'planning', 'organize', 'oversee', 'lead'],
            'primary' => ['President', 'Vice President'],
            'secondary' => ['Business Manager', 'Secretary'],
        ],
    ];

    private const DEFAULT_TASK_AREA = 'coordination';

    private const PRIMARY_POSITION_MATCH_SCORE = 100.0;

    private const RELATED_POSITION_MATCH_SCORE = 70.0;

    private const UNRELATED_POSITION_SCORE = 40.0;

    private const UNKNOWN_POSITION_SCORE = 55.0;

    // Neutral prior for officers with no completed/overdue task history - neither
    // punishes new officers nor lets them outscore officers with a proven record.
    private const NEUTRAL_PERFORMANCE_SCORE = 70.0;

    // Mirrors ai-service/app/engines/task_delegation.py _TIER_PHRASE.
    private const TIER_PHRASE = [
        'primary' => 'a primary match',
        'secondary' => 'a related match',
        'unrelated' => 'not closely related',
        'unknown' => 'unspecified, so a neutral score was applied',
    ];

    private ?array $lastDelegation = null;

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

        $query = Task::with([
            'assignee:school_id,first_name,last_name,email,role,position_title,department,program,major,year_level,section',
            'creator:school_id,first_name,last_name,role,position_title',
            'event:id,title',
            'progressUpdates.author:school_id,first_name,last_name',
        ])
            ->where('organization_id', $request->user()->organization_id)
            ->orderBy('deadline', 'asc');

        if ($request->user()->role === 'SBO_OFFICER') {
            $query->where('assigned_to', $request->user()->id);
        }

        if ($request->filled('event_id')) {
            $query->where('event_id', $request->event_id);
        }

        if ($request->filled('assigned_to')) {
            $query->where('assigned_to', $request->assigned_to);
        }

        if ($request->filled('status')) {
            $query->where('status', $request->status);
        }

        if ($request->filled('task_type')) {
            $query->where('task_type', $request->task_type);
        }

        return response()->json($query->paginate($paging['per_page'] ?? 20));
    }

    public function store(Request $request)
    {
        $data = $request->validate($this->rules());

        if (! $this->validOrganizationLinks($request, $data)) {
            return response()->json(['message' => 'Selected task links must belong to this organization.'], 422);
        }

        $assignee = ! empty($data['assigned_to'])
            ? $this->eligibleOfficerQuery($request)
                ->where('school_id', $data['assigned_to'])
                ->first()
            : $this->recommendOfficer($request);

        if (! $assignee) {
            return response()->json(['message' => 'Assign an active SBO position to at least one officer before using task delegation.'], 422);
        }

        $data['assigned_to'] = $assignee->school_id;
        $data = $this->applyAssignmentScoring($data, $assignee, $request);

        $data = $this->normalizeCompletionFields($data);

        $task = Task::create([
            ...$data,
            'created_by' => $request->user()->id,
            'organization_id' => $request->user()->organization_id,
        ]);
        $this->recordProgressUpdate($task, $request, 'Task assigned.');

        $response = $task->load([
            'assignee:school_id,first_name,last_name',
            'creator:school_id,first_name,last_name',
            'event:id,title',
            'progressUpdates.author:school_id,first_name,last_name',
        ])->toArray();
        $response['delegation'] = $this->lastDelegation;

        return response()->json($response, 201);
    }

    public function update(Request $request, $id)
    {
        $task = Task::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $task) {
            return response()->json(['message' => 'Task not found.'], 404);
        }

        if ($task->created_by !== $request->user()->id && $request->user()->role !== 'ADMIN') {
            return response()->json(['message' => 'You are not authorized to edit this task.'], 403);
        }

        $data = $request->validate($this->rules(true));

        if (! $this->validOrganizationLinks($request, $data)) {
            return response()->json(['message' => 'Selected task links must belong to this organization.'], 422);
        }

        if (! empty($data['assigned_to'])) {
            $assignee = $this->eligibleOfficerQuery($request)
                ->where('school_id', $data['assigned_to'])
                ->first();

            if (! $assignee) {
                return response()->json(['message' => 'Tasks can only be assigned to active SBO Officers with an assigned position.'], 422);
            }

            $data = $this->applyAssignmentScoring($data, $assignee, $request);
        }

        $task->update($this->normalizeCompletionFields($data, $task));
        $this->notifyAdminsOfTaskUpdate($request, $task->fresh());

        return response()->json($task->fresh()->load([
            'assignee:school_id,first_name,last_name',
            'creator:school_id,first_name,last_name',
            'event:id,title',
        ]));
    }

    public function destroy(Request $request, $id)
    {
        $task = Task::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $task) {
            return response()->json(['message' => 'Task not found.'], 404);
        }

        if ($task->created_by !== $request->user()->id && $request->user()->role !== 'ADMIN') {
            return response()->json(['message' => 'You are not authorized to delete this task.'], 403);
        }

        $task->delete();

        return response()->json(['message' => 'Task deleted successfully.']);
    }

    public function updateStatus(Request $request, $id)
    {
        $task = Task::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $task) {
            return response()->json(['message' => 'Task not found.'], 404);
        }

        $userId = $request->user()->id;
        $isCreator = $task->created_by === $userId;
        $isAssignee = $task->assigned_to === $userId;
        $isAdmin = $request->user()->role === 'ADMIN';

        if (! $isCreator && ! $isAssignee && ! $isAdmin) {
            return response()->json(['message' => 'You are not authorized to update this task.'], 403);
        }

        $data = $request->validate([
            'status' => ['required', 'in:pending,in_progress,completed,overdue'],
            'progress_percent' => ['nullable', 'integer', 'min:0', 'max:100'],
            'progress_note' => ['nullable', 'string', 'max:1000'],
        ]);

        if (! $this->canTransition($task->status, $data['status'])) {
            return response()->json([
                'message' => 'Invalid task transition from '.str_replace('_', ' ', $task->status).' to '.str_replace('_', ' ', $data['status']).'.',
            ], 422);
        }

        $progressNote = $data['progress_note'] ?? null;
        unset($data['progress_note']);
        $task = DB::transaction(function () use ($task, $data, $request, $progressNote) {
            $lockedTask = Task::whereKey($task->id)->lockForUpdate()->firstOrFail();

            if (! $this->canTransition($lockedTask->status, $data['status'])) {
                abort(422, 'The task status changed before this update was saved. Refresh and try again.');
            }

            $lockedTask->update($this->normalizeCompletionFields($data, $lockedTask));
            $this->recordProgressUpdate($lockedTask, $request, $progressNote);

            return $lockedTask->fresh();
        });
        $this->notifyAdminsOfTaskUpdate($request, $task);

        return response()->json($task->fresh()->load([
            'assignee:school_id,first_name,last_name',
            'creator:school_id,first_name,last_name',
            'event:id,title',
            'progressUpdates.author:school_id,first_name,last_name',
        ]));
    }

    private function rules(bool $partial = false): array
    {
        $required = $partial ? 'sometimes|required' : 'required';

        return [
            'title' => [$required, 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'deadline' => [$required, 'date', 'after_or_equal:today'],
            'status' => [$required, 'in:pending,in_progress,completed,overdue'],
            'assigned_to' => ['nullable', 'exists:users,school_id'],
            'event_id' => ['nullable', 'exists:events,id'],
            'task_type' => ['nullable', 'in:regular,workflow'],
            'is_ai_generated' => ['boolean'],
            'progress_percent' => ['nullable', 'integer', 'min:0', 'max:100'],
            'completed_at' => ['nullable', 'date'],
        ];
    }

    private function normalizeCompletionFields(array $data, ?Task $task = null): array
    {
        $status = $data['status'] ?? $task?->status;

        if (($data['task_type'] ?? null) === null && ! $task) {
            $data['task_type'] = 'regular';
        }

        if ($status === 'completed') {
            $data['progress_percent'] = $data['progress_percent'] ?? 100;
            $data['completed_at'] = $data['completed_at'] ?? now();
        } elseif ($task?->status === 'completed') {
            $data['completed_at'] = null;
            $data['progress_percent'] = $data['progress_percent'] ?? 0;
        }

        return $data;
    }

    private function canTransition(string $current, string $next): bool
    {
        if ($current === $next) {
            return true;
        }

        return in_array($next, match ($current) {
            'pending' => ['in_progress', 'overdue'],
            'in_progress' => ['completed', 'overdue'],
            'overdue' => ['in_progress', 'completed'],
            'completed' => [],
            default => [],
        }, true);
    }

    private function recordProgressUpdate(Task $task, Request $request, ?string $note): void
    {
        TaskProgressUpdate::create([
            'task_id' => $task->id,
            'organization_id' => $task->organization_id,
            'updated_by' => $request->user()->school_id,
            'status' => $task->status,
            'progress_percent' => (int) ($task->progress_percent ?? 0),
            'note' => $note,
        ]);
    }

    private function validOrganizationLinks(Request $request, array $data): bool
    {
        if (! empty($data['assigned_to'])) {
            $validAssignee = $this->eligibleOfficerQuery($request)
                ->where('school_id', $data['assigned_to'])
                ->exists();

            if (! $validAssignee) {
                return false;
            }
        }

        if (! empty($data['event_id'])) {
            return Event::where('organization_id', $request->user()->organization_id)
                ->where('id', $data['event_id'])
                ->exists();
        }

        return true;
    }

    private function applyAssignmentScoring(array $data, User $assignee, Request $request): array
    {
        $scores = $this->assignmentScores($assignee, $request);

        return [
            ...$data,
            'role_score' => $scores['role_score'],
            'workload_score' => $scores['workload_score'],
            'performance_score' => $scores['performance_score'],
            'final_score' => $scores['final_score'],
            'ai_recommendation_note' => $this->aiAssignmentExplanations[$assignee->school_id]
                ?? $this->assignmentExplanation($data, $assignee, $scores),
        ];
    }

    private function assignmentScores(User $assignee, Request $request): array
    {
        if (isset($this->aiAssignmentScores[$assignee->school_id])) {
            return $this->aiAssignmentScores[$assignee->school_id];
        }

        $payload = $this->officerPayload($assignee, $request);
        $maxActiveTasks = (int) config('services.hiusa_ai.task_max_active_tasks', 5);

        // A single officer who is already at capacity or unavailable is not
        // eligible by the engine's own rules - calling it would only raise a
        // 422 the caller ignores and log a spurious warning. Skip straight to
        // the deterministic local fallback in that case.
        if ($payload['is_available'] && $payload['policy_eligible']) {
            $result = $this->aiService->taskDelegation(
                (string) $request->input('title', 'Untitled task'),
                [$payload],
                $request->input('task_type')
            );
            $this->rememberAiRankings($result);

            if (isset($this->aiAssignmentScores[$assignee->school_id])) {
                $this->lastDelegation = $this->delegationFromAiResult($result, $maxActiveTasks, $assignee->school_id);

                return $this->aiAssignmentScores[$assignee->school_id];
            }
        }

        $local = $this->localAssignmentScores($assignee, $request);
        $this->lastDelegation = [
            'algorithm' => 'rule_based_weighted_scoring',
            'weights' => self::WEIGHTS,
            'task_area' => $local['task_area'],
            'eligibility_rules' => $this->eligibilityRules($local['max_active_tasks']),
            'recommended_officer_id' => $assignee->school_id,
            'rankings' => [$local],
            'engine' => 'php-fallback',
        ];

        return $local;
    }

    private function eligibilityRules(int $maxActiveTasks): array
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

    // Normalizes a raw HiusaAiService::taskDelegation() result into the same
    // shape as a PHP-fallback delegation payload, so store()'s response can
    // carry either engine's output through the same 'delegation' key.
    private function delegationFromAiResult(?array $result, int $maxActiveTasks, int $fallbackRecommendedId): array
    {
        return [
            'algorithm' => $result['algorithm'] ?? 'rule_based_weighted_scoring',
            'weights' => $result['weights'] ?? self::WEIGHTS,
            'task_area' => $result['task_area'] ?? self::DEFAULT_TASK_AREA,
            'eligibility_rules' => $result['eligibility_rules'] ?? $this->eligibilityRules($maxActiveTasks),
            'recommended_officer_id' => $result['recommended_officer_id'] ?? $fallbackRecommendedId,
            'rankings' => $result['rankings'] ?? [],
            'engine' => 'python-fastapi',
        ];
    }

    private function inferTaskArea(string $taskTitle, ?string $taskType): string
    {
        $haystack = strtolower($taskTitle.' '.($taskType ?? ''));

        foreach (self::POSITION_RELEVANCE_MAP as $area => $spec) {
            foreach ($spec['keywords'] as $keyword) {
                // Anchored at the START of a word only (never the end): the
                // keyword list deliberately uses stem prefixes ("financ",
                // "promot", "coordinat", "logistic", "document", "publicity")
                // that must still match inflected forms ("financial",
                // "coordinating"). Collision-prone keywords ("fund" as a
                // prefix of "fundamental") are spelled out to their
                // least-ambiguous form instead of relying on the boundary
                // alone - see ai-service/app/engines/task_delegation.py.
                if (preg_match('/\b'.preg_quote($keyword, '/').'/', $haystack) === 1) {
                    return $area;
                }
            }
        }

        return self::DEFAULT_TASK_AREA;
    }

    /**
     * @return array{0: float, 1: string} [score, tier]
     */
    private function positionRelevance(?string $positionTitle, string $area): array
    {
        $normalized = $positionTitle !== null ? trim($positionTitle) : '';

        if ($normalized === '') {
            return [self::UNKNOWN_POSITION_SCORE, 'unknown'];
        }

        $spec = self::POSITION_RELEVANCE_MAP[$area];

        if (in_array($normalized, $spec['primary'], true)) {
            return [self::PRIMARY_POSITION_MATCH_SCORE, 'primary'];
        }

        if (in_array($normalized, $spec['secondary'], true)) {
            return [self::RELATED_POSITION_MATCH_SCORE, 'secondary'];
        }

        return [self::UNRELATED_POSITION_SCORE, 'unrelated'];
    }

    private function workloadScore(int $activeTasks, int $maxActiveTasks): float
    {
        $utilization = $maxActiveTasks > 0 ? $activeTasks / $maxActiveTasks : 1.0;

        return round(max(0.0, 100.0 * (1 - $utilization)), 2);
    }

    /**
     * Full local scoring breakdown for one officer - mirrors the shape of one
     * entry in ai-service/app/engines/task_delegation.py's `rankings`, plus
     * the raw active/max task counts the explanation sentence quotes.
     */
    private function localAssignmentScores(User $assignee, Request $request): array
    {
        $activeTasks = Task::where('organization_id', $request->user()->organization_id)
            ->where('assigned_to', $assignee->id)
            ->whereIn('status', ['pending', 'in_progress', 'overdue'])
            ->count();

        $completedTasks = Task::where('organization_id', $request->user()->organization_id)
            ->where('assigned_to', $assignee->id)
            ->where('status', 'completed')
            ->count();
        $historicalTasks = Task::where('organization_id', $request->user()->organization_id)
            ->where('assigned_to', $assignee->id)
            ->whereIn('status', ['completed', 'overdue'])
            ->count();

        $maxActiveTasks = (int) config('services.hiusa_ai.task_max_active_tasks', 5);
        $area = $this->inferTaskArea((string) $request->input('title', 'Untitled task'), $request->input('task_type'));
        [$roleScore, $tier] = $this->positionRelevance($assignee->position_title, $area);
        $workloadScore = $this->workloadScore($activeTasks, $maxActiveTasks);
        $hasHistory = $historicalTasks > 0;
        $performanceScore = $hasHistory ? round(($completedTasks / $historicalTasks) * 100, 2) : self::NEUTRAL_PERFORMANCE_SCORE;
        $finalScore = round(($roleScore * self::WEIGHTS['position']) + ($workloadScore * self::WEIGHTS['workload']) + ($performanceScore * self::WEIGHTS['performance']), 2);
        $name = trim("{$assignee->first_name} {$assignee->last_name}");
        $positionLabel = $assignee->position_title !== null && trim($assignee->position_title) !== '' ? trim($assignee->position_title) : 'no position on file';
        $performanceNote = $hasHistory ? '' : sprintf(' (no task history yet, so the neutral baseline of %d was used)', self::NEUTRAL_PERFORMANCE_SCORE);

        return [
            'officer_id' => $assignee->school_id,
            'name' => $name,
            'position_title' => $assignee->position_title,
            'position_tier' => $tier,
            'task_area' => $area,
            'role_score' => $roleScore,
            'workload_score' => $workloadScore,
            'performance_score' => $performanceScore,
            'final_score' => $finalScore,
            'active_tasks' => $activeTasks,
            'max_active_tasks' => $maxActiveTasks,
            'explanation' => sprintf(
                "%s scored %.2f for a task inferred as '%s': position '%s' is %s for this area (%.2f pts), workload %.2f (%d/%d active tasks), and past performance %.2f%s.",
                $name,
                $finalScore,
                $area,
                $positionLabel,
                self::TIER_PHRASE[$tier],
                $roleScore,
                $workloadScore,
                $activeTasks,
                $maxActiveTasks,
                $performanceScore,
                $performanceNote
            ),
        ];
    }

    // Local-fallback delegation payload across a full officer pool - mirrors
    // ai-service/app/engines/task_delegation.py's delegate_task() response shape.
    private function buildLocalDelegation(array $officers, Request $request, int $maxActiveTasks): array
    {
        $rankings = array_map(fn (User $officer) => $this->localAssignmentScores($officer, $request), $officers);
        usort($rankings, fn (array $a, array $b) => $a['final_score'] === $b['final_score']
            ? $a['officer_id'] <=> $b['officer_id']
            : $b['final_score'] <=> $a['final_score']);

        return [
            'algorithm' => 'rule_based_weighted_scoring',
            'weights' => self::WEIGHTS,
            'task_area' => $rankings[0]['task_area'] ?? self::DEFAULT_TASK_AREA,
            'eligibility_rules' => $this->eligibilityRules($maxActiveTasks),
            'recommended_officer_id' => $rankings[0]['officer_id'] ?? null,
            'rankings' => $rankings,
            'engine' => 'php-fallback',
        ];
    }

    private function recommendOfficer(Request $request): ?User
    {
        $officers = $this->eligibleOfficerQuery($request)->get();

        if ($officers->isEmpty()) {
            return null;
        }

        $maxActiveTasks = (int) config('services.hiusa_ai.task_max_active_tasks', 5);
        $result = $this->aiService->taskDelegation(
            (string) $request->input('title', 'Untitled task'),
            $officers->map(fn (User $officer) => $this->officerPayload($officer, $request))->values()->all(),
            $request->input('task_type')
        );
        $this->rememberAiRankings($result);
        $recommendedId = $result['recommended_officer_id'] ?? null;

        if ($recommendedId !== null && is_array($result['rankings'] ?? null)) {
            $recommended = $officers->firstWhere('school_id', (int) $recommendedId);

            if ($recommended) {
                $this->lastDelegation = $this->delegationFromAiResult($result, $maxActiveTasks, $recommended->school_id);

                return $recommended;
            }
        }

        $eligible = $officers
            ->filter(fn (User $officer) => $this->officerPayload($officer, $request)['is_available'])
            ->values();

        if ($eligible->isEmpty()) {
            return null;
        }

        $this->lastDelegation = $this->buildLocalDelegation($eligible->all(), $request, $maxActiveTasks);
        $recommendedOfficerId = $this->lastDelegation['recommended_officer_id'];

        return $eligible->firstWhere('school_id', $recommendedOfficerId);
    }

    private function officerPayload(User $officer, Request $request): array
    {
        $baseQuery = Task::where('organization_id', $request->user()->organization_id)
            ->where('assigned_to', $officer->school_id);
        $activeTasks = (clone $baseQuery)->whereIn('status', ['pending', 'in_progress', 'overdue'])->count();

        return [
            'officer_id' => $officer->school_id,
            'name' => trim("{$officer->first_name} {$officer->last_name}"),
            'role' => $officer->role,
            'position_title' => $officer->position_title,
            'account_status' => $officer->account_status,
            'is_available' => $activeTasks < (int) config('services.hiusa_ai.task_max_active_tasks', 5),
            'policy_eligible' => true,
            'active_tasks' => $activeTasks,
            'completed_tasks' => (clone $baseQuery)->where('status', 'completed')->count(),
            'overdue_tasks' => (clone $baseQuery)->where('status', 'overdue')->count(),
        ];
    }

    private function eligibleOfficerQuery(Request $request): Builder
    {
        return User::where('users.organization_id', $request->user()->organization_id)
            ->where('users.role', 'SBO_OFFICER')
            ->where('users.account_status', 'active')
            ->whereNotNull('users.position_title')
            ->whereRaw("TRIM(users.position_title) <> ''")
            ->whereExists(function ($query) {
                $query->selectRaw('1')
                    ->from('sbo_positions')
                    ->whereColumn('sbo_positions.organization_id', 'users.organization_id')
                    ->whereColumn('sbo_positions.title', 'users.position_title')
                    ->where('sbo_positions.role', 'SBO_OFFICER')
                    ->where('sbo_positions.is_active', true);
            });
    }

    private function rememberAiRankings(?array $result): void
    {
        $taskArea = is_string($result['task_area'] ?? null) ? $result['task_area'] : null;

        foreach ($result['rankings'] ?? [] as $ranking) {
            $officerId = $ranking['officer_id'] ?? null;

            if ($officerId === null
                || ! is_numeric($ranking['role_score'] ?? null)
                || ! is_numeric($ranking['workload_score'] ?? null)
                || ! is_numeric($ranking['performance_score'] ?? null)
                || ! is_numeric($ranking['final_score'] ?? null)) {
                continue;
            }

            $this->aiAssignmentScores[(int) $officerId] = [
                'role_score' => round((float) $ranking['role_score'], 2),
                'workload_score' => round((float) $ranking['workload_score'], 2),
                'performance_score' => round((float) $ranking['performance_score'], 2),
                'final_score' => round((float) $ranking['final_score'], 2),
                'task_area' => $taskArea,
                'position_tier' => is_string($ranking['position_tier'] ?? null) ? $ranking['position_tier'] : null,
            ];

            if (is_string($ranking['explanation'] ?? null) && trim($ranking['explanation']) !== '') {
                $this->aiAssignmentExplanations[(int) $officerId] = trim($ranking['explanation']);
            }
        }
    }

    // Reached only when the AI service is unreachable/invalid for this officer
    // (local fallback, $scores already carries a fully-formed 'explanation'
    // mirroring task_delegation.py:140-145), or when it returned valid scores
    // but no usable explanation string for this officer (rare: area/tier are
    // then recomputed deterministically from the task title and position,
    // since both engines derive them the same way regardless of which one
    // produced the numeric scores).
    private function assignmentExplanation(array $taskData, User $assignee, array $scores): string
    {
        $area = $scores['task_area'] ?? $this->inferTaskArea((string) ($taskData['title'] ?? 'Untitled task'), $taskData['task_type'] ?? null);
        $tier = $scores['position_tier'] ?? $this->positionRelevance($assignee->position_title, $area)[1];
        $tierPhrase = self::TIER_PHRASE[$tier] ?? $tier;
        $positionLabel = $assignee->position_title !== null && trim($assignee->position_title) !== '' ? trim($assignee->position_title) : 'no position on file';

        $fallback = $scores['explanation'] ?? sprintf(
            "%s %s scored %s for a task inferred as '%s': position '%s' is %s for this area (%s pts), workload %s, and past performance %s.",
            $assignee->first_name,
            $assignee->last_name,
            $scores['final_score'],
            $area,
            $positionLabel,
            $tierPhrase,
            $scores['role_score'],
            $scores['workload_score'],
            $scores['performance_score']
        );

        $generated = $this->groq->generate(
            'Explain a student-organization task assignment in one concise sentence. Preserve every supplied score, the inferred task area, and the position match tier exactly as given.',
            'Task: '.($taskData['title'] ?? 'Untitled')."; officer: {$assignee->first_name} {$assignee->last_name}; inferred task area: {$area}; position match: {$tierPhrase}; role score: {$scores['role_score']}; workload score: {$scores['workload_score']}; performance score: {$scores['performance_score']}; final score: {$scores['final_score']}.",
            120,
            0.2,
        );

        return $generated['text'] ?? $fallback;
    }

    private function notifyAdminsOfTaskUpdate(Request $request, Task $task): void
    {
        if ($request->user()->role !== 'SBO_OFFICER') {
            return;
        }

        $admins = User::where('organization_id', $request->user()->organization_id)
            ->where('role', 'ADMIN')
            ->get(['school_id']);

        foreach ($admins as $admin) {
            Notification::create([
                'organization_id' => $request->user()->organization_id,
                'user_id' => $admin->school_id,
                'title' => 'Task Updated',
                'message' => "Task \"{$task->title}\" was updated to ".str_replace('_', ' ', $task->status).'.',
                'notification_type' => 'task',
                'reference_type' => Task::class,
                'reference_id' => $task->id,
                'is_read' => false,
                'sent_at' => now(),
            ]);
        }
    }
}
