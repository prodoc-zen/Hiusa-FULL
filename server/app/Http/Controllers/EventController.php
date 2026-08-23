<?php

namespace App\Http\Controllers;

use App\Models\AiOutput;
use App\Models\ApprovalRequest;
use App\Models\Attendance;
use App\Models\Event;
use App\Models\Task;
use App\Models\User;
use App\Services\GroqResponsesService;
use Carbon\Carbon;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class EventController extends Controller
{
    public function __construct(private readonly GroqResponsesService $groq) {}

    public function index(Request $request)
    {
        $user = $request->user();

        $query = Event::with('creator:school_id,first_name,last_name')
            ->where('organization_id', $user->organization_id)
            ->withCount('attendanceRecords')
            ->orderBy('start_time', 'asc');

        if ($user->role !== 'ADMIN') {
            $query->whereIn('status', ['approved', 'ongoing', 'completed']);
        }

        $events = $query->get();
        $this->attachApprovalInfo($events);

        if ($user->role === 'ADMIN') {
            $this->loadLinkedBudgets($events);
        }

        return response()->json($events);
    }

    private function attachApprovalInfo($events): void
    {
        $ids = $events instanceof Event ? [$events->id] : $events->pluck('id');

        $approvals = ApprovalRequest::where('entity_type', 'event')
            ->whereIn('entity_id', $ids)
            ->orderBy('id')
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

        if (! $event) {
            return response()->json(['message' => 'Event not found.'], 404);
        }

        if ($request->user()->role !== 'ADMIN' && ! in_array($event->status, ['approved', 'ongoing', 'completed'], true)) {
            return response()->json(['message' => 'Event not available.'], 403);
        }

        $this->attachApprovalInfo($event);

        if ($request->user()->role === 'ADMIN') {
            $this->loadLinkedBudgets($event);
            $event->attendance_summary = collect(['present', 'late', 'excused', 'absent'])
                ->mapWithKeys(fn (string $status) => [
                    $status => $event->attendanceRecords()->where('status', $status)->count(),
                ]);
        }

        return response()->json($event);
    }

    private function loadLinkedBudgets($events): void
    {
        $events = $events instanceof Event
            ? new \Illuminate\Database\Eloquent\Collection([$events])
            : $events;

        $events->load([
            'budgets' => fn ($query) => $query
                ->withCount('transactions')
                ->orderBy('created_at', 'desc'),
        ]);

        $budgets = $events->flatMap(fn (Event $event) => $event->budgets);

        if ($budgets->isEmpty()) {
            return;
        }

        $approvals = ApprovalRequest::where('entity_type', 'budget')
            ->whereIn('entity_id', $budgets->pluck('id'))
            ->orderBy('id')
            ->get()
            ->keyBy('entity_id');

        foreach ($budgets as $budget) {
            $approval = $approvals->get($budget->id);
            $budget->approval_status = $approval?->status;
            $budget->approval_remarks = $approval?->remarks;
        }
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
            'planning_details' => ['nullable', 'array'],
            'planning_details.budget_notes' => ['nullable', 'string', 'max:5000'],
            'planning_details.vendor_deadlines' => ['nullable', 'string', 'max:5000'],
            'planning_details.logistics_checklist' => ['nullable', 'string', 'max:5000'],
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

        if (! $event) {
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
            'planning_details' => ['nullable', 'array'],
            'planning_details.budget_notes' => ['nullable', 'string', 'max:5000'],
            'planning_details.vendor_deadlines' => ['nullable', 'string', 'max:5000'],
            'planning_details.logistics_checklist' => ['nullable', 'string', 'max:5000'],
        ]);

        $endTime = isset($data['end_time']) ? Carbon::parse($data['end_time']) : $event->end_time;
        $startTime = isset($data['start_time']) ? Carbon::parse($data['start_time']) : $event->start_time;

        if ($endTime->lte($startTime)) {
            return response()->json(['message' => 'End time must be after start time.'], 422);
        }

        if (($data['status'] ?? null) === 'approved' && ! $event->approved_at) {
            return response()->json(['message' => 'Event must be approved through the approval workflow.'], 422);
        }

        if (in_array($data['status'] ?? null, ['ongoing', 'completed'], true) && ! $event->approved_at) {
            return response()->json(['message' => 'Only approved events can be started or completed.'], 422);
        }

        if (! empty($data['status']) && ! $this->validStatusTransition($event->status, $data['status'])) {
            return response()->json(['message' => "Event status cannot change from {$event->status} to {$data['status']}."], 422);
        }

        if ($this->hasMaterialEventChange($data) && ($event->status === 'completed' || $event->attendanceRecords()->exists())) {
            return response()->json(['message' => 'Event details cannot be changed after attendance has been recorded or the event is completed.'], 409);
        }

        if ($event->approved_at && $this->hasMaterialEventChange($data)) {
            $data['status'] = 'planning';
            $data['approved_at'] = null;
            $this->reopenApproval($event, $request);
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

    private function hasMaterialEventChange(array $data): bool
    {
        return count(array_intersect(array_keys($data), [
            'title',
            'description',
            'start_time',
            'end_time',
            'location',
            'requires_budget',
            'planning_details',
        ])) > 0;
    }

    private function validStatusTransition(string $currentStatus, string $nextStatus): bool
    {
        $allowed = [
            'planning' => ['planning', 'cancelled'],
            'approved' => ['approved', 'ongoing', 'completed', 'cancelled'],
            'ongoing' => ['ongoing', 'completed', 'cancelled'],
            'completed' => ['completed'],
            'cancelled' => ['cancelled'],
        ];

        return in_array($nextStatus, $allowed[$currentStatus] ?? [], true);
    }

    private function reopenApproval(Event $event, Request $request): void
    {
        ApprovalRequest::where('entity_type', 'event')
            ->where('entity_id', $event->id)
            ->where('organization_id', $event->organization_id)
            ->latest('id')
            ->first()
            ?->reopen($request->user()->id, 'DEPARTMENT_HEAD');
    }

    public function destroy(Request $request, $id)
    {
        $event = Event::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $event) {
            return response()->json(['message' => 'Event not found.'], 404);
        }

        if ($event->created_by !== $request->user()->id && $request->user()->role !== 'ADMIN') {
            return response()->json(['message' => 'You are not authorized to delete this event.'], 403);
        }

        DB::transaction(function () use ($event) {
            ApprovalRequest::where('organization_id', $event->organization_id)
                ->where('entity_type', 'event')
                ->where('entity_id', $event->id)
                ->delete();
            $event->delete();
        });

        return response()->json(['message' => 'Event deleted successfully.']);
    }

    public function updateStatus(Request $request, $id)
    {
        $event = Event::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $event) {
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

        if (! $this->validStatusTransition($event->status, $data['status'])) {
            return response()->json(['message' => "Event status cannot change from {$event->status} to {$data['status']}."], 422);
        }

        $event->update($data);

        return response()->json($event->fresh()->load('creator:school_id,first_name,last_name'));
    }

    public function generatePlan(Request $request, $id)
    {
        $event = Event::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $event) {
            return response()->json(['message' => 'Event not found.'], 404);
        }

        $data = $request->validate([
            'requirements' => ['required', 'string', 'max:4000'],
            'create_workflow' => ['boolean'],
            'model' => ['nullable', 'string', 'max:100'],
        ]);

        $prompt = "Event: {$event->title}\nSchedule: {$event->start_time} to {$event->end_time}\nLocation: ".($event->location ?: 'TBD')."\nRequirements: {$data['requirements']}";
        $generated = $this->groq->generate(
            'Create a concise student-organization event plan. Include a timeline, required resources, a checklist, and possible delays or schedule conflicts.',
            $prompt,
            700,
            0.35,
        );
        $output = $generated['text'] ?? $this->fallbackEventPlan($prompt);
        $model = $generated['model'] ?? 'deterministic-fallback';

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
                    ...($event->planning_details ?? []),
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

        if (! $event) {
            return response()->json(['message' => 'Event not found.'], 404);
        }

        $recordsQuery = Attendance::with([
            'user:school_id,first_name,last_name,role',
            'recorder:school_id,first_name,last_name,role',
        ])
            ->where('event_id', $id)
            ->orderBy('check_in_time', 'asc');

        $canManageAttendance = in_array($request->user()->role, ['ADMIN', 'SBO_OFFICER'], true);
        if (! $canManageAttendance) {
            $recordsQuery->where('user_id', $request->user()->id);
        }

        $records = $recordsQuery->get();
        $summary = collect(['present', 'late', 'excused', 'absent'])
            ->mapWithKeys(fn (string $status) => [$status => $records->where('status', $status)->count()]);

        return response()->json([
            'event' => $event->only(['id', 'title', 'start_time', 'end_time', 'status']),
            'count' => $records->count(),
            'summary' => $summary,
            'records' => $records,
            'can_manage_attendance' => $canManageAttendance,
            'biometric_adapter' => [
                'configured' => false,
                'message' => 'Fingerprint capture and matching will be enabled when scanner hardware is connected.',
            ],
        ]);
    }

    public function recordAttendance(Request $request, $id)
    {
        $event = Event::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $event) {
            return response()->json(['message' => 'Event not found.'], 404);
        }

        $data = $request->validate([
            'user_id' => ['nullable', 'exists:users,school_id'],
            'method' => ['required', 'in:biometric,manual'],
            'status' => ['nullable', 'in:present,late,excused,absent'],
            'check_out_time' => ['nullable', 'date'],
            'remarks' => ['nullable', 'string', 'max:255'],
        ]);

        if (! in_array($event->status, ['approved', 'ongoing'], true)) {
            return response()->json(['message' => 'Only approved or ongoing events can accept attendance.'], 422);
        }

        $canManageAttendance = in_array($request->user()->role, ['ADMIN', 'SBO_OFFICER'], true);
        $data['user_id'] = $canManageAttendance ? ($data['user_id'] ?? $request->user()->id) : $request->user()->id;

        if (! $canManageAttendance && (now()->lt($event->start_time) || now()->gt($event->end_time))) {
            return response()->json(['message' => 'Self check-in is only available during the scheduled event period.'], 422);
        }

        if (! $canManageAttendance && (($data['status'] ?? 'present') !== 'present' || $data['method'] !== 'manual')) {
            return response()->json(['message' => 'Self check-in can only be recorded as present using manual check-in.'], 403);
        }

        if ($data['method'] === 'biometric') {
            return response()->json([
                'message' => 'Biometric attendance is prepared but unavailable until fingerprint scanner verification is connected.',
            ], 501);
        }

        $attendeeBelongsToOrganization = User::where('organization_id', $request->user()->organization_id)
            ->where('school_id', $data['user_id'])
            ->exists();

        if (! $attendeeBelongsToOrganization) {
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
                'status' => $data['status'] ?? 'present',
                'check_in_time' => now(),
                'check_out_time' => $data['check_out_time'] ?? null,
                'recorded_by' => $request->user()->id,
                'remarks' => $data['remarks'] ?? null,
            ]);
        } catch (UniqueConstraintViolationException $e) {
            return response()->json(['message' => 'This member is already checked in for this event.'], 409);
        }

        return response()->json($record->load([
            'user:school_id,first_name,last_name',
            'recorder:school_id,first_name,last_name',
        ]), 201);
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
