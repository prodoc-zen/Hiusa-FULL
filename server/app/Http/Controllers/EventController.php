<?php

namespace App\Http\Controllers;

use App\Models\ApprovalRequest;
use App\Models\Event;
use App\Models\Attendance;
use App\Models\User;
use Illuminate\Http\Request;

class EventController extends Controller
{
    public function index(Request $request)
    {
        $user = $request->user();

        $query = Event::with('creator:school_id,first_name,last_name')
            ->where('organization_id', $user->organization_id)
            ->withCount('attendanceRecords')
            ->orderBy('start_time', 'asc');

        if ($user->role === 'STUDENT') {
            $query->whereIn('status', ['approved', 'ongoing', 'completed']);
        }

        $events = $query->get();

        $this->attachApprovalInfo($events);

        return response()->json($events);
    }

    private function attachApprovalInfo($events): void
    {
        $ids = $events instanceof Event ? [$events->id] : $events->pluck('id');

        $approvals = ApprovalRequest::where('entity_type', 'event')
            ->whereIn('entity_id', $ids)
            ->get()
            ->keyBy('entity_id');

        foreach (($events instanceof Event ? [$events] : $events) as $event) {
            $approval = $approvals->get($event->id);
            $event->approval_status = $approval?->status;
            $event->approval_remarks = $approval?->remarks;
        }
    }

    public function show(Request $request, $id)
    {
        $event = Event::with([
            'creator:school_id,first_name,last_name',
            'tasks.assignee:school_id,first_name,last_name',
            'attendanceRecords.user:school_id,first_name,last_name,role',
        ])
            ->where('organization_id', $request->user()->organization_id)
            ->withCount('attendanceRecords')
            ->find($id);

        if (!$event) {
            return response()->json(['message' => 'Event not found.'], 404);
        }

        if ($request->user()->role === 'STUDENT' && !in_array($event->status, ['approved', 'ongoing', 'completed'])) {
            return response()->json(['message' => 'Event not available.'], 403);
        }

        $this->attachApprovalInfo($event);

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
        ]);

        $event = Event::create([
            ...$data,
            'status' => 'planning',
            'created_by' => $request->user()->id,
            'organization_id' => $request->user()->organization_id,
        ]);

        ApprovalRequest::create([
            'organization_id' => $request->user()->organization_id,
            'entity_type' => 'event',
            'entity_id' => $event->id,
            'title' => $event->title,
            'summary' => [
                'start_time' => $event->start_time,
                'end_time' => $event->end_time,
                'location' => $event->location,
            ],
            'requested_by' => $request->user()->id,
        ]);

        return response()->json(
            $event->load('creator:school_id,first_name,last_name'),
            201
        );
    }

    public function update(Request $request, $id)
    {
        $event = Event::where('organization_id', $request->user()->organization_id)->find($id);

        if (!$event) {
            return response()->json(['message' => 'Event not found.'], 404);
        }

        if ($event->created_by !== $request->user()->id && $request->user()->role !== 'ADMIN') {
            return response()->json(['message' => 'You are not authorized to edit this event.'], 403);
        }

        $data = $request->validate([
            'title'       => ['sometimes', 'required', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'start_time'  => ['sometimes', 'required', 'date'],
            'end_time'    => ['sometimes', 'required', 'date'],
            'location'    => ['nullable', 'string', 'max:255'],
            'status'      => ['sometimes', 'required', 'in:planning,ongoing,completed,cancelled'],
        ]);

        $endTime   = isset($data['end_time'])   ? \Carbon\Carbon::parse($data['end_time'])   : $event->end_time;
        $startTime = isset($data['start_time']) ? \Carbon\Carbon::parse($data['start_time']) : $event->start_time;

        if ($endTime->lte($startTime)) {
            return response()->json(['message' => 'End time must be after start time.'], 422);
        }

        $event->update($data);

        $this->resubmitIfRejected($event);

        return response()->json($event->fresh()->load('creator:school_id,first_name,last_name'));
    }

    private function resubmitIfRejected(Event $event): void
    {
        ApprovalRequest::where('entity_type', 'event')
            ->where('entity_id', $event->id)
            ->where('status', 'rejected')
            ->update([
                'status' => 'pending',
                'reviewed_by' => null,
                'reviewed_at' => null,
                'remarks' => null,
                'requested_at' => now(),
            ]);
    }

    public function destroy(Request $request, $id)
    {
        $event = Event::where('organization_id', $request->user()->organization_id)->find($id);

        if (!$event) {
            return response()->json(['message' => 'Event not found.'], 404);
        }

        if ($event->created_by !== $request->user()->id && $request->user()->role !== 'ADMIN') {
            return response()->json(['message' => 'You are not authorized to delete this event.'], 403);
        }

        $event->delete();

        return response()->json(['message' => 'Event deleted successfully.']);
    }

    public function updateStatus(Request $request, $id)
    {
        $event = Event::where('organization_id', $request->user()->organization_id)->find($id);

        if (!$event) {
            return response()->json(['message' => 'Event not found.'], 404);
        }

        if ($event->created_by !== $request->user()->id && $request->user()->role !== 'ADMIN') {
            return response()->json(['message' => 'You are not authorized to update this event status.'], 403);
        }

        $data = $request->validate([
            'status' => ['required', 'in:planning,ongoing,completed,cancelled'],
        ]);

        $event->update($data);

        return response()->json($event->fresh()->load('creator:school_id,first_name,last_name'));
    }

    public function getAttendance(Request $request, $id)
    {
        $event = Event::where('organization_id', $request->user()->organization_id)->find($id);

        if (!$event) {
            return response()->json(['message' => 'Event not found.'], 404);
        }

        $records = Attendance::with('user:school_id,first_name,last_name,role')
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
        $event = Event::where('organization_id', $request->user()->organization_id)->find($id);

        if (!$event) {
            return response()->json(['message' => 'Event not found.'], 404);
        }

        $data = $request->validate([
            'user_id' => ['required', 'exists:users,school_id'],
            'method'  => ['required', 'in:biometric,manual'],
        ]);

        $attendeeBelongsToOrganization = User::where('organization_id', $request->user()->organization_id)
            ->where('school_id', $data['user_id'])
            ->exists();

        if (!$attendeeBelongsToOrganization) {
            return response()->json(['message' => 'Selected user does not belong to this organization.'], 422);
        }

        $alreadyCheckedIn = Attendance::where('event_id', $id)
            ->where('user_id', $data['user_id'])
            ->exists();

        if ($alreadyCheckedIn) {
            return response()->json(['message' => 'This member is already checked in for this event.'], 409);
        }

        try {
            $record = Attendance::create([
                'event_id'      => $id,
                'user_id'       => $data['user_id'],
                'method'        => $data['method'],
                'check_in_time' => now(),
            ]);
        } catch (\Illuminate\Database\UniqueConstraintViolationException $e) {
            return response()->json(['message' => 'This member is already checked in for this event.'], 409);
        }

        return response()->json(
            $record->load('user:school_id,first_name,last_name'),
            201
        );
    }
}
