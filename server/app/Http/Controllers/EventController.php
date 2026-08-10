<?php

namespace App\Http\Controllers;

use App\Models\ApprovalRequest;
use App\Models\Attendance;
use App\Models\AiOutput;
use App\Models\Event;
use App\Models\Task;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

class EventController extends Controller
{
    public function index(Request $request)
    {
        $user = $request->user();

        $query = Event::with('creator:school_id,first_name,last_name')
            ->where('organization_id', $user->organization_id)
            ->withCount('attendanceRecords')
            ->orderBy('start_time', 'asc');

        if (in_array($user->role, ['STUDENT', 'DEPARTMENT_HEAD'], true)) {
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
        $relations = ['creator:school_id,first_name,last_name'];

        if (in_array($request->user()->role, ['ADMIN', 'SBO_OFFICER'], true)) {
            $relations = [
                ...$relations,
                'tasks.assignee:school_id,first_name,last_name',
                'attendanceRecords.user:school_id,first_name,last_name,role',
                'attendanceRecords.recorder:school_id,first_name,last_name,role',
            ];
        }

        $event = Event::with($relations)
            ->where('organization_id', $request->user()->organization_id)
            ->withCount('attendanceRecords')
            ->find($id);

        if (!$event) {
            return response()->json(['message' => 'Event not found.'], 404);
        }

        if (in_array($request->user()->role, ['STUDENT', 'DEPARTMENT_HEAD'], true) && !in_array($event->status, ['approved', 'ongoing', 'completed'], true)) {
            return response()->json(['message' => 'Event not available.'], 403);
        }

        $this->attachApprovalInfo($event);

        return response()->json($event);
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'title' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'start_time' => ['required', 'date'],
            'end_time' => ['required', 'date', 'after:start_time'],
            'location' => ['nullable', 'string', 'max:255'],
            'requires_budget' => ['boolean'],
            'planning_details' => ['nullable'],
        ]);

        $event = Event::create([
            ...$data,
            'requires_budget' => $data['requires_budget'] ?? false,
            'status' => 'planning',
            'created_by' => $request->user()->id,
            'organization_id' => $request->user()->organization_id,
        ]);

        ApprovalRequest::create([
            'organization_id' => $request->user()->organization_id,
            'entity_type' => 'event',
            'entity_id' => $event->id,
            'requested_by' => $request->user()->id,
            'required_role' => 'DEPARTMENT_HEAD',
        ]);

