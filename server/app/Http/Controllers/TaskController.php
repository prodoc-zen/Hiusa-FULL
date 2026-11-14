<?php

namespace App\Http\Controllers;

use App\Contracts\TextGenerator;
use App\Models\AcademicSemester;
use App\Models\AiOutput;
use App\Models\AuditLog;
use App\Models\Event;
use App\Models\Notification;
use App\Models\SboPosition;
use App\Models\Task;
use App\Models\TaskProgressUpdate;
use App\Models\User;
use App\Services\Ai\AiInstructions;
use App\Services\HiusaAiService;
use App\Services\TaskDelegationService;
use App\Support\FilterValues;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class TaskController extends Controller
{
    private array $aiAssignmentScores = [];

    private array $aiAssignmentExplanations = [];

    private ?array $lastDelegation = null;

    private ?string $lastExplanationModel = null;

    private ?array $officerStats = null;

    private ?array $activePositionTitles = null;

    public function __construct(
        private readonly HiusaAiService $aiService,
        private readonly TextGenerator $ai,
        private readonly TaskDelegationService $delegation,
    ) {}

    public function index(Request $request)
    {
        $paging = $request->validate([
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
            'page' => ['nullable', 'integer', 'min:1'],
            'academic_semester_id' => ['nullable', FilterValues::rule(['integer', 'exists:academic_semesters,id'])],
            'task_kind' => ['nullable', FilterValues::rule(['nullable', 'in:event_related,standalone'])],
            'priority' => ['nullable', FilterValues::rule(['nullable', 'in:low,medium,high,critical'])],
            'status' => ['nullable', FilterValues::rule(['in:pending,in_progress,completed,overdue'])],
            'event_id' => ['nullable', FilterValues::rule(['integer'])],
            'assigned_to' => ['nullable', FilterValues::rule(['integer'])],
            'task_type' => ['nullable', FilterValues::rule(['string', 'max:100'])],
            'deadline_from' => ['nullable', 'date'],
            'deadline_to' => ['nullable', 'date', 'after_or_equal:deadline_from'],
            'search' => ['nullable', 'string', 'max:120'],
        ]);

        $query = Task::with([
            'assignee:school_id,first_name,last_name,email,role,position_title,department,program,major,year_level,section',
            'creator:school_id,first_name,last_name,role,position_title',
            'event:id,title,start_time',
            'dependency:id,title,status',
            'progressUpdates.author:school_id,first_name,last_name',
        ])
            ->where('organization_id', $request->user()->organization_id)
            ->orderBy('deadline', 'asc')
            ->orderBy('id');
        $selectedSemesterId = $paging['academic_semester_id'] ?? AcademicSemester::selected($request)?->id;
        if ($selectedSemesterId) {
            $query->whereIn('academic_semester_id', FilterValues::values($selectedSemesterId));
        }

        if ($request->user()->role === 'SBO_OFFICER') {
            $query->where('assigned_to', $request->user()->id);
        }

        if ($request->filled('event_id')) {
            $query->whereIn('event_id', FilterValues::values($request->event_id));
        }

        if ($request->filled('assigned_to')) {
            $query->whereIn('assigned_to', FilterValues::values($request->assigned_to));
        }

        if ($request->filled('status')) {
            $query->whereIn('status', FilterValues::values($request->status));
        }

        if ($request->filled('task_type')) {
            $query->whereIn('task_type', FilterValues::values($request->task_type));
        }

        if (FilterValues::values($request->task_kind) === ['event_related']) {
            $query->whereNotNull('event_id');
        } elseif (FilterValues::values($request->task_kind) === ['standalone']) {
            $query->whereNull('event_id');
        }

        if ($request->filled('priority')) {
            $query->whereIn('priority', FilterValues::values($request->priority));
        }
        if ($request->filled('deadline_from')) {
            $query->whereDate('deadline', '>=', $request->deadline_from);
        }
        if ($request->filled('deadline_to')) {
            $query->whereDate('deadline', '<=', $request->deadline_to);
        }
        foreach (preg_split('/\s+/', trim($paging['search'] ?? ''), -1, PREG_SPLIT_NO_EMPTY) as $term) {
            $like = '%'.addcslashes($term, '\\%_').'%';
            $query->where(fn (Builder $match) => $match
                ->where('title', 'like', $like)
                ->orWhere('description', 'like', $like)
                ->orWhereHas('assignee', fn (Builder $assignee) => $assignee
                    ->where('first_name', 'like', $like)
                    ->orWhere('last_name', 'like', $like)
                    ->orWhere('position_title', 'like', $like))
                ->orWhereHas('event', fn (Builder $event) => $event->where('title', 'like', $like)));
        }

        return response()->json($query->paginate($paging['per_page'] ?? 20));
    }

    public function store(Request $request)
    {
        $this->resetOfficerCaches();
        $semester = AcademicSemester::selected($request);
        if (AcademicSemester::exists() && ! $semester) {
            return response()->json(['message' => 'SAO must activate an academic semester before new tasks can be created.'], 409);
        }
        $data = $this->normalizeDeadline($request->validate($this->rules()));

        if (($data['task_kind'] ?? null) === 'event_related' && empty($data['event_id'])) {
            return response()->json(['message' => 'Select a related event for an event task.', 'errors' => ['event_id' => ['Select a related event for an event task.']]], 422);
        }
        if (($data['task_kind'] ?? null) === 'standalone' && ! empty($data['event_id'])) {
            return response()->json(['message' => 'A standalone task cannot have a related event.', 'errors' => ['event_id' => ['A standalone task cannot have a related event.']]], 422);
        }

        if (! $this->validOrganizationLinks($request, $data)) {
            return response()->json(['message' => 'Selected task links must belong to this organization.'], 422);
        }

        if (empty($data['assigned_to'])) {
            return response()->json(['message' => 'Review the recommendation and choose an eligible officer before creating the task.', 'errors' => ['assigned_to' => ['Choose an eligible officer.']]], 422);
        }

        $this->recommendOfficer($request);
        $eligibleIds = collect($this->lastDelegation['rankings'] ?? [])->pluck('officer_id')->map(fn ($id) => (string) $id);
        if (! $eligibleIds->contains((string) $data['assigned_to'])) {
            return response()->json(['message' => 'The selected officer is not eligible for this task.', 'errors' => ['assigned_to' => ['Choose an eligible officer from the recommendation.']]], 422);
        }

        $assignee = ! empty($data['assigned_to'])
            ? $this->eligibleOfficers($request)->firstWhere('school_id', (int) $data['assigned_to'])
            : null;

        if (! $assignee) {
            if (! empty($data['assigned_to'])) {
                return response()->json(['message' => 'The selected officer is not an active SBO Officer with an active position.'], 422);
            }

            return response()->json(['message' => 'The selected officer is not eligible for this task.', 'errors' => ['assigned_to' => ['Choose an eligible officer from the recommendation.']]], 422);
        }

        $data['assigned_to'] = $assignee->school_id;
        unset($data['task_kind']);
        $data = $this->applyAssignmentScoring($data, $assignee, $request);

        $data = $this->normalizeCompletionFields($data);

        $task = Task::create([
            ...$data,
            'academic_semester_id' => empty($data['event_id']) ? $semester?->id : null,
            'created_by' => $request->user()->id,
            'organization_id' => $request->user()->organization_id,
        ]);
        $this->persistRecommendations($task, $this->lastDelegation);
        $hasAiExplanation = $this->lastExplanationModel !== null;
        AiOutput::create([
            'organization_id' => $task->organization_id,
            'feature_type' => 'TASK_EXPLANATION',
            'reference_type' => Task::class,
            'reference_id' => $task->id,
            'prompt_text' => 'Explain the deterministic task-delegation result without changing its facts.',
            'output_text' => $hasAiExplanation ? (string) $task->ai_recommendation_note : '',
            'model_name' => $this->lastExplanationModel,
            'context_version' => 'task-delegation-v2',
            'structured_input' => $this->lastDelegation,
            'structured_output' => ['deterministic_explanation' => $task->ai_recommendation_note],
            'status' => $hasAiExplanation ? 'completed' : 'failed',
            'error_message' => $hasAiExplanation ? null : 'The AI explanation was unavailable; deterministic assignment facts were retained.',
            'decision_status' => $hasAiExplanation ? 'accepted' : 'rejected',
            'requested_by' => $request->user()->school_id,
            'decided_by' => $hasAiExplanation ? $request->user()->school_id : null,
            'decided_at' => $hasAiExplanation ? now() : null,
            'created_at' => now(),
        ]);
        AuditLog::create([
            'organization_id' => $task->organization_id,
            'user_id' => $request->user()->school_id,
            'module' => 'task_delegation',
            'action' => 'task_delegated',
            'record_type' => Task::class,
            'record_id' => $task->id,
            'new_values' => ['assigned_to' => $task->assigned_to, 'recommended_officer_id' => $this->lastDelegation['recommended_officer_id'] ?? null, 'weights' => $this->lastDelegation['weights'] ?? $this->delegation->weights()],
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);
        $this->recordProgressUpdate($task, $request, 'Task assigned.');

        $response = $task->load([
            'assignee:school_id,first_name,last_name',
            'creator:school_id,first_name,last_name',
            'event:id,title,start_time',
            'progressUpdates.author:school_id,first_name,last_name',
        ])->toArray();
        $response['delegation'] = $this->lastDelegation;

        return response()->json($response, 201);
    }

    public function recommendation(Request $request)
    {
        $this->resetOfficerCaches();
        $request->validate([
            'title' => ['required', 'string', 'max:255'],
            'task_type' => ['nullable', 'in:regular,workflow'],
            'category' => ['nullable', 'in:finance,publicity,documentation,logistics,coordination'],
            'preferred_role' => ['nullable', 'string', 'max:100', Rule::exists('sbo_positions', 'title')->where(fn ($query) => $query->where('organization_id', $request->user()->organization_id)->where('role', 'SBO_OFFICER')->where('is_active', true))],
        ]);

        // A planning to-do is saved through TaskDelegationService, where the best officer role only steers the
        // recommendation, so its preview lists the same officers instead of filtering to that role.
        if ($request->input('task_type') === 'workflow') {
            return response()->json(['delegation' => $this->delegation->recommend(
                $request->user()->organization_id,
                $request->input('title'),
                'workflow',
                $request->input('preferred_role'),
            )]);
        }

        $this->recommendOfficer($request);

        return response()->json(['delegation' => $this->lastDelegation]);
    }

    public function update(Request $request, $id)
    {
        $this->resetOfficerCaches();
        $task = Task::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $task) {
            return response()->json(['message' => 'Task not found.'], 404);
        }

        if ($task->created_by !== $request->user()->id && $request->user()->role !== 'ADMIN') {
            return response()->json(['message' => 'You are not authorized to edit this task.'], 403);
        }

        $data = $this->normalizeDeadline($request->validate($this->rules(true)));

        if (isset($data['deadline'])) {
            $deadlineError = $this->changedDeadlineError($task, $this->localTime($data['deadline']));
            if ($deadlineError !== null) {
                return response()->json(['message' => $deadlineError, 'errors' => ['deadline' => [$deadlineError]]], 422);
            }
        }
        if (isset($data['assigned_to']) && (int) $data['assigned_to'] === (int) $task->assigned_to) {
            unset($data['assigned_to']);
        }

        if (($data['task_kind'] ?? null) === 'event_related' && empty($data['event_id'] ?? $task->event_id)) {
            return response()->json(['message' => 'Select a related event for an event task.', 'errors' => ['event_id' => ['Select a related event for an event task.']]], 422);
        }
        if (($data['task_kind'] ?? null) === 'standalone') {
            if (! empty($data['event_id'])) {
                return response()->json(['message' => 'A standalone task cannot have a related event.', 'errors' => ['event_id' => ['A standalone task cannot have a related event.']]], 422);
            }
            $data['event_id'] = null;
        }
        unset($data['task_kind']);

        if (! $this->validOrganizationLinks($request, $data)) {
            return response()->json(['message' => 'Selected task links must belong to this organization.'], 422);
        }

        $reassigned = false;
        if (! empty($data['assigned_to'])) {
            $assignee = $this->eligibleOfficers($request)->firstWhere('school_id', (int) $data['assigned_to']);

            if (! $assignee) {
                return response()->json(['message' => 'Tasks can only be assigned to active SBO Officers with an assigned position.'], 422);
            }

            $request->merge([
                'title' => $data['title'] ?? $task->title,
                'category' => $data['category'] ?? $task->category,
                'task_type' => $data['task_type'] ?? $task->task_type,
            ]);
            $this->recommendOfficer($request);
            $eligibleIds = collect($this->lastDelegation['rankings'] ?? [])->pluck('officer_id')->map(fn ($id) => (int) $id);
            if (! $eligibleIds->contains($assignee->school_id)) {
                return response()->json(['message' => 'The selected officer is not eligible for this task.', 'errors' => ['assigned_to' => ['Choose an officer who is eligible for this task, for example one below the open task limit.']]], 422);
            }

            $data = $this->applyAssignmentScoring($data, $assignee, $request);
            $reassigned = true;
        }

        $task->update($this->normalizeCompletionFields($data, $task));
        if ($reassigned) {
            $this->persistRecommendations($task, $this->lastDelegation);
            AuditLog::create([
                'organization_id' => $task->organization_id,
                'user_id' => $request->user()->school_id,
                'module' => 'task_delegation',
                'action' => 'task_delegated',
                'record_type' => Task::class,
                'record_id' => $task->id,
                'new_values' => ['assigned_to' => $task->assigned_to, 'recommended_officer_id' => $this->lastDelegation['recommended_officer_id'] ?? null, 'weights' => $this->lastDelegation['weights'] ?? $this->delegation->weights()],
                'ip_address' => $request->ip(),
                'created_at' => now(),
            ]);
            $this->recordProgressUpdate($task, $request, 'Task reassigned.');
        }
        $this->notifyAdminsOfTaskUpdate($request, $task->fresh());

        return response()->json($task->fresh()->load([
            'assignee:school_id,first_name,last_name',
            'creator:school_id,first_name,last_name',
            'event:id,title,start_time',
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

        DB::transaction(function () use ($task, $request) {
            $task->delete();
            AuditLog::create([
                'organization_id' => $task->organization_id,
                'user_id' => $request->user()->school_id,
                'actor_role' => $request->user()->role,
                'module' => 'tasks',
                'action' => 'task_deleted',
                'record_type' => Task::class,
                'record_id' => $task->id,
                'old_values' => $task->only(['title', 'status', 'assigned_to', 'event_id', 'deadline']),
                'ip_address' => $request->ip(),
                'created_at' => now(),
            ]);
        });

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
            'progress_percent' => ['nullable', 'integer', 'min:0', 'max:'.($request->input('status') === 'completed' ? 100 : 99)],
            'progress_note' => ['nullable', 'string', 'max:1000'],
        ], [
            'progress_percent.max' => 'Progress stays at 99% or less until the task is marked completed.',
        ]);

        if (! $this->canTransition($task->status, $data['status'], $isAdmin)) {
            return response()->json([
                'message' => 'Invalid task transition from '.str_replace('_', ' ', $task->status).' to '.str_replace('_', ' ', $data['status']).'.',
            ], 422);
        }

        if (in_array($data['status'], ['in_progress', 'completed'], true)
            && $task->depends_on_task_id
            && ! Task::whereKey($task->depends_on_task_id)
                ->where('organization_id', $task->organization_id)
                ->where('status', 'completed')->exists()) {
            return response()->json(['message' => 'This task is blocked until its dependency is completed.'], 422);
        }

        $progressNote = $data['progress_note'] ?? null;
        unset($data['progress_note']);
        $task = DB::transaction(function () use ($task, $data, $request, $progressNote) {
            $lockedTask = Task::whereKey($task->id)->lockForUpdate()->firstOrFail();

            if (! $this->canTransition($lockedTask->status, $data['status'], $request->user()->role === 'ADMIN')) {
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
        $required = $partial ? ['sometimes', 'required'] : ['required'];

        return [
            'title' => [...$required, 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'deadline' => $partial ? ['sometimes', 'required', 'date'] : ['required', 'date', 'after_or_equal:today'],
            'status' => $partial ? ['prohibited'] : ['required', 'in:pending,in_progress'],
            'assigned_to' => ['nullable', 'exists:users,school_id'],
            'event_id' => ['nullable', 'exists:events,id'],
            'task_type' => ['nullable', 'in:regular,workflow'],
            'task_kind' => ['nullable', 'in:event_related,standalone'],
            'category' => ['nullable', 'in:finance,publicity,documentation,logistics,coordination'],
            'priority' => ['nullable', 'in:low,medium,high,critical'],
            'preferred_role' => ['nullable', 'string', 'max:100', Rule::exists('sbo_positions', 'title')->where(fn ($query) => $query->where('organization_id', request()->user()->organization_id)->where('role', 'SBO_OFFICER')->where('is_active', true))],
            'is_ai_generated' => ['boolean'],
            'progress_percent' => $partial ? ['prohibited'] : ['nullable', 'integer', 'min:0', 'max:99'],
            'completed_at' => ['prohibited'],
        ];
    }

    // A task due on a date is due at the end of that day, so a bare date is stored as 23:59:59 rather than midnight.
    private function normalizeDeadline(array $data): array
    {
        if (isset($data['deadline'])) {
            $data['deadline'] = preg_match('/^\d{4}-\d{2}-\d{2}$/', trim((string) $data['deadline']))
                ? Carbon::parse(trim($data['deadline']), config('app.timezone'))->endOfDay()->toDateTimeString()
                : $this->localTime($data['deadline'])->toDateTimeString();
        }

        return $data;
    }

    // Resending the stored deadline (to rename or reassign an overdue task) is not a change, so only a new date is held to the future and to the workflow phase.
    private function changedDeadlineError(Task $task, Carbon $deadline): ?string
    {
        if ($task->deadline && $task->deadline->format('Y-m-d H:i') === $deadline->format('Y-m-d H:i')) {
            return null;
        }
        if ($deadline->lt(now()->startOfDay())) {
            return 'The deadline must be today or later.';
        }

        $event = $task->phase && $task->event_id ? Event::find($task->event_id) : null;
        if ($event === null) {
            return null;
        }

        $matches = match ($task->phase) {
            'pre_event' => $deadline->lt($event->start_time),
            'event_day' => $deadline->betweenIncluded($event->start_time, $event->end_time),
            'post_event' => $deadline->gt($event->end_time) && $deadline->lte($event->end_time->copy()->addDays(30)),
            default => true,
        };

        return $matches ? null : 'The deadline for this '.match ($task->phase) {
            'pre_event' => 'task must be before the event starts.',
            'event_day' => 'task must be during the event.',
            default => 'task must be after the event ends and within 30 days.',
        };
    }

    private function normalizeCompletionFields(array $data, ?Task $task = null): array
    {
        $status = $data['status'] ?? $task?->status;

        if (($data['task_type'] ?? null) === null && ! $task) {
            $data['task_type'] = 'regular';
        }

        if ($status === 'completed') {
            $data['progress_percent'] = 100;
            $data['completed_at'] = $data['completed_at'] ?? now();
        } elseif ($task?->status === 'completed') {
            $data['completed_at'] = null;
            $data['progress_percent'] = $data['progress_percent'] ?? 0;
        }

        return $data;
    }

    private function canTransition(string $current, string $next, bool $isAdmin = false): bool
    {
        if ($current === $next) {
            return true;
        }

        if ($isAdmin && $next === 'pending') {
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
            if (! $this->eligibleOfficers($request)->contains('school_id', (int) $data['assigned_to'])) {
                return false;
            }
        }

        if (! empty($data['event_id'])) {
            return Event::where('organization_id', $request->user()->organization_id)
                ->where('id', $data['event_id'])
                ->when(AcademicSemester::selected($request), fn ($event, $semester) => $event->where('academic_semester_id', $semester->id))
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
            'recency_score' => $scores['recency_score'],
            'final_score' => $scores['final_score'],
            'ai_recommendation_note' => $this->assignmentExplanation($data, $assignee, $scores),
            'delegation_snapshot' => $this->lastDelegation,
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
                $request->input('category') ?: $request->input('task_type')
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
            'weights' => $this->delegation->weights(),
            'task_area' => $local['task_area'],
            'eligibility_rules' => $this->delegation->eligibilityRules($local['max_active_tasks']),
            'recommended_officer_id' => $assignee->school_id,
            'rankings' => [$local],
            'engine' => 'php-fallback',
        ];

        return $local;
    }

    // Normalizes a raw HiusaAiService::taskDelegation() result into the same
    // shape as a PHP-fallback delegation payload, so store()'s response can
    // carry either engine's output through the same 'delegation' key.
    private function delegationFromAiResult(?array $result, int $maxActiveTasks, int $fallbackRecommendedId): array
    {
        return [
            'algorithm' => $result['algorithm'] ?? 'rule_based_weighted_scoring',
            'weights' => $result['weights'] ?? $this->delegation->weights(),
            'task_area' => $result['task_area'] ?? TaskDelegationService::DEFAULT_TASK_AREA,
            'eligibility_rules' => $result['eligibility_rules'] ?? $this->delegation->eligibilityRules($maxActiveTasks),
            'recommended_officer_id' => $result['recommended_officer_id'] ?? $fallbackRecommendedId,
            'rankings' => $result['rankings'] ?? [],
            'evaluations' => $result['evaluations'] ?? ($result['rankings'] ?? []),
            'engine' => 'python-fastapi',
        ];
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
        $history = $this->statsFor($request, $assignee);
        $activeTasks = $history['active'];
        $completedTasks = $history['completed'];
        $historicalTasks = $history['completed'] + $history['overdue'];

        $maxActiveTasks = (int) config('services.hiusa_ai.task_max_active_tasks', 5);
        $area = $this->delegation->inferArea((string) $request->input('title', 'Untitled task'), $request->input('category') ?: $request->input('task_type'));
        $position = $this->delegation->canonicalPosition($assignee->position_title, $this->activePositions($request)) ?? $assignee->position_title;
        [$roleScore, $tier] = $this->delegation->roleScore($position, $area);
        $workloadScore = $this->workloadScore($activeTasks, $maxActiveTasks);
        $hasHistory = $historicalTasks > 0;
        $performanceScore = $hasHistory ? round(($completedTasks / $historicalTasks) * 100, 2) : TaskDelegationService::NEUTRAL_PERFORMANCE_SCORE;
        $daysSinceAssignment = $this->delegation->daysSince($history['last_assigned_at']);
        $recencyScore = $this->delegation->recencyScore($daysSinceAssignment);
        $weights = $this->delegation->weights();
        $finalScore = round(($roleScore * $weights['position']) + ($workloadScore * $weights['workload']) + ($performanceScore * $weights['performance']) + ($recencyScore * $weights['recency']), 2);

        $scores = [
            'officer_id' => $assignee->school_id,
            'name' => trim("{$assignee->first_name} {$assignee->last_name}"),
            'position_title' => $position,
            'position_tier' => $tier,
            'task_area' => $area,
            'role_score' => $roleScore,
            'workload_score' => $workloadScore,
            'performance_score' => $performanceScore,
            'recency_score' => $recencyScore,
            'final_score' => $finalScore,
            'active_tasks' => $activeTasks,
            'max_active_tasks' => $maxActiveTasks,
            'days_since_last_assignment' => $daysSinceAssignment,
        ];
        $scores['explanation'] = $this->delegation->explanation($scores, $area, $hasHistory);

        return $scores;
    }

    // Local-fallback delegation payload across a full officer pool - mirrors
    // ai-service/app/engines/task_delegation.py's delegate_task() response shape.
    private function buildLocalDelegation(array $officers, Request $request, int $maxActiveTasks): array
    {
        $rankings = array_map(fn (User $officer) => $this->localAssignmentScores($officer, $request), $officers);
        usort($rankings, fn (array $a, array $b) => $a['final_score'] === $b['final_score']
            ? $a['officer_id'] <=> $b['officer_id']
            : $b['final_score'] <=> $a['final_score']);
        foreach ($rankings as $index => &$ranking) {
            $ranking['rank'] = $index + 1;
        }
        unset($ranking);

        return [
            'algorithm' => 'rule_based_weighted_scoring',
            'weights' => $this->delegation->weights(),
            'task_area' => $rankings[0]['task_area'] ?? $this->delegation->inferArea((string) $request->input('title', 'Untitled task'), $request->input('category') ?: $request->input('task_type')),
            'eligibility_rules' => $this->delegation->eligibilityRules($maxActiveTasks),
            'recommended_officer_id' => $rankings[0]['officer_id'] ?? null,
            'rankings' => $rankings,
            'engine' => 'php-fallback',
        ];
    }

    private function recommendOfficer(Request $request): ?User
    {
        $maxActiveTasks = (int) config('services.hiusa_ai.task_max_active_tasks', 5);
        $candidates = $this->delegation->officerPool($request->user()->organization_id)
            ->filter(fn (User $officer) => $officer->account_status === 'active')
            ->when($request->filled('preferred_role'), fn (Collection $pool) => $pool->filter(fn (User $officer) => $this->holdsPreferredRole($officer, $request)))
            ->values();
        $officers = $this->eligibleOfficers($request);

        if ($officers->isEmpty()) {
            $this->lastDelegation = $this->buildLocalDelegation([], $request, $maxActiveTasks);
            $this->lastDelegation['evaluations'] = $candidates
                ->map(fn (User $candidate) => $this->ineligibleEvaluation($candidate, $request, $maxActiveTasks))
                ->values()
                ->all();

            return null;
        }
        $result = $this->aiService->taskDelegation(
            (string) $request->input('title', 'Untitled task'),
            $candidates->map(fn (User $officer) => $this->officerPayload($officer, $request))->values()->all(),
            $request->input('category') ?: $request->input('task_type')
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
            $this->lastDelegation = $this->buildLocalDelegation([], $request, $maxActiveTasks);
            $this->lastDelegation['evaluations'] = $candidates
                ->map(fn (User $candidate) => $this->ineligibleEvaluation($candidate, $request, $maxActiveTasks))
                ->values()
                ->all();

            return null;
        }

        $this->lastDelegation = $this->buildLocalDelegation($eligible->all(), $request, $maxActiveTasks);
        $this->lastDelegation['evaluations'] = [
            ...$this->lastDelegation['rankings'],
            ...$candidates
                ->reject(fn (User $candidate) => $eligible->contains('school_id', $candidate->school_id))
                ->map(fn (User $candidate) => $this->ineligibleEvaluation($candidate, $request, $maxActiveTasks))
                ->values()
                ->all(),
        ];
        $this->rememberAiRankings($this->lastDelegation);
        $recommendedOfficerId = $this->lastDelegation['recommended_officer_id'];

        return $eligible->firstWhere('school_id', $recommendedOfficerId);
    }

    private function officerPayload(User $officer, Request $request): array
    {
        $history = $this->statsFor($request, $officer);
        $activeTasks = $history['active'];
        $canonical = $this->delegation->canonicalPosition($officer->position_title, $this->activePositions($request));

        return [
            'officer_id' => $officer->school_id,
            'name' => trim("{$officer->first_name} {$officer->last_name}"),
            'role' => $officer->role,
            'position_title' => $canonical ?? $officer->position_title,
            'account_status' => $this->delegation->accountIsActive($officer) ? 'active' : 'inactive',
            'is_available' => $activeTasks < (int) config('services.hiusa_ai.task_max_active_tasks', 5),
            'policy_eligible' => $canonical !== null,
            'active_tasks' => $activeTasks,
            'completed_tasks' => $history['completed'],
            'overdue_tasks' => $history['overdue'],
            'days_since_last_assignment' => $this->delegation->daysSince($history['last_assigned_at']),
        ];
    }

    private function resetOfficerCaches(): void
    {
        $this->officerStats = null;
        $this->activePositionTitles = null;
        $this->aiAssignmentScores = [];
        $this->aiAssignmentExplanations = [];
        $this->lastDelegation = null;
        $this->lastExplanationModel = null;
    }

    private function activePositions(Request $request): array
    {
        return $this->activePositionTitles ??= $this->delegation->activePositionTitles($request->user()->organization_id);
    }

    private function statsFor(Request $request, User $officer): array
    {
        $this->officerStats ??= $this->delegation->officerStats($request->user()->organization_id);

        return $this->delegation->statsFor($this->officerStats, $officer->school_id);
    }

    private function holdsPreferredRole(User $officer, Request $request): bool
    {
        $held = $this->delegation->canonicalPosition($officer->position_title, $this->activePositions($request)) ?? trim((string) $officer->position_title);

        return SboPosition::normaliseTitle($held) === SboPosition::normaliseTitle((string) $request->preferred_role);
    }

    /** @return Collection<int, User> */
    private function eligibleOfficers(Request $request): Collection
    {
        $activePositions = $this->activePositions($request);

        return $this->delegation->officerPool($request->user()->organization_id)
            ->filter(fn (User $officer) => $this->delegation->accountIsActive($officer)
                && trim((string) $officer->position_title) !== ''
                && $this->delegation->canonicalPosition($officer->position_title, $activePositions) !== null
                && (! $request->filled('preferred_role') || $this->holdsPreferredRole($officer, $request)))
            ->values();
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
                || ! is_numeric($ranking['recency_score'] ?? null)
                || ! is_numeric($ranking['final_score'] ?? null)) {
                continue;
            }

            $this->aiAssignmentScores[(int) $officerId] = [
                'role_score' => round((float) $ranking['role_score'], 2),
                'workload_score' => round((float) $ranking['workload_score'], 2),
                'performance_score' => round((float) $ranking['performance_score'], 2),
                'recency_score' => round((float) $ranking['recency_score'], 2),
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
        $area = $scores['task_area'] ?? $this->delegation->inferArea((string) ($taskData['title'] ?? 'Untitled task'), $taskData['category'] ?? $taskData['task_type'] ?? null);
        $tier = $scores['position_tier'] ?? $this->delegation->roleScore($this->delegation->canonicalPosition($assignee->position_title, $this->activePositionTitles ?? []) ?? $assignee->position_title, $area)[1];
        $tierPhrase = $this->delegation->tierPhrase($tier);
        $positionLabel = $assignee->position_title !== null && trim($assignee->position_title) !== '' ? trim($assignee->position_title) : 'no position on file';

        $fallback = $this->aiAssignmentExplanations[$assignee->school_id] ?? $scores['explanation'] ?? sprintf(
            "%s %s scored %s for a task inferred as '%s': position '%s' is %s for this area (%s pts), workload %s, past performance %s, and assignment recency %s.",
            $assignee->first_name,
            $assignee->last_name,
            $scores['final_score'],
            $area,
            $positionLabel,
            $tierPhrase,
            $scores['role_score'],
            $scores['workload_score'],
            $scores['performance_score'],
            $scores['recency_score']
        );

        $facts = [
            'task' => $taskData['title'] ?? 'Untitled',
            'officer' => trim("{$assignee->first_name} {$assignee->last_name}"),
            'task_area' => $area,
            'position_match' => $tierPhrase,
            'role_score' => $scores['role_score'],
            'workload_score' => $scores['workload_score'],
            'performance_score' => $scores['performance_score'],
            'recency_score' => $scores['recency_score'],
            'final_score' => $scores['final_score'],
        ];
        $generated = $this->ai->generate(
            AiInstructions::taskAssignmentNote(),
            json_encode($facts, JSON_THROW_ON_ERROR),
            120,
            0.2,
        );
        if ($generated && ! $this->ai->preservesNumericFacts($generated['text'], $facts)) {
            $generated = null;
        }

        $this->lastExplanationModel = $generated['model'] ?? null;

        return $generated['text'] ?? $fallback;
    }

    private function persistRecommendations(Task $task, ?array $delegation): void
    {
        foreach ($delegation['evaluations'] ?? $delegation['rankings'] ?? [] as $index => $ranking) {
            DB::table('task_recommendations')->insert([
                'task_id' => $task->id,
                'organization_id' => $task->organization_id,
                'officer_id' => $ranking['officer_id'] ?? null,
                'role_score' => $ranking['role_score'] ?? null,
                'workload_score' => $ranking['workload_score'] ?? null,
                'performance_score' => $ranking['performance_score'] ?? null,
                'recency_score' => $ranking['recency_score'] ?? null,
                'weights' => json_encode($delegation['weights'] ?? $this->delegation->weights()),
                'total_score' => $ranking['final_score'] ?? null,
                'rank' => array_key_exists('rank', $ranking) ? $ranking['rank'] : $index + 1,
                'eligibility_result' => $ranking['eligibility_result'] ?? 'eligible',
                'calculated_at' => now(),
            ]);
        }
    }

    private function ineligibleEvaluation(User $officer, Request $request, int $maxActiveTasks): array
    {
        $payload = $this->officerPayload($officer, $request);
        $result = match (true) {
            ! $this->delegation->accountIsActive($officer) => 'inactive_account',
            trim((string) $officer->position_title) === '' => 'missing_position',
            ! $payload['policy_eligible'] => 'inactive_position',
            ! $payload['is_available'] || $payload['active_tasks'] >= $maxActiveTasks => 'overloaded',
            default => 'ineligible',
        };

        return [
            'officer_id' => $officer->school_id,
            'name' => $payload['name'],
            'position_title' => $officer->position_title,
            'role_score' => null,
            'workload_score' => null,
            'performance_score' => null,
            'recency_score' => null,
            'final_score' => null,
            'rank' => null,
            'eligibility_result' => $result,
        ];
    }

    private function notifyAdminsOfTaskUpdate(Request $request, Task $task): void
    {
        if ($request->user()->role !== 'SBO_OFFICER') {
            return;
        }

        $admins = User::whereHas('accountProfiles', fn ($profiles) => $profiles->where('organization_id', $request->user()->organization_id)->where('role', 'ADMIN')->where('account_status', 'active'))
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
