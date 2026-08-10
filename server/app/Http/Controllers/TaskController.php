<?php

namespace App\Http\Controllers;

use App\Models\Event;
use App\Models\Notification;
use App\Models\Task;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

class TaskController extends Controller
{
    public function index(Request $request)
    {
        $query = Task::with([
            'assignee:school_id,first_name,last_name',
            'creator:school_id,first_name,last_name',
            'event:id,title',
        ])
            ->where('organization_id', $request->user()->organization_id)
            ->orderBy('deadline', 'asc');

        if ($request->user()->role === 'SBO_OFFICER') {
            $query->where(function ($q) use ($request) {
                $q->where('assigned_to', $request->user()->id)
                    ->orWhere('created_by', $request->user()->id);
            });
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

        if (!$this->validOrganizationLinks($request, $data)) {
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

        return response()->json($task->load([
            'assignee:school_id,first_name,last_name',
            'creator:school_id,first_name,last_name',
            'event:id,title',
        ]), 201);
    }

    public function update(Request $request, $id)
    {
        $task = Task::where('organization_id', $request->user()->organization_id)->find($id);

        if (!$task) {
            return response()->json(['message' => 'Task not found.'], 404);
        }

        if ($task->created_by !== $request->user()->id && $request->user()->role !== 'ADMIN') {
            return response()->json(['message' => 'You are not authorized to edit this task.'], 403);
        }

        $data = $request->validate($this->rules(true));

        if (!$this->validOrganizationLinks($request, $data)) {
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

        if (!$task) {
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

        if (!$task) {
            return response()->json(['message' => 'Task not found.'], 404);
        }

        $userId = $request->user()->id;
        $isCreator = $task->created_by === $userId;
        $isAssignee = $task->assigned_to === $userId;
        $isAdmin = $request->user()->role === 'ADMIN';

        if (!$isCreator && !$isAssignee && !$isAdmin) {
            return response()->json(['message' => 'You are not authorized to update this task.'], 403);
        }

        $data = $request->validate([
            'status' => ['required', 'in:pending,in_progress,completed,overdue'],
            'progress_percent' => ['nullable', 'integer', 'min:0', 'max:100'],
        ]);

        $task->update($this->normalizeCompletionFields($data, $task));
        $this->notifyAdminsOfTaskUpdate($request, $task->fresh());

        return response()->json($task->fresh()->load([
            'assignee:school_id,first_name,last_name',
            'creator:school_id,first_name,last_name',
            'event:id,title',
        ]));
    }

    private function rules(bool $partial = false): array
    {
        $required = $partial ? 'sometimes|required' : 'required';

        return [
            'title' => [$required, 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'deadline' => [$required, 'date'],
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

        if (($data['task_type'] ?? null) === null && !$task) {
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

    private function validOrganizationLinks(Request $request, array $data): bool
    {
        if (!empty($data['assigned_to'])) {
            $validAssignee = User::where('organization_id', $request->user()->organization_id)
                ->where('school_id', $data['assigned_to'])
                ->where('role', 'SBO_OFFICER')
                ->where('account_status', 'active')
                ->exists();

            if (!$validAssignee) {
                return false;
            }
        }

        if (!empty($data['event_id'])) {
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
            'ai_recommendation_note' => $this->assignmentExplanation($data, $assignee, $scores),
        ];
    }

    private function assignmentScores(User $assignee, Request $request): array
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
        return User::where('organization_id', $request->user()->organization_id)
            ->where('role', 'SBO_OFFICER')
            ->where('account_status', 'active')
            ->get()
            ->sortByDesc(fn (User $officer) => $this->assignmentScores($officer, $request)['final_score'])
            ->first();
    }

    private function assignmentExplanation(array $taskData, User $assignee, array $scores): string
    {
        $fallback = "Recommended {$assignee->first_name} {$assignee->last_name} with a weighted fit score of {$scores['final_score']} (role {$scores['role_score']}, workload {$scores['workload_score']}, performance {$scores['performance_score']}).";
        $apiKey = env('GROQ_API_KEY');

        if (! $apiKey) {
            return $fallback;
        }

        try {
            $response = Http::withToken($apiKey)
                ->timeout(20)
                ->post('https://api.groq.com/openai/v1/chat/completions', [
                    'model' => env('GROQ_MODEL', 'llama-3.1-8b-instant'),
                    'messages' => [
                        ['role' => 'system', 'content' => 'Explain a student-organization task assignment in one concise sentence. Preserve the supplied scores.'],
                        ['role' => 'user', 'content' => "Task: ".($taskData['title'] ?? 'Untitled')."; officer: {$assignee->first_name} {$assignee->last_name}; role score: {$scores['role_score']}; workload score: {$scores['workload_score']}; performance score: {$scores['performance_score']}; final score: {$scores['final_score']}."],
                    ],
                    'temperature' => 0.2,
                    'max_tokens' => 120,
                ]);
            $text = trim((string) data_get($response->json(), 'choices.0.message.content'));

            if ($response->successful() && $text !== '') {
                return $text;
            }
        } catch (\Throwable) {
            // Keep the deterministic explanation if Groq is unavailable.
        }

        return $fallback;
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
                'message' => "Task \"{$task->title}\" was updated to " . str_replace('_', ' ', $task->status) . '.',
                'notification_type' => 'task',
                'reference_type' => Task::class,
                'reference_id' => $task->id,
                'is_read' => false,
                'sent_at' => now(),
            ]);
        }
    }
}
