<?php

namespace App\Http\Controllers;

use App\Models\Event;
use App\Models\Notification;
use App\Models\Task;
use App\Models\TaskProgressUpdate;
use App\Models\User;
use App\Services\GroqResponsesService;
use App\Services\HiusaAiService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class TaskController extends Controller
{
    private array $aiAssignmentScores = [];

    private array $aiAssignmentExplanations = [];

    public function __construct(
        private readonly HiusaAiService $aiService,
        private readonly GroqResponsesService $groq,
    ) {}

    public function index(Request $request)
    {
        $query = Task::with([
            'assignee:school_id,first_name,last_name',
            'creator:school_id,first_name,last_name',
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

        return response()->json($query->get());
    }

    public function store(Request $request)
    {
        $data = $request->validate($this->rules());

        if (! $this->validOrganizationLinks($request, $data)) {
            return response()->json(['message' => 'Selected task links must belong to this organization.'], 422);
        }

        $assignee = ! empty($data['assigned_to'])
            ? User::where('organization_id', $request->user()->organization_id)->where('school_id', $data['assigned_to'])->first()
            : $this->recommendOfficer($request);

        if (! $assignee || $assignee->role !== 'SBO_OFFICER') {
            return response()->json(['message' => 'An active SBO Officer is required for task assignment.'], 422);
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

        return response()->json($task->load([
            'assignee:school_id,first_name,last_name',
            'creator:school_id,first_name,last_name',
            'event:id,title',
            'progressUpdates.author:school_id,first_name,last_name',
        ]), 201);
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
            $assignee = User::where('organization_id', $request->user()->organization_id)
                ->where('school_id', $data['assigned_to'])
                ->where('role', 'SBO_OFFICER')
                ->where('account_status', 'active')
                ->first();

            if (! $assignee) {
                return response()->json(['message' => 'Tasks can only be assigned to active SBO Officers.'], 422);
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
            $validAssignee = User::where('organization_id', $request->user()->organization_id)
                ->where('school_id', $data['assigned_to'])
                ->where('role', 'SBO_OFFICER')
                ->where('account_status', 'active')
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
            ...$scores,
            'ai_recommendation_note' => $this->aiAssignmentExplanations[$assignee->school_id]
                ?? $this->assignmentExplanation($data, $assignee, $scores),
        ];
    }

    private function assignmentScores(User $assignee, Request $request): array
    {
        if (isset($this->aiAssignmentScores[$assignee->school_id])) {
            return $this->aiAssignmentScores[$assignee->school_id];
        }

        $result = $this->aiService->taskDelegation(
            (string) $request->input('title', 'Untitled task'),
            [$this->officerPayload($assignee, $request)]
        );
        $this->rememberAiRankings($result);

        if (isset($this->aiAssignmentScores[$assignee->school_id])) {
            return $this->aiAssignmentScores[$assignee->school_id];
        }

        return $this->localAssignmentScores($assignee, $request);
    }

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

        $roleScore = 100;
        $workloadScore = max(20, 100 - ($activeTasks * 15));
        $performanceScore = $historicalTasks > 0 ? round(($completedTasks / $historicalTasks) * 100, 2) : 70;
        $finalScore = round(($roleScore * 0.4) + ($workloadScore * 0.35) + ($performanceScore * 0.25), 2);

        return [
            'role_score' => $roleScore,
            'workload_score' => $workloadScore,
            'performance_score' => $performanceScore,
            'final_score' => $finalScore,
        ];
    }

    private function recommendOfficer(Request $request): ?User
    {
        $officers = User::where('organization_id', $request->user()->organization_id)
            ->where('role', 'SBO_OFFICER')
            ->where('account_status', 'active')
            ->get();

        if ($officers->isEmpty()) {
            return null;
        }

        $result = $this->aiService->taskDelegation(
            (string) $request->input('title', 'Untitled task'),
            $officers->map(fn (User $officer) => $this->officerPayload($officer, $request))->values()->all()
        );
        $this->rememberAiRankings($result);
        $recommendedId = $result['recommended_officer_id'] ?? null;

        if ($recommendedId !== null) {
            $recommended = $officers->firstWhere('school_id', (int) $recommendedId);

            if ($recommended) {
                return $recommended;
            }
        }

        return $officers
            ->filter(fn (User $officer) => $this->officerPayload($officer, $request)['is_available'])
            ->sortByDesc(fn (User $officer) => $this->localAssignmentScores($officer, $request)['final_score'])
            ->first();
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
            'account_status' => $officer->account_status,
            'is_available' => $activeTasks < (int) config('services.hiusa_ai.task_max_active_tasks', 5),
            'policy_eligible' => true,
            'active_tasks' => $activeTasks,
            'completed_tasks' => (clone $baseQuery)->where('status', 'completed')->count(),
            'overdue_tasks' => (clone $baseQuery)->where('status', 'overdue')->count(),
        ];
    }

    private function rememberAiRankings(?array $result): void
    {
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
            ];

            if (is_string($ranking['explanation'] ?? null) && trim($ranking['explanation']) !== '') {
                $this->aiAssignmentExplanations[(int) $officerId] = trim($ranking['explanation']);
            }
        }
    }

    private function assignmentExplanation(array $taskData, User $assignee, array $scores): string
    {
        $fallback = "Recommended {$assignee->first_name} {$assignee->last_name} with a weighted fit score of {$scores['final_score']} (role {$scores['role_score']}, workload {$scores['workload_score']}, performance {$scores['performance_score']}).";
        $generated = $this->groq->generate(
            'Explain a student-organization task assignment in one concise sentence. Preserve every supplied score.',
            'Task: '.($taskData['title'] ?? 'Untitled')."; officer: {$assignee->first_name} {$assignee->last_name}; role score: {$scores['role_score']}; workload score: {$scores['workload_score']}; performance score: {$scores['performance_score']}; final score: {$scores['final_score']}.",
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