        return response()->json($event->load('creator:school_id,first_name,last_name'), 201);
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
            'title' => ['sometimes', 'required', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'start_time' => ['sometimes', 'required', 'date'],
            'end_time' => ['sometimes', 'required', 'date'],
            'location' => ['nullable', 'string', 'max:255'],
            'status' => ['sometimes', 'required', 'in:planning,approved,ongoing,completed,cancelled'],
            'requires_budget' => ['boolean'],
            'planning_details' => ['nullable'],
        ]);

        $endTime = isset($data['end_time']) ? \Carbon\Carbon::parse($data['end_time']) : $event->end_time;
        $startTime = isset($data['start_time']) ? \Carbon\Carbon::parse($data['start_time']) : $event->start_time;

        if ($endTime->lte($startTime)) {
            return response()->json(['message' => 'End time must be after start time.'], 422);
        }

        if (($data['status'] ?? null) === 'approved' && ! $event->approved_at) {
            return response()->json(['message' => 'Event must be approved through the approval workflow.'], 422);
        }

        if (in_array($data['status'] ?? null, ['ongoing', 'completed'], true) && ! $event->approved_at) {
            return response()->json(['message' => 'Only approved events can be started or completed.'], 422);
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
            ->where('organization_id', $event->organization_id)
            ->get()
            ->each(fn (ApprovalRequest $approval) => $approval->resubmit());
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
            'status' => ['required', 'in:planning,approved,ongoing,completed,cancelled'],
        ]);

        if ($data['status'] === 'approved' && ! $event->approved_at) {
            return response()->json(['message' => 'Event must be approved through the approval workflow.'], 422);
        }

        if (in_array($data['status'], ['ongoing', 'completed'], true) && ! $event->approved_at) {
            return response()->json(['message' => 'Only approved events can be started or completed.'], 422);
        }

        $event->update($data);

        return response()->json($event->fresh()->load('creator:school_id,first_name,last_name'));
    }

    public function generatePlan(Request $request, $id)
    {
        $event = Event::where('organization_id', $request->user()->organization_id)->find($id);

        if (!$event) {
            return response()->json(['message' => 'Event not found.'], 404);
        }

        $data = $request->validate([
            'requirements' => ['required', 'string', 'max:4000'],
            'create_workflow' => ['boolean'],
            'model' => ['nullable', 'string', 'max:100'],
        ]);

        $model = $data['model'] ?? 'llama-3.1-8b-instant';
        $prompt = "Event: {$event->title}\nSchedule: {$event->start_time} to {$event->end_time}\nLocation: " . ($event->location ?: 'TBD') . "\nRequirements: {$data['requirements']}";
        $output = $this->generateEventPlanWithGroq($prompt, $model);

        return DB::transaction(function () use ($request, $event, $data, $prompt, $output, $model) {
            $aiOutput = AiOutput::create([
                'organization_id' => $request->user()->organization_id,
                'feature_type' => 'event_plan',
                'reference_type' => Event::class,
                'reference_id' => $event->id,
                'prompt_text' => $prompt,
                'output_text' => $output,
                'model_name' => $model,
                'requested_by' => $request->user()->id,
                'created_at' => now(),
            ]);

            $event->update([
                'planning_details' => [
                    'requirements' => $data['requirements'],
                    'generated_plan' => $output,
                    'ai_output_id' => $aiOutput->id,
                    'generated_at' => now()->toISOString(),
                ],
            ]);

            $tasks = [];
            if ($data['create_workflow'] ?? false) {
                foreach ($this->workflowTasksFromPlan($event, $output) as $taskData) {
                    $tasks[] = Task::create([
                        ...$taskData,
                        'event_id' => $event->id,
                        'status' => 'pending',
                        'task_type' => 'workflow',
                        'is_ai_generated' => true,
                        'ai_recommendation_note' => 'Generated from event planning requirements.',
                        'created_by' => $request->user()->id,
                        'organization_id' => $request->user()->organization_id,
                    ])->load('event:id,title');
                }
            }

            return response()->json([
                'ai_output' => $aiOutput,
                'plan' => $output,
                'tasks' => $tasks,
            ], 201);
        });
    }

    public function getAttendance(Request $request, $id)
    {
        $event = Event::where('organization_id', $request->user()->organization_id)->find($id);

        if (!$event) {
            return response()->json(['message' => 'Event not found.'], 404);
        }

        $recordsQuery = Attendance::with([
            'user:school_id,first_name,last_name,role',
            'recorder:school_id,first_name,last_name,role',
        ])
            ->where('event_id', $id)
            ->orderBy('check_in_time', 'asc');

        $canManageAttendance = in_array($request->user()->role, ['ADMIN', 'SBO_OFFICER'], true);
        if (!$canManageAttendance) {
            $recordsQuery->where('user_id', $request->user()->id);
        }

        $records = $recordsQuery->get();

        return response()->json([
            'event' => $event->only(['id', 'title', 'start_time', 'end_time']),
            'count' => $records->count(),
            'records' => $records,
            'can_manage_attendance' => $canManageAttendance,
        ]);
    }

    public function recordAttendance(Request $request, $id)
    {
        $event = Event::where('organization_id', $request->user()->organization_id)->find($id);

        if (!$event) {
            return response()->json(['message' => 'Event not found.'], 404);
        }

        $data = $request->validate([
            'user_id' => ['nullable', 'exists:users,school_id'],
            'method' => ['required', 'in:biometric,manual'],
            'check_out_time' => ['nullable', 'date'],
            'remarks' => ['nullable', 'string', 'max:255'],
        ]);

        if (!in_array($event->status, ['approved', 'ongoing'], true)) {
            return response()->json(['message' => 'Only approved or ongoing events can accept attendance.'], 422);
        }

        $canManageAttendance = in_array($request->user()->role, ['ADMIN', 'SBO_OFFICER'], true);
        $data['user_id'] = $canManageAttendance ? ($data['user_id'] ?? $request->user()->id) : $request->user()->id;

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
                'event_id' => $id,
                'user_id' => $data['user_id'],
                'method' => $data['method'],
                'check_in_time' => now(),
                'check_out_time' => $data['check_out_time'] ?? null,
                'recorded_by' => $request->user()->id,
                'remarks' => $data['remarks'] ?? null,
            ]);
        } catch (\Illuminate\Database\UniqueConstraintViolationException $e) {
            return response()->json(['message' => 'This member is already checked in for this event.'], 409);
        }

        return response()->json($record->load([
            'user:school_id,first_name,last_name',
            'recorder:school_id,first_name,last_name',
        ]), 201);
    }

    private function generateEventPlanWithGroq(string $prompt, string $model): string
    {
        $apiKey = env('GROQ_API_KEY');

        if (!$apiKey) {
            return $this->fallbackEventPlan($prompt);
        }

        try {
            $response = Http::withToken($apiKey)
                ->timeout(25)
                ->post('https://api.groq.com/openai/v1/chat/completions', [
                    'model' => $model,
                    'messages' => [
                        ['role' => 'system', 'content' => 'Create concise student-organization event plans. Include timeline, resource checklist, and possible delays or conflicts.'],
                        ['role' => 'user', 'content' => $prompt],
                    ],
                    'temperature' => 0.35,
                    'max_tokens' => 700,
                ]);

            if ($response->successful()) {
                $content = trim((string) data_get($response->json(), 'choices.0.message.content'));
                if ($content !== '') {
                    return $content;
                }
            }
        } catch (\Throwable) {
            return $this->fallbackEventPlan($prompt);
        }

        return $this->fallbackEventPlan($prompt);
    }

    private function fallbackEventPlan(string $prompt): string
    {
        $eventTitle = trim(Str::before(Str::after($prompt, 'Event: '), "\n")) ?: 'Event';

        return "{$eventTitle} Event Plan\n\nTimeline:\n- Confirm venue, program flow, and responsible officers.\n- Prepare materials, registration, and communication assets.\n- Run final readiness checks before event day.\n\nResource Checklist:\n- Venue setup, attendance materials, logistics supplies, program host, documentation, and contingency contacts.\n\nPossible Delays or Conflicts:\n- Venue availability, supplier lead time, overlapping academic schedules, and late participant confirmations.";
    }

    private function workflowTasksFromPlan(Event $event, string $plan): array
    {
        $deadline = $event->start_time ?: now()->addDays(7);
        $baseDescription = Str::limit($plan, 500);

        return [
            ['title' => 'Finalize event timeline', 'description' => $baseDescription, 'deadline' => $deadline],
            ['title' => 'Prepare resource checklist', 'description' => $baseDescription, 'deadline' => $deadline],
            ['title' => 'Review risks and contingency actions', 'description' => $baseDescription, 'deadline' => $deadline],
        ];
    }
}
