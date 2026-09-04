<?php

namespace App\Http\Controllers;

use App\Models\AiOutput;
use App\Models\ApprovalRequest;
use App\Models\Attendance;
use App\Models\AuditLog;
use App\Models\Budget;
use App\Models\Event;
use App\Models\FinancialForecast;
use App\Models\Notification;
use App\Models\SboPosition;
use App\Models\Task;
use App\Models\User;
use App\Services\GroqResponsesService;
use App\Services\TaskDelegationService;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class EventController extends Controller
{
    public function __construct(
        private readonly GroqResponsesService $groq,
        private readonly TaskDelegationService $delegation,
    ) {}

    public function index(Request $request)
    {
        $user = $request->user();

        $paging = $request->validate([
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
            'page' => ['nullable', 'integer', 'min:1'],
            'search' => ['nullable', 'string', 'max:100'],
            'status' => ['nullable', 'in:planning,approved,ongoing,completed,cancelled'],
            'date' => ['nullable', 'date_format:Y-m-d'],
            'sort' => ['nullable', 'in:start_asc,start_desc,newest,title'],
        ]);

        $query = Event::with('creator:school_id,first_name,last_name,role,position_title')
            ->where('organization_id', $user->organization_id)
            ->withCount([
                'attendanceRecords',
                'tasks',
                'attendanceRecords as present_count' => fn ($attendance) => $attendance->whereIn('status', ['present', 'late']),
            ]);

        if ($user->role !== 'ADMIN') {
            $query->whereIn('status', ['approved', 'ongoing', 'completed']);
        }

        if (! empty($paging['search'])) {
            $search = '%'.str_replace(['%', '_'], ['\\%', '\\_'], trim($paging['search'])).'%';
            $query->where(function ($events) use ($search) {
                $events->where('title', 'like', $search)
                    ->orWhere('description', 'like', $search)
                    ->orWhere('location', 'like', $search);
            });
        }
        if (! empty($paging['status'])) {
            $query->where('status', $paging['status']);
        }
        if (! empty($paging['date'])) {
            $query->whereDate('start_time', $paging['date']);
        }

        match ($paging['sort'] ?? 'start_asc') {
            'start_desc' => $query->orderByDesc('start_time')->orderByDesc('id'),
            'newest' => $query->orderByDesc('created_at')->orderByDesc('id'),
            'title' => $query->orderBy('title')->orderBy('id'),
            default => $query->orderBy('start_time')->orderBy('id'),
        };

        $events = $query->paginate($paging['per_page'] ?? 20);
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
            ? new Collection([$events])
            : $events;

        if ($events->isEmpty()) {
            return;
        }

        $events->load([
            'budgets' => fn ($query) => $query
                ->withCount('transactions')
                ->withSum(['transactions as spent_amount' => fn ($transactions) => $transactions->where('type', 'expense')], 'amount')
                ->withSum(['transactions as income_amount' => fn ($transactions) => $transactions->where('type', 'income')], 'amount')
                ->orderBy('created_at', 'desc'),
        ]);

        $budgets = $events->flatMap(fn (Event $event) => $event->budgets);

        $approvals = $budgets->isEmpty()
            ? collect()
            : ApprovalRequest::where('organization_id', $events->first()->organization_id)
                ->where('entity_type', 'budget')
                ->whereIn('entity_id', $budgets->pluck('id'))
                ->orderBy('id')
                ->get()
                ->keyBy('entity_id');

        foreach ($budgets as $budget) {
            $approval = $approvals->get($budget->id);
            $budget->approval_status = $approval?->status;
            $budget->approval_remarks = $approval?->remarks;
        }

        $latestForecast = FinancialForecast::where('organization_id', $events->first()->organization_id)
            ->orderByDesc('forecast_period')
            ->orderByDesc('id')
            ->first();

        foreach ($events as $event) {
            $eventBudgets = $event->budgets;
            $risk = $eventBudgets->sortByDesc(fn (Budget $budget) => match ($budget->overspending_risk) {
                'high' => 3,
                'medium' => 2,
                default => 1,
            })->first()?->overspending_risk;

            $event->financial_summary = [
                'allocated_budget' => round((float) $eventBudgets->sum('allocated_amount'), 2),
                'spent' => round((float) $eventBudgets->sum('spent_amount'), 2),
                'income' => round((float) $eventBudgets->sum('income_amount'), 2),
                'remaining_budget' => round((float) $eventBudgets->sum('remaining_amount'), 2),
                'risk' => $risk ?? 'not_analyzed',
                'latest_forecast' => $latestForecast?->only([
                    'id', 'forecast_period', 'predicted_income', 'predicted_expense',
                    'predicted_balance', 'safe_spending_limit', 'confidence_note',
                ]),
            ];
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
            'planning_details' => ['nullable', 'array:budget_notes,vendor_deadlines,logistics_checklist,event_type,expected_participants,requirements,resources,proposed_budget_amount,budget_warning_threshold'],
            'planning_details.budget_notes' => ['nullable', 'string', 'max:5000'],
            'planning_details.vendor_deadlines' => ['nullable', 'string', 'max:5000'],
            'planning_details.logistics_checklist' => ['nullable', 'string', 'max:5000'],
            'planning_details.event_type' => ['nullable', 'string', 'max:100'],
            'planning_details.expected_participants' => ['nullable', 'integer', 'min:1', 'max:1000000'],
            'planning_details.requirements' => ['nullable', 'string', 'max:5000'],
            'planning_details.resources' => ['nullable', 'string', 'max:5000'],
            'planning_details.proposed_budget_amount' => ['nullable', 'numeric', 'min:0.01'],
            'planning_details.budget_warning_threshold' => ['nullable', 'numeric', 'min:0'],
            'image' => ['nullable', 'image', 'mimes:jpeg,png,webp', 'max:5120'],
        ]);

        $proposedBudget = (float) data_get($data, 'planning_details.proposed_budget_amount', 0);
        $warningThreshold = (float) data_get($data, 'planning_details.budget_warning_threshold', 0);
        if ($proposedBudget > 0 && ! ($data['requires_budget'] ?? false)) {
            return response()->json(['message' => 'Enable budget allocation before entering a proposed budget.'], 422);
        }
        if ($warningThreshold > $proposedBudget) {
            return response()->json(['message' => 'The budget warning threshold cannot exceed the proposed budget.'], 422);
        }
        if (($data['requires_budget'] ?? false) && trim((string) data_get($data, 'planning_details.budget_notes')) === '') {
            return response()->json(['message' => 'Budget requirements or funding notes are required for events that need a budget.'], 422);
        }

        unset($data['image']);
        if ($request->hasFile('image')) {
            $data['image_url'] = Storage::disk('public')->url($request->file('image')->store('events', 'public'));
        }

        $event = DB::transaction(function () use ($data, $request, $proposedBudget, $warningThreshold) {
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

            if ($proposedBudget > 0) {
                $budget = Budget::create([
                    'organization_id' => $event->organization_id,
                    'event_id' => $event->id,
                    'title' => $event->title.' Proposed Budget',
                    'allocated_amount' => $proposedBudget,
                    'remaining_amount' => $proposedBudget,
                    'warning_threshold' => $warningThreshold,
                ]);
                ApprovalRequest::create([
                    'organization_id' => $event->organization_id,
                    'entity_type' => 'budget',
                    'entity_id' => $budget->id,
                    'requested_by' => $request->user()->id,
                    'required_role' => 'DEPARTMENT_HEAD',
                ]);
                $event->update(['planning_details' => [
                    ...($event->planning_details ?? []),
                    'proposed_budget_id' => $budget->id,
                ]]);
            }

            return $event;
        });

        $event->load('creator:school_id,first_name,last_name');
        $this->loadLinkedBudgets($event);

        return response()->json($event, 201);
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
            'planning_details' => ['nullable', 'array:budget_notes,vendor_deadlines,logistics_checklist,event_type,expected_participants,requirements,resources,proposed_budget_amount,budget_warning_threshold'],
            'planning_details.budget_notes' => ['nullable', 'string', 'max:5000'],
            'planning_details.vendor_deadlines' => ['nullable', 'string', 'max:5000'],
            'planning_details.logistics_checklist' => ['nullable', 'string', 'max:5000'],
            'planning_details.event_type' => ['nullable', 'string', 'max:100'],
            'planning_details.expected_participants' => ['nullable', 'integer', 'min:1', 'max:1000000'],
            'planning_details.requirements' => ['nullable', 'string', 'max:5000'],
            'planning_details.resources' => ['nullable', 'string', 'max:5000'],
            'planning_details.proposed_budget_amount' => ['nullable', 'numeric', 'min:0.01'],
            'planning_details.budget_warning_threshold' => ['nullable', 'numeric', 'min:0'],
            'image' => ['nullable', 'image', 'mimes:jpeg,png,webp', 'max:5120'],
            'remove_image' => ['sometimes', 'boolean'],
        ]);

        $existingPlanning = $event->planning_details ?? [];
        $updatedPlanning = array_key_exists('planning_details', $data)
            ? [...$existingPlanning, ...($data['planning_details'] ?? [])]
            : $existingPlanning;
        if (array_key_exists('planning_details', $data)) {
            $data['planning_details'] = $updatedPlanning;
        }
        $requiresBudget = (bool) ($data['requires_budget'] ?? $event->requires_budget);
        if ($requiresBudget && trim((string) ($updatedPlanning['budget_notes'] ?? '')) === '') {
            return response()->json(['message' => 'Budget requirements or funding notes are required for events that need a budget.'], 422);
        }
        $updatedProposal = (float) ($updatedPlanning['proposed_budget_amount'] ?? 0);
        $updatedThreshold = (float) ($updatedPlanning['budget_warning_threshold'] ?? 0);
        if ($updatedProposal > 0 && ! $requiresBudget) {
            return response()->json(['message' => 'Enable budget allocation before entering a proposed budget.'], 422);
        }
        if ($updatedThreshold > $updatedProposal) {
            return response()->json(['message' => 'The budget warning threshold cannot exceed the proposed budget.'], 422);
        }
        if (! empty($existingPlanning['proposed_budget_id'])) {
            $currentProposal = (float) ($existingPlanning['proposed_budget_amount'] ?? 0);
            $updatedProposal = (float) ($updatedPlanning['proposed_budget_amount'] ?? $currentProposal);
            if (abs($currentProposal - $updatedProposal) > 0.001) {
                return response()->json(['message' => 'Change the linked proposed budget through Finance to preserve its approval history.'], 422);
            }
            $updatedPlanning['proposed_budget_id'] = $existingPlanning['proposed_budget_id'];
            $data['planning_details'] = $updatedPlanning;
        }

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

        $oldImageUrl = $event->image_url;
        $removeImage = (bool) ($data['remove_image'] ?? false);
        unset($data['image'], $data['remove_image']);
        if ($request->hasFile('image')) {
            $data['image_url'] = Storage::disk('public')->url($request->file('image')->store('events', 'public'));
        } elseif ($removeImage) {
            $data['image_url'] = null;
        }

        $event->update($data);
        if (($request->hasFile('image') || $removeImage) && $oldImageUrl) {
            Storage::disk('public')->delete($this->publicStoragePath($oldImageUrl));
        }
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
            'image',
            'remove_image',
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

        $imageUrl = $event->image_url;
        DB::transaction(function () use ($event) {
            ApprovalRequest::where('organization_id', $event->organization_id)
                ->where('entity_type', 'event')
                ->where('entity_id', $event->id)
                ->delete();
            $event->delete();
        });
        if ($imageUrl) {
            Storage::disk('public')->delete($this->publicStoragePath($imageUrl));
        }

        return response()->json(['message' => 'Event deleted successfully.']);
    }

    private function publicStoragePath(string $url): string
    {
        $path = parse_url($url, PHP_URL_PATH) ?: $url;

        return ltrim(Str::after($path, '/storage/'), '/');
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
        $event = Event::with('budgets')
            ->where('organization_id', $request->user()->organization_id)
            ->find($id);

        if (! $event) {
            return response()->json(['message' => 'Event not found.'], 404);
        }

        $data = $request->validate([
            'requirements' => ['required', 'string', 'max:4000'],
            'model' => ['nullable', 'string', 'max:100'],
        ]);

        if ($event->start_time->lte(now()->addMinutes(5))) {
            return response()->json([
                'message' => 'Workflow tasks require an event that starts at least five minutes in the future.',
            ], 422);
        }

        if (AiOutput::where('organization_id', $event->organization_id)
            ->where('feature_type', 'EVENT_WORKFLOW')->where('reference_type', Event::class)
            ->where('reference_id', $event->id)->where('decision_status', 'accepted')->exists()) {
            return response()->json(['message' => 'This event already has a confirmed workflow. Existing active tasks are never overwritten by regeneration.'], 409);
        }

        $conflicts = Event::where('organization_id', $event->organization_id)
            ->whereKeyNot($event->id)
            ->where('start_time', '<', $event->end_time)
            ->where('end_time', '>', $event->start_time)
            ->get(['id', 'title', 'start_time', 'end_time', 'location'])
            ->toArray();
        $context = [
            'event' => $event->only(['id', 'title', 'description', 'start_time', 'end_time', 'location', 'requires_budget']),
            'requirements' => $data['requirements'],
            'existing_planning_details' => $event->planning_details ?? [],
            'linked_budgets' => $event->budgets->map->only(['id', 'title', 'allocated_amount', 'remaining_amount', 'approval_status'])->values()->all(),
            'schedule_conflicts' => $conflicts,
            'allowed_positions' => SboPosition::where('organization_id', $event->organization_id)
                ->where('role', 'SBO_OFFICER')
                ->where('is_active', true)
                ->orderBy('title')
                ->pluck('title')
                ->values()
                ->all(),
        ];
        $generated = $this->groq->generateStructured(
            'Create a practical student-organization event plan from only the supplied facts. Do not invent fees, names, vendors, venues, dates, or approvals. Use null or identify an item as unresolved when information is missing. Produce realistic, editable workflow tasks in dependency order. Pre-event deadlines must be before the event, event-day deadlines must fall during the event, and post-event deadlines must be after it ends but within 30 days.',
            $context,
            'hiusa_event_workflow',
            $this->eventWorkflowSchema(),
            2400,
            0.25,
        );
        $version = ((int) AiOutput::where('organization_id', $event->organization_id)
            ->where('feature_type', 'EVENT_WORKFLOW')
            ->where('reference_type', Event::class)
            ->where('reference_id', $event->id)
            ->max('version')) + 1;

        if (! $generated) {
            AiOutput::create([
                'organization_id' => $event->organization_id,
                'feature_type' => 'EVENT_WORKFLOW',
                'reference_type' => Event::class,
                'reference_id' => $event->id,
                'prompt_text' => 'Structured event workflow generation',
                'output_text' => '',
                'structured_input' => $context,
                'status' => 'failed',
                'error_message' => 'Groq was unavailable or returned an invalid response.',
                'version' => $version,
                'decision_status' => 'rejected',
                'requested_by' => $request->user()->school_id,
                'created_at' => now(),
            ]);

            return response()->json(['message' => 'Unable to generate the event plan. The AI service is temporarily unavailable or returned an invalid response.'], 503);
        }

        $workflow = $this->normalizeWorkflow($generated['data'], $event, $context['allowed_positions']);
        if ($workflow === null) {
            AiOutput::create([
                'organization_id' => $event->organization_id,
                'feature_type' => 'EVENT_WORKFLOW',
                'reference_type' => Event::class,
                'reference_id' => $event->id,
                'prompt_text' => 'Structured event workflow generation',
                'output_text' => $generated['text'],
                'model_name' => $generated['model'],
                'structured_input' => $context,
                'structured_output' => $generated['data'],
                'status' => 'failed',
                'error_message' => 'The generated response did not pass workflow validation.',
                'version' => $version,
                'decision_status' => 'rejected',
                'requested_by' => $request->user()->school_id,
                'created_at' => now(),
            ]);

            return response()->json(['message' => 'The generated response could not be validated. Please retry.'], 422);
        }

        foreach ($workflow['tasks'] as &$task) {
            $task['recommendation'] = $this->delegation->recommend(
                $event->organization_id,
                $task['title'],
                'workflow',
                $task['recommended_role'],
            );
            $task['assigned_to'] = $task['recommendation']['recommended_officer_id'];
        }
        unset($task);
        $planText = $this->workflowAsText($workflow);

        return DB::transaction(function () use ($request, $event, $context, $workflow, $planText, $generated, $version) {
            $aiOutput = AiOutput::create([
                'organization_id' => $request->user()->organization_id,
                'feature_type' => 'EVENT_WORKFLOW',
                'reference_type' => Event::class,
                'reference_id' => $event->id,
                'prompt_text' => 'Structured event workflow generation',
                'output_text' => $planText,
                'model_name' => $generated['model'],
                'context_version' => 'event-workflow-v2',
                'structured_input' => $context,
                'structured_output' => $workflow,
                'status' => 'completed',
                'version' => $version,
                'decision_status' => 'pending',
                'requested_by' => $request->user()->id,
                'created_at' => now(),
            ]);

            $event->update([
                'planning_details' => [
                    ...($event->planning_details ?? []),
                    'draft_plan' => $planText,
                    'draft_ai_output_id' => $aiOutput->id,
                    'draft_generated_at' => now()->toISOString(),
                ],
            ]);

            $this->auditAiAction($request, 'workflow_generated', $event, ['ai_output_id' => $aiOutput->id, 'version' => $version]);

            return response()->json([
                'ai_output' => $aiOutput,
                'plan' => $planText,
                'workflow' => $workflow,
                'tasks' => [],
            ], 201);
        });
    }

    public function confirmWorkflow(Request $request, $id, AiOutput $aiOutput)
    {
        $event = Event::where('organization_id', $request->user()->organization_id)->find($id);
        if (! $event || $aiOutput->organization_id !== $request->user()->organization_id
            || $aiOutput->reference_type !== Event::class || (int) $aiOutput->reference_id !== (int) $event->id
            || $aiOutput->feature_type !== 'EVENT_WORKFLOW') {
            return response()->json(['message' => 'Event workflow not found.'], 404);
        }
        if ($aiOutput->decision_status !== 'pending') {
            return response()->json(['message' => 'This workflow version has already been decided.'], 409);
        }

        $data = $request->validate([
            'tasks' => ['required', 'array', 'min:1', 'max:50'],
            'tasks.*.key' => ['required', 'string', 'max:60', 'distinct'],
            'tasks.*.title' => ['required', 'string', 'max:255'],
            'tasks.*.description' => ['nullable', 'string', 'max:2000'],
            'tasks.*.phase' => ['required', 'in:pre_event,event_day,post_event'],
            'tasks.*.priority' => ['required', 'in:low,medium,high,critical'],
            'tasks.*.deadline' => ['required', 'date', 'after:now'],
            'tasks.*.depends_on_key' => ['nullable', 'string', 'max:60'],
            'tasks.*.recommended_role' => ['nullable', 'string', 'max:100'],
            'tasks.*.assigned_to' => ['nullable', 'integer'],
        ]);
        $keyPositions = collect($data['tasks'])->pluck('key')->flip();
        $activePositions = SboPosition::where('organization_id', $event->organization_id)
            ->where('role', 'SBO_OFFICER')
            ->where('is_active', true)
            ->pluck('title');
        foreach ($data['tasks'] as $position => $task) {
            if (! empty($task['depends_on_key']) && (! $keyPositions->has($task['depends_on_key']) || $keyPositions[$task['depends_on_key']] >= $position)) {
                return response()->json(['message' => "Task dependency '{$task['depends_on_key']}' is invalid."], 422);
            }
            if (! $this->deadlineMatchesPhase(Carbon::parse($task['deadline']), $task['phase'], $event)) {
                return response()->json(['message' => "The deadline for '{$task['title']}' does not match its workflow phase."], 422);
            }
            if (! empty($task['recommended_role']) && ! $activePositions->containsStrict($task['recommended_role'])) {
                return response()->json(['message' => "The recommended role for '{$task['title']}' is not an active SBO position."], 422);
            }
        }

        $created = DB::transaction(function () use ($request, $event, $aiOutput, $data) {
            $byKey = [];
            $tasks = [];
            $overrides = 0;
            foreach ($data['tasks'] as $sequence => $draft) {
                $recommendation = $this->delegation->recommend($event->organization_id, $draft['title'], 'workflow', $draft['recommended_role'] ?? null);
                $recommendedId = $recommendation['recommended_officer_id'];
                $assignedTo = $draft['assigned_to'] ?? $recommendedId;
                if ($assignedTo === null || ! collect($recommendation['rankings'])->contains('officer_id', (int) $assignedTo)) {
                    abort(422, 'No eligible SBO Officer is available for one or more workflow tasks.');
                }
                $selected = collect($recommendation['rankings'])->firstWhere('officer_id', (int) $assignedTo);
                $task = Task::create([
                    'event_id' => $event->id,
                    'task_type' => 'workflow',
                    'phase' => $draft['phase'],
                    'priority' => $draft['priority'],
                    'sequence' => $sequence + 1,
                    'preferred_role' => $draft['recommended_role'] ?? null,
                    'title' => $draft['title'],
                    'description' => $draft['description'] ?? null,
                    'deadline' => $draft['deadline'],
                    'status' => 'pending',
                    'assigned_to' => $assignedTo,
                    'is_ai_generated' => true,
                    'role_score' => $selected['role_score'],
                    'workload_score' => $selected['workload_score'],
                    'performance_score' => $selected['performance_score'],
                    'final_score' => $selected['final_score'],
                    'delegation_snapshot' => $recommendation,
                    'ai_recommendation_note' => "Rank {$selected['rank']} by deterministic weighted scoring.",
                    'created_by' => $request->user()->school_id,
                    'organization_id' => $event->organization_id,
                ]);
                foreach ($recommendation['evaluations'] as $ranking) {
                    DB::table('task_recommendations')->insert([
                        'task_id' => $task->id,
                        'ai_output_id' => $aiOutput->id,
                        'organization_id' => $event->organization_id,
                        'officer_id' => $ranking['officer_id'],
                        'role_score' => $ranking['role_score'],
                        'workload_score' => $ranking['workload_score'],
                        'performance_score' => $ranking['performance_score'],
                        'weights' => json_encode($recommendation['weights']),
                        'total_score' => $ranking['final_score'],
                        'rank' => $ranking['rank'],
                        'eligibility_result' => $ranking['eligibility_result'],
                        'calculated_at' => now(),
                    ]);
                }
                if ((int) $assignedTo !== (int) $recommendedId) {
                    $overrides++;
                }
                AuditLog::create([
                    'organization_id' => $event->organization_id,
                    'user_id' => $request->user()->school_id,
                    'module' => 'task_delegation',
                    'action' => (int) $assignedTo === (int) $recommendedId ? 'accepted_recommendation' : 'overrode_recommendation',
                    'record_type' => Task::class,
                    'record_id' => $task->id,
                    'new_values' => [
                        'recommended_officer_id' => $recommendedId,
                        'assigned_officer_id' => $assignedTo,
                        'selected_rank' => $selected['rank'],
                        'selected_score' => $selected['final_score'],
                    ],
                    'ip_address' => $request->ip(),
                    'created_at' => now(),
                ]);
                $byKey[$draft['key']] = $task;
                $tasks[] = $task;
            }
            foreach ($data['tasks'] as $index => $draft) {
                if (! empty($draft['depends_on_key'])) {
                    $tasks[$index]->update(['depends_on_task_id' => $byKey[$draft['depends_on_key']]->id]);
                }
                Notification::create([
                    'organization_id' => $event->organization_id,
                    'user_id' => $tasks[$index]->assigned_to,
                    'title' => 'New Event Workflow Task',
                    'message' => "You were assigned '{$tasks[$index]->title}' for {$event->title}.",
                    'notification_type' => 'task',
                    'reference_type' => Task::class,
                    'reference_id' => $tasks[$index]->id,
                    'is_read' => false,
                    'sent_at' => now(),
                ]);
            }

            $aiOutput->update(['decision_status' => 'accepted', 'decided_by' => $request->user()->school_id, 'decided_at' => now()]);
            AiOutput::where('organization_id', $event->organization_id)
                ->where('feature_type', 'EVENT_WORKFLOW')->where('reference_type', Event::class)
                ->where('reference_id', $event->id)->whereKeyNot($aiOutput->id)->where('decision_status', 'pending')
                ->update(['decision_status' => 'discarded', 'decided_by' => $request->user()->school_id, 'decided_at' => now()]);
            $event->update(['planning_details' => [
                ...($event->planning_details ?? []),
                'generated_plan' => $aiOutput->output_text,
                'ai_output_id' => $aiOutput->id,
                'workflow_confirmed_at' => now()->toISOString(),
            ]]);
            $this->auditAiAction($request, 'workflow_confirmed', $event, ['ai_output_id' => $aiOutput->id, 'task_count' => count($tasks), 'assignment_overrides' => $overrides]);

            return $tasks;
        });

        $this->explainWorkflowAssignments($request, $event, collect($created));

        return response()->json(['message' => 'Workflow confirmed and tasks assigned.', 'tasks' => collect($created)->map->fresh()->values()], 201);
    }

    private function explainWorkflowAssignments(Request $request, Event $event, $tasks): void
    {
        $facts = $tasks->map(function (Task $task) {
            $recommendation = $task->delegation_snapshot ?? [];
            $selected = collect($recommendation['rankings'] ?? [])->firstWhere('officer_id', $task->assigned_to);

            return [
                'task_id' => $task->id,
                'task_title' => $task->title,
                'officer_id' => $task->assigned_to,
                'officer_name' => $selected['name'] ?? $task->assignee?->full_name,
                'position_title' => $selected['position_title'] ?? null,
                'rank' => $selected['rank'] ?? null,
                'role_score' => $selected['role_score'] ?? null,
                'workload_score' => $selected['workload_score'] ?? null,
                'performance_score' => $selected['performance_score'] ?? null,
                'total_score' => $selected['final_score'] ?? null,
                'weights' => $recommendation['weights'] ?? null,
            ];
        })->values();

        $generated = $this->groq->generateStructured(
            'Explain each deterministic task recommendation in one concise sentence. Use only the supplied facts. Do not change scores, ranks, officer assignments, eligibility, or weights, and do not invent qualifications.',
            ['event_id' => $event->id, 'event_title' => $event->title, 'recommendations' => $facts->all()],
            'hiusa_task_recommendation_explanations',
            [
                'type' => 'object',
                'additionalProperties' => false,
                'required' => ['explanations'],
                'properties' => [
                    'explanations' => [
                        'type' => 'array',
                        'items' => [
                            'type' => 'object',
                            'additionalProperties' => false,
                            'required' => ['task_id', 'explanation'],
                            'properties' => [
                                'task_id' => ['type' => 'integer'],
                                'explanation' => ['type' => 'string'],
                            ],
                        ],
                    ],
                ],
            ],
            min(1800, max(300, $tasks->count() * 120)),
            0.2,
        );
        $explanations = collect($generated['data']['explanations'] ?? [])->keyBy('task_id');
        $validIds = $facts->pluck('task_id')->sort()->values()->all();
        $returnedIds = $explanations->keys()->map(fn ($id) => (int) $id)->sort()->values()->all();
        $isValid = $generated && $validIds === $returnedIds
            && $explanations->every(function ($row, $taskId) use ($facts) {
                $fact = $facts->firstWhere('task_id', (int) $taskId);

                return is_string($row['explanation'] ?? null)
                    && trim($row['explanation']) !== ''
                    && $fact
                    && $this->groq->preservesNumericFacts($row['explanation'], $fact);
            });

        foreach ($tasks as $task) {
            $fact = $facts->firstWhere('task_id', $task->id);
            $explanation = $isValid ? trim($explanations[$task->id]['explanation']) : null;
            if ($explanation) {
                $task->update(['ai_recommendation_note' => $explanation]);
            }
            AiOutput::create([
                'organization_id' => $event->organization_id,
                'feature_type' => 'TASK_EXPLANATION',
                'reference_type' => Task::class,
                'reference_id' => $task->id,
                'prompt_text' => 'Explain deterministic task recommendation facts without changing them.',
                'output_text' => $explanation ?? '',
                'model_name' => $explanation ? $generated['model'] : null,
                'context_version' => 'task-delegation-v2',
                'structured_input' => $fact,
                'structured_output' => $explanation ? ['explanation' => $explanation] : ['deterministic_explanation' => $task->ai_recommendation_note],
                'status' => $explanation ? 'completed' : 'failed',
                'error_message' => $explanation ? null : 'Groq explanation was unavailable or invalid; deterministic assignment facts were retained.',
                'version' => 1,
                'decision_status' => $explanation ? 'accepted' : 'rejected',
                'requested_by' => $request->user()->school_id,
                'decided_by' => $explanation ? $request->user()->school_id : null,
                'decided_at' => $explanation ? now() : null,
                'created_at' => now(),
            ]);
        }
        $this->auditAiAction($request, 'task_explanations_generated', $event, [
            'task_count' => $tasks->count(),
            'generated_count' => $isValid ? $tasks->count() : 0,
            'failed_count' => $isValid ? 0 : $tasks->count(),
        ]);
    }

    public function discardWorkflow(Request $request, $id, AiOutput $aiOutput)
    {
        $event = Event::where('organization_id', $request->user()->organization_id)->find($id);
        if (! $event || $aiOutput->organization_id !== $request->user()->organization_id || (int) $aiOutput->reference_id !== (int) $event->id || $aiOutput->feature_type !== 'EVENT_WORKFLOW') {
            return response()->json(['message' => 'Event workflow not found.'], 404);
        }
        if ($aiOutput->decision_status !== 'pending') {
            return response()->json(['message' => 'This workflow version has already been decided.'], 409);
        }
        $aiOutput->update(['decision_status' => 'discarded', 'decided_by' => $request->user()->school_id, 'decided_at' => now()]);
        $this->auditAiAction($request, 'workflow_discarded', $event, ['ai_output_id' => $aiOutput->id]);

        return response()->json(['message' => 'Workflow draft discarded.']);
    }

    public function workflowHistory(Request $request, $id)
    {
        $event = Event::where('organization_id', $request->user()->organization_id)->find($id);
        if (! $event) {
            return response()->json(['message' => 'Event not found.'], 404);
        }

        return response()->json(AiOutput::where('organization_id', $event->organization_id)
            ->where('feature_type', 'EVENT_WORKFLOW')->where('reference_type', Event::class)->where('reference_id', $event->id)
            ->orderByDesc('version')->get());
    }

    public function getAttendance(Request $request, $id)
    {
        $event = Event::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $event) {
            return response()->json(['message' => 'Event not found.'], 404);
        }

        $recordsQuery = Attendance::with([
            'user:school_id,first_name,last_name,email,role,position_title,department,program,major,year_level,section',
            'recorder:school_id,first_name,last_name,email,role,position_title',
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

    private function eventWorkflowSchema(): array
    {
        $stringList = ['type' => 'array', 'items' => ['type' => 'string'], 'minItems' => 1, 'maxItems' => 20];

        return [
            'type' => 'object',
            'additionalProperties' => false,
            'required' => ['overview', 'preparation_phases', 'timeline', 'resources', 'logistics', 'risks', 'scheduling_conflicts', 'tasks'],
            'properties' => [
                'overview' => ['type' => 'string'],
                'preparation_phases' => $stringList,
                'timeline' => $stringList,
                'resources' => $stringList,
                'logistics' => $stringList,
                'risks' => $stringList,
                'scheduling_conflicts' => ['type' => 'array', 'items' => ['type' => 'string'], 'maxItems' => 20],
                'tasks' => [
                    'type' => 'array', 'minItems' => 3, 'maxItems' => 30,
                    'items' => [
                        'type' => 'object', 'additionalProperties' => false,
                        'required' => ['key', 'title', 'description', 'phase', 'priority', 'deadline', 'depends_on_key', 'recommended_role'],
                        'properties' => [
                            'key' => ['type' => 'string'],
                            'title' => ['type' => 'string'],
                            'description' => ['type' => 'string'],
                            'phase' => ['type' => 'string', 'enum' => ['pre_event', 'event_day', 'post_event']],
                            'priority' => ['type' => 'string', 'enum' => ['low', 'medium', 'high', 'critical']],
                            'deadline' => ['type' => 'string'],
                            'depends_on_key' => ['type' => ['string', 'null']],
                            'recommended_role' => ['type' => ['string', 'null']],
                        ],
                    ],
                ],
            ],
        ];
    }

    private function normalizeWorkflow(array $workflow, Event $event, array $allowedPositions): ?array
    {
        foreach (['overview', 'preparation_phases', 'timeline', 'resources', 'logistics', 'risks', 'scheduling_conflicts', 'tasks'] as $field) {
            if (! array_key_exists($field, $workflow)) {
                return null;
            }
        }
        if (! is_string($workflow['overview']) || count($workflow['tasks']) < 3) {
            return null;
        }

        $keys = [];
        foreach ($workflow['tasks'] as $index => &$task) {
            if (! is_array($task) || empty($task['key']) || empty($task['title']) || empty($task['deadline'])
                || ! in_array($task['phase'] ?? null, ['pre_event', 'event_day', 'post_event'], true)
                || ! in_array($task['priority'] ?? null, ['low', 'medium', 'high', 'critical'], true)) {
                return null;
            }
            try {
                $deadline = Carbon::parse($task['deadline']);
            } catch (\Throwable) {
                return null;
            }
            if ($deadline->lte(now()) || ! $this->deadlineMatchesPhase($deadline, $task['phase'], $event) || isset($keys[$task['key']])) {
                return null;
            }
            $keys[$task['key']] = $index;
            $task['deadline'] = $deadline->toISOString();
            $task['description'] = trim((string) ($task['description'] ?? ''));
            $task['depends_on_key'] = $task['depends_on_key'] ?: null;
            $task['recommended_role'] = $task['recommended_role'] ?: null;
            if ($task['recommended_role'] !== null && ! in_array($task['recommended_role'], $allowedPositions, true)) {
                return null;
            }
        }
        unset($task);
        foreach ($workflow['tasks'] as $task) {
            if ($task['depends_on_key'] !== null && (! isset($keys[$task['depends_on_key']]) || $keys[$task['depends_on_key']] >= $keys[$task['key']])) {
                return null;
            }
        }

        return $workflow;
    }

    private function deadlineMatchesPhase(Carbon $deadline, string $phase, Event $event): bool
    {
        return match ($phase) {
            'pre_event' => $deadline->lt($event->start_time),
            'event_day' => $deadline->betweenIncluded($event->start_time, $event->end_time),
            'post_event' => $deadline->gt($event->end_time) && $deadline->lte($event->end_time->copy()->addDays(30)),
            default => false,
        };
    }

    private function workflowAsText(array $workflow): string
    {
        $sections = [
            'Overview' => [$workflow['overview']],
            'Preparation Phases' => $workflow['preparation_phases'],
            'Timeline' => $workflow['timeline'],
            'Resource Checklist' => $workflow['resources'],
            'Logistics Checklist' => $workflow['logistics'],
            'Possible Delays or Conflicts' => array_merge($workflow['risks'], $workflow['scheduling_conflicts']),
        ];

        return collect($sections)->map(fn (array $items, string $heading) => $heading.":\n".collect($items)->map(fn ($item) => '- '.$item)->implode("\n"))->implode("\n\n");
    }

    private function auditAiAction(Request $request, string $action, Event $event, array $values): void
    {
        AuditLog::create([
            'organization_id' => $event->organization_id,
            'user_id' => $request->user()->school_id,
            'module' => 'ai_workflows',
            'action' => $action,
            'record_type' => Event::class,
            'record_id' => $event->id,
            'new_values' => $values,
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);
    }
}
