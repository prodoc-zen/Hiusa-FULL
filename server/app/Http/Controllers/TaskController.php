<?php

namespace App\Http\Controllers;

use App\Models\Task;
use Illuminate\Http\Request;

class TaskController extends Controller
{
    public function index(Request $request)
    {
        $query = Task::with([
            'assignee:id,first_name,last_name',
            'creator:id,first_name,last_name',
            'event:id,title',
        ])->orderBy('deadline', 'asc');

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
            'assigned_to' => ['nullable', 'exists:users,id'],
            'event_id'    => ['nullable', 'exists:events,id'],
            'ai_recommendation_note' => ['nullable', 'string'],
        ]);

        $task = Task::create([
            ...$data,
            'created_by' => $request->user()->id,
        ]);

        return response()->json(
            $task->load([
                'assignee:id,first_name,last_name',
                'creator:id,first_name,last_name',
                'event:id,title',
            ]),
            201
        );
    }

    public function update(Request $request, $id)
    {
        $task = Task::find($id);

        if (!$task) {
            return response()->json(['message' => 'Task not found.'], 404);
        }

        $data = $request->validate([
            'title'       => ['sometimes', 'required', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'deadline'    => ['sometimes', 'required', 'date'],
            'status'      => ['sometimes', 'required', 'in:pending,in_progress,completed,overdue'],
            'assigned_to' => ['nullable', 'exists:users,id'],
            'event_id'    => ['nullable', 'exists:events,id'],
            'ai_recommendation_note' => ['nullable', 'string'],
        ]);

        $task->update($data);

        return response()->json($task->fresh()->load([
            'assignee:id,first_name,last_name',
            'creator:id,first_name,last_name',
            'event:id,title',
        ]));
    }

    public function destroy($id)
    {
        $task = Task::find($id);

        if (!$task) {
            return response()->json(['message' => 'Task not found.'], 404);
        }

        $task->delete();

        return response()->json(['message' => 'Task deleted successfully.']);
    }

    public function updateStatus(Request $request, $id)
    {
        $task = Task::find($id);

        if (!$task) {
            return response()->json(['message' => 'Task not found.'], 404);
        }

        $data = $request->validate([
            'status' => ['required', 'in:pending,in_progress,completed,overdue'],
        ]);

        $task->update($data);

        return response()->json($task->fresh());
    }
}
