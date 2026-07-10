<?php

namespace App\Http\Controllers;

use App\Models\Event;
use App\Models\Task;
use App\Models\User;
use Illuminate\Http\Request;

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

        if ($request->filled('event_id')) {
            $query->where('event_id', $request->event_id);
        }

        if ($request->filled('assigned_to')) {
            $query->where('assigned_to', $request->assigned_to);
        }

        if ($request->filled('status')) {
            $query->where('status', $request->status);
        }

        return response()->json($query->get());
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'title'       => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'deadline'    => ['required', 'date'],
            'status'      => ['required', 'in:pending,in_progress,completed,overdue'],
            'assigned_to' => ['nullable', 'exists:users,school_id'],
            'event_id'    => ['nullable', 'exists:events,id'],
            'ai_recommendation_note' => ['nullable', 'string'],
        ]);

        if (!$this->validOrganizationLinks($request, $data)) {
            return response()->json(['message' => 'Selected task links must belong to this organization.'], 422);
        }

        $task = Task::create([
            ...$data,
            'created_by' => $request->user()->id,
            'organization_id' => $request->user()->organization_id,
        ]);

        return response()->json(
            $task->load([
                'assignee:school_id,first_name,last_name',
                'creator:school_id,first_name,last_name',
                'event:id,title',
            ]),
            201
        );
    }

    public function update(Request $request, $id)
    {
        $task = Task::where('organization_id', $request->user()->organization_id)->find($id);

        if (!$task) {
            return response()->json(['message' => 'Task not found.'], 404);
        }

        if ($task->created_by !== $request->user()->id && $request->user()->role !== 'admin') {
            return response()->json(['message' => 'You are not authorized to edit this task.'], 403);
        }

        $data = $request->validate([
            'title'       => ['sometimes', 'required', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'deadline'    => ['sometimes', 'required', 'date'],
            'status'      => ['sometimes', 'required', 'in:pending,in_progress,completed,overdue'],
            'assigned_to' => ['nullable', 'exists:users,school_id'],
            'event_id'    => ['nullable', 'exists:events,id'],
            'ai_recommendation_note' => ['nullable', 'string'],
        ]);

        if (!$this->validOrganizationLinks($request, $data)) {
            return response()->json(['message' => 'Selected task links must belong to this organization.'], 422);
        }

        $task->update($data);

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

        if ($task->created_by !== $request->user()->id && $request->user()->role !== 'admin') {
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
        $isCreator  = $task->created_by === $userId;
        $isAssignee = $task->assigned_to === $userId;
        $isAdmin    = $request->user()->role === 'admin';

        if (!$isCreator && !$isAssignee && !$isAdmin) {
            return response()->json(['message' => 'You are not authorized to update this task.'], 403);
        }

        $data = $request->validate([
            'status' => ['required', 'in:pending,in_progress,completed,overdue'],
        ]);

        $task->update($data);

        return response()->json($task->fresh()->load([
            'assignee:school_id,first_name,last_name',
            'creator:school_id,first_name,last_name',
            'event:id,title',
        ]));
    }

    private function validOrganizationLinks(Request $request, array $data): bool
    {
        if (!empty($data['assigned_to'])) {
            $validAssignee = User::where('organization_id', $request->user()->organization_id)
                ->where('school_id', $data['assigned_to'])
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
}
