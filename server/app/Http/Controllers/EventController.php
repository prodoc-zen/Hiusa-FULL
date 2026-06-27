<?php

namespace App\Http\Controllers;

use App\Models\Event;
use App\Models\Attendance;
use App\Models\User;
use Illuminate\Http\Request;

class EventController extends Controller
{
    public function index(Request $request)
    {
        $user = $request->user();

        $query = Event::with('creator:id,first_name,last_name')
            ->withCount('attendanceRecords')
            ->orderBy('start_time', 'asc');

        if ($user->role === 'student') {
            $query->whereIn('status', ['approved', 'ongoing', 'completed']);
        }

        return response()->json($query->get());
    }

    public function show(Request $request, $id)
    {
        $event = Event::with([
            'creator:id,first_name,last_name',
            'tasks.assignee:id,first_name,last_name',
            'attendanceRecords.user:id,first_name,last_name,school_id',
        ])->withCount('attendanceRecords')->find($id);

        if (!$event) {
            return response()->json(['message' => 'Event not found.'], 404);
        }

        if ($request->user()->role === 'student' && !in_array($event->status, ['approved', 'ongoing', 'completed'])) {
            return response()->json(['message' => 'Event not available.'], 403);
        }

        return response()->json($event);
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'title'       => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'start_time'  => ['required', 'date'],
            'end_time'    => ['required', 'date', 'after:start_time'],
            'location'    => ['nullable', 'string', 'max:255'],
            'status'      => ['required', 'in:planning,approved,ongoing,completed,cancelled'],
        ]);

        $event = Event::create([
            ...$data,
            'created_by' => $request->user()->id,
        ]);

        return response()->json(
            $event->load('creator:id,first_name,last_name'),
            201
        );
    }

    public function update(Request $request, $id)
    {
        $event = Event::find($id);

        if (!$event) {
            return response()->json(['message' => 'Event not found.'], 404);
        }

        $data = $request->validate([
            'title'       => ['sometimes', 'required', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'start_time'  => ['sometimes', 'required', 'date'],
            'end_time'    => ['sometimes', 'required', 'date', 'after:start_time'],
            'location'    => ['nullable', 'string', 'max:255'],
            'status'      => ['sometimes', 'required', 'in:planning,approved,ongoing,completed,cancelled'],
        ]);

        $event->update($data);

        return response()->json($event->fresh()->load('creator:id,first_name,last_name'));
    }

    public function destroy($id)
    {
        $event = Event::find($id);

        if (!$event) {
            return response()->json(['message' => 'Event not found.'], 404);
        }

        $event->delete();

        return response()->json(['message' => 'Event deleted successfully.']);
    }

    public function updateStatus(Request $request, $id)
    {
        $event = Event::find($id);

        if (!$event) {
            return response()->json(['message' => 'Event not found.'], 404);
        }

        $data = $request->validate([
            'status' => ['required', 'in:planning,approved,ongoing,completed,cancelled'],
        ]);

        $event->update($data);

        return response()->json($event->fresh());
    }

    public function getAttendance($id)
    {
        $event = Event::find($id);

        if (!$event) {
            return response()->json(['message' => 'Event not found.'], 404);
        }

        $records = Attendance::with('user:id,first_name,last_name,school_id,role')
            ->where('event_id', $id)
            ->orderBy('check_in_time', 'asc')
            ->get();

        return response()->json([
            'event'   => $event->only(['id', 'title', 'start_time', 'end_time']),
            'count'   => $records->count(),
            'records' => $records,
        ]);
    }

    public function recordAttendance(Request $request, $id)
    {
        $event = Event::find($id);

        if (!$event) {
            return response()->json(['message' => 'Event not found.'], 404);
        }

        $data = $request->validate([
            'user_id' => ['required', 'exists:users,id'],
            'method'  => ['required', 'in:biometric,manual'],
        ]);

        $alreadyCheckedIn = Attendance::where('event_id', $id)
            ->where('user_id', $data['user_id'])
            ->exists();

        if ($alreadyCheckedIn) {
            return response()->json(['message' => 'This member is already checked in for this event.'], 409);
        }

        $record = Attendance::create([
            'event_id'      => $id,
            'user_id'       => $data['user_id'],
            'method'        => $data['method'],
            'check_in_time' => now(),
        ]);

        return response()->json(
            $record->load('user:id,first_name,last_name,school_id'),
            201
        );
    }
}
