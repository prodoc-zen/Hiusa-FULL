<?php

namespace App\Http\Controllers;

use App\Contracts\TextGenerator;
use App\Http\Middleware\EnsurePeriodWritable;
use App\Models\AcademicSemester;
use App\Models\AiOutput;
use App\Models\ApprovalRequest;
use App\Models\Attendance;
use App\Models\AuditLog;
use App\Models\Budget;
use App\Models\Event;
use App\Models\EventRequirementFile;
use App\Models\FinancialForecast;
use App\Models\Notification;
use App\Models\SboPosition;
use App\Models\Task;
use App\Models\Transaction;
use App\Models\User;
use App\Models\Venue;
use App\Models\VenueBooking;
use App\Services\Ai\AiInstructions;
use App\Services\EventApprovalChain;
use App\Services\EventVenueRelease;
use App\Services\TaskDelegationService;
use App\Support\FilterValues;
use App\Support\FullNameSearch;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class EventController extends Controller
{
    private const BOOKING_BLOCKER = 'it has a venue booking that is still pending or approved';

    private const EVENT_GONE = 'event_gone';

    public function __construct(
        private readonly TextGenerator $ai,
        private readonly TaskDelegationService $delegation,
        private readonly EventApprovalChain $approvalChain,
        private readonly EventVenueRelease $venueRelease,
    ) {}

    public function index(Request $request)
    {
        $user = $request->user();

        $paging = $request->validate([
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
            'page' => ['nullable', 'integer', 'min:1'],
            'search' => ['nullable', 'string', 'max:100'],
            'status' => ['nullable', FilterValues::rule(['nullable', 'in:planning,approved,ongoing,completed,cancelled'])],
            'date' => ['nullable', 'date_format:Y-m-d'],
            'sort' => ['nullable', 'in:start_asc,start_desc,newest,title'],
            'academic_semester_id' => ['nullable', FilterValues::rule(['integer', 'exists:academic_semesters,id'])],
        ]);

        $readableOrgIds = $this->readableOrganizationIds($request);
        $query = Event::with('creator:school_id,first_name,last_name,role,position_title')
            ->whereIn('organization_id', $readableOrgIds)
            ->withCount([
                'attendanceRecords',
                'tasks',
                'tasks as completed_tasks_count' => fn ($tasks) => $tasks->where('status', 'completed'),
                'attendanceRecords as present_count' => fn ($attendance) => $attendance->whereIn('status', ['present', 'late']),
            ]);
        $selectedSemesterId = $paging['academic_semester_id'] ?? AcademicSemester::selected($request)?->id;
        if ($selectedSemesterId) {
            $query->whereIn('academic_semester_id', FilterValues::values($selectedSemesterId));
        }

        if ($user->role === 'DEPARTMENT_HEAD') {
            $submittedEventIds = ApprovalRequest::whereIn('organization_id', $readableOrgIds)
                ->where('entity_type', 'event')->pluck('entity_id');
            $query->where(fn ($events) => $events->whereIn('status', ['approved', 'ongoing', 'completed'])->orWhereIn('id', $submittedEventIds));
        } elseif ($user->role !== 'ADMIN') {
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
            $query->whereIn('status', FilterValues::values($paging['status']));
        }
        if (! empty($paging['date'])) {
            $query->whereDate('start_time', $paging['date']);
        }

        match ($paging['sort'] ?? 'start_asc') {
            'start_desc' => $query->orderByDesc('start_time')->orderByDesc('id'),
            'newest' => $query->orderByDesc('created_at')->orderByDesc('id'),
            'title' => $query->orderBy('title')->orderBy('id'),
            default => $this->orderSoonest($query),
        };

        $events = $query->paginate($paging['per_page'] ?? 20);
        $this->attachApprovalInfo($events);

        if ($user->role === 'ADMIN') {
            $this->loadLinkedBudgets($events);
            $this->attachDeleteBlockers($events->items());
        }

        return response()->json($events);
    }

    /** Events that have not ended come first, nearest start first, then ended events, most recent first. */
    private function orderSoonest($query): void
    {
        $now = now();

        $query->orderByRaw('CASE WHEN end_time >= ? THEN 0 ELSE 1 END', [$now])
            ->orderByRaw('CASE WHEN end_time >= ? THEN start_time END ASC', [$now])
            ->orderByRaw('CASE WHEN end_time < ? THEN start_time END DESC', [$now])
            ->orderBy('id');
    }

    private function attachApprovalInfo($events): void
    {
        $this->approvalChain->attach($events instanceof Event ? [$events] : $events->items());
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
            ->whereIn('organization_id', $request->user()->scopedOrganizationIds())
            ->withCount(['attendanceRecords', 'tasks', 'tasks as completed_tasks_count' => fn ($tasks) => $tasks->where('status', 'completed')])
            ->find($id);

        if (! $event) {
            return response()->json(['message' => 'Event not found.'], 404);
        }

        if ($request->user()->role !== 'ADMIN' && ! in_array($event->status, ['approved', 'ongoing', 'completed'], true)
            && ! ($request->user()->role === 'DEPARTMENT_HEAD' && ApprovalRequest::where('entity_type', 'event')->where('entity_id', $event->id)->exists())) {
            return response()->json(['message' => 'Event not available.'], 403);
        }

        $this->attachApprovalInfo($event);

        if ($request->user()->role === 'ADMIN') {
            $this->loadLinkedBudgets($event);
            $this->attachDeleteBlockers([$event]);
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
                ->withSum(['transactions as income_amount' => fn ($transactions) => $transactions->where('type', 'income')], 'amount')
                ->orderBy('created_at', 'desc'),
        ]);

        $budgets = $events->flatMap(fn (Event $event) => $event->budgets);

        $spent = Budget::spentAmounts($budgets->pluck('id'));
        foreach ($budgets as $budget) {
            $budget->spent_amount = $spent[$budget->id];
        }

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

        $latestForecast = FinancialForecast::currentFor($events->first()->organization_id);

        $eventTotals = Transaction::whereIn('event_id', $events->pluck('id'))
            ->excludingCashAdvances()
            ->selectRaw('event_id, type, SUM(amount) as total')
            ->groupBy('event_id', 'type')
            ->get()
            ->groupBy('event_id');

        foreach ($events as $event) {
            $totals = ($eventTotals->get($event->id) ?? collect())->pluck('total', 'type');
            $eventBudgets = $event->budgets;
            $risk = $eventBudgets->sortByDesc(fn (Budget $budget) => match ($budget->overspending_risk) {
                'high' => 3,
                'medium' => 2,
                default => 1,
            })->first()?->overspending_risk;

            $approvedBudgets = $eventBudgets->where('submission_status', 'approved');

            $event->financial_summary = [
                'allocated_budget' => round((float) $approvedBudgets->sum('allocated_amount'), 2),
                'spent' => round((float) ($totals['expense'] ?? 0), 2),
                'income' => round((float) ($totals['income'] ?? 0), 2),
                'remaining_budget' => round((float) $approvedBudgets->sum('remaining_amount'), 2),
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
        $semester = AcademicSemester::selected($request);
        if (AcademicSemester::exists() && ! $semester) {
            return response()->json(['message' => 'SAO must activate an academic semester before new events can be created.'], 409);
        }
        $data = $request->validate([
            'title' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'start_time' => ['required', 'date'],
            'end_time' => ['required', 'date', 'after:start_time'],
            'location' => ['nullable', 'string', 'max:255'],
            'requires_budget' => ['boolean'],
            'planning_details' => ['nullable', 'array:budget_notes,vendor_deadlines,logistics_checklist,event_type,expected_participants,requirements,resources,proposed_budget_amount,budget_warning_threshold,venue_type,venue_id'],
            'planning_details.venue_type' => ['nullable', 'in:on_campus,off_campus'],
            'planning_details.venue_id' => ['nullable', 'integer'],
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
        if (data_get($data, 'planning_details.venue_type') === 'on_campus') {
            $venue = Venue::whereKey(data_get($data, 'planning_details.venue_id'))->where('is_active', true)->first();
            if (! $venue) {
                return response()->json(['message' => 'Choose an active SAO on-campus venue.'], 422);
            }
            $data['location'] = $venue->name;
        } elseif (data_get($data, 'planning_details.venue_type') === 'off_campus' && blank($data['location'] ?? null)) {
            return response()->json(['message' => 'Enter the off-campus location.'], 422);
        }
        if ($semester && (
            substr($data['start_time'], 0, 10) < $semester->starts_on->toDateString()
            || substr($data['end_time'], 0, 10) > $semester->ends_on->toDateString()
        )) {
            return response()->json(['message' => 'Event dates must fall within the academic semester.'], 422);
        }

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

        $event = DB::transaction(function () use ($data, $request, $proposedBudget, $warningThreshold, $semester) {
            $event = Event::create([
                ...$data,
                'requires_budget' => $data['requires_budget'] ?? false,
                'status' => 'planning',
                'created_by' => $request->user()->id,
                'organization_id' => $request->user()->organization_id,
                'academic_semester_id' => $semester?->id,
            ]);

            $this->approvalChain->submitToHead($event, $request->user()->id);

            if ($proposedBudget > 0) {
                $budget = Budget::create([
                    'organization_id' => $event->organization_id,
                    'event_id' => $event->id,
                    'title' => $event->title.' Proposed Budget',
                    'allocated_amount' => $proposedBudget,
                    'remaining_amount' => $proposedBudget,
                    'submission_status' => $request->user()->organization->is_university_wide ? 'pending_sao' : 'pending_department_head',
                    'warning_threshold' => $warningThreshold,
                ]);
                ApprovalRequest::create([
                    'organization_id' => $event->organization_id,
                    'entity_type' => 'budget',
                    'entity_id' => $budget->id,
                    'requested_by' => $request->user()->id,
                    'required_role' => $request->user()->organization->approvalRole(config('approvals.routes.budget')),
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
        if (AcademicSemester::isClosed($event->academic_semester_id)) {
            return response()->json(['message' => EnsurePeriodWritable::CLOSED], 409);
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
            'planning_details' => ['nullable', 'array:budget_notes,vendor_deadlines,logistics_checklist,event_type,expected_participants,requirements,resources,proposed_budget_amount,budget_warning_threshold,venue_type,venue_id'],
            'planning_details.venue_type' => ['nullable', 'in:on_campus,off_campus'],
            'planning_details.venue_id' => ['nullable', 'integer'],
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
        if (data_get($data, 'planning_details.venue_type') === 'on_campus') {
            $venue = Venue::whereKey(data_get($data, 'planning_details.venue_id'))->where('is_active', true)->first();
            if (! $venue) {
                return response()->json(['message' => 'Choose an active SAO on-campus venue.'], 422);
            }
            $data['location'] = $venue->name;
        } elseif (data_get($data, 'planning_details.venue_type') === 'off_campus' && blank($data['location'] ?? null)) {
            return response()->json(['message' => 'Enter the off-campus location.'], 422);
        }

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
        if ($event->academic_semester_id) {
            $semester = AcademicSemester::findOrFail($event->academic_semester_id);
            if ($startTime->toDateString() < $semester->starts_on->toDateString() || $endTime->toDateString() > $semester->ends_on->toDateString()) {
                return response()->json(['message' => 'Event dates must fall within its academic semester.'], 422);
            }
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

        if ($this->touchesEventDetails($data) && (in_array($event->status, ['completed', 'cancelled'], true) || $event->attendanceRecords()->exists())) {
            return response()->json(['message' => 'Event details cannot be changed after attendance has been recorded or the event is completed or cancelled.'], 409);
        }

        if ($this->scheduleChanged($event, $startTime, $endTime)
            && VenueBooking::where('event_id', $event->id)->whereIn('status', EventVenueRelease::ACTIVE_STATUSES)->exists()) {
            return response()->json(['message' => 'Withdraw the venue booking first, then change the date.'], 422);
        }

        if ($event->approved_at && $this->hasMaterialEventChange($event, $data, $updatedPlanning, $startTime, $endTime)) {
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

        DB::transaction(function () use ($event, $data, $request) {
            $event->update($data);
            if (($data['status'] ?? null) === 'cancelled') {
                $this->venueRelease->release($event, $request);
            }
        });
        if (($request->hasFile('image') || $removeImage) && $oldImageUrl) {
            Storage::disk('public')->delete($this->publicStoragePath($oldImageUrl));
        }
        $this->resubmitIfRejected($event);

        return response()->json($event->fresh()->load('creator:school_id,first_name,last_name'));
    }

    private function resubmitIfRejected(Event $event): void
    {
        $head = $this->approvalChain->headRow($event);
        if ($head?->status === 'rejected') {
            $head->resubmit();
        }
    }

    /** Whether the request names any event detail at all, changed or not. */
    private function touchesEventDetails(array $data): bool
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

    /** The date or time moved, compared to the minute because the edit form sends no seconds. */
    private function scheduleChanged(Event $event, Carbon $startTime, Carbon $endTime): bool
    {
        return $startTime->copy()->startOfMinute()->ne($event->start_time->copy()->startOfMinute())
            || $endTime->copy()->startOfMinute()->ne($event->end_time->copy()->startOfMinute());
    }

    /**
     * Whether a value the Department Head approved on actually differs from what is stored. Submitting the same
     * values, or changing only the image, logistics, vendor deadlines, resources or requirement notes, is not material.
     */
    private function hasMaterialEventChange(Event $event, array $data, array $updatedPlanning, Carbon $startTime, Carbon $endTime): bool
    {
        if ($this->scheduleChanged($event, $startTime, $endTime)) {
            return true;
        }
        foreach (['title', 'description', 'location'] as $field) {
            if (array_key_exists($field, $data) && $this->comparable($data[$field], true) !== $this->comparable($event->{$field}, true)) {
                return true;
            }
        }
        if (array_key_exists('requires_budget', $data) && (bool) $data['requires_budget'] !== (bool) $event->requires_budget) {
            return true;
        }
        $existingPlanning = $event->planning_details ?? [];
        foreach (['venue_type', 'venue_id', 'event_type', 'expected_participants', 'proposed_budget_amount', 'budget_warning_threshold', 'budget_notes'] as $key) {
            if ($this->comparable($updatedPlanning[$key] ?? null) !== $this->comparable($existingPlanning[$key] ?? null)) {
                return true;
            }
        }

        return false;
    }

    /** Null, blank text and zero are the same, numbers compare as numbers, and text compares trimmed with one line ending. */
    private function comparable(mixed $value, bool $text = false): mixed
    {
        if (is_string($value)) {
            $value = trim(str_replace(["\r\n", "\r"], "\n", $value));
            if ($value === '') {
                return null;
            }
        }
        if ($value === null) {
            return null;
        }

        if (! $text && is_numeric($value)) {
            // The edit form sends a stored 0 as a blank field, so a zero and an empty value are the same.
            return (float) $value === 0.0 ? null : (float) $value;
        }

        return (string) $value;
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
        $this->approvalChain->submitToHead($event, $request->user()->id);
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
        $requirementPaths = [];
        // The check runs on the locked row. A booking, file or attendance record takes a shared lock on its
        // event through the foreign key, so it either lands before the check and blocks the delete, or waits for it.
        $blocked = DB::transaction(function () use ($event, &$requirementPaths) {
            $locked = Event::whereKey($event->id)->lockForUpdate()->first();
            if (! $locked) {
                return self::EVENT_GONE;
            }
            if ($reason = $this->deleteBlockers([$locked])[$locked->id]) {
                return $reason;
            }

            $requirementPaths = EventRequirementFile::where('event_id', $locked->id)->pluck('path')->all();
            ApprovalRequest::where('organization_id', $locked->organization_id)
                ->where('entity_type', 'event')
                ->where('entity_id', $locked->id)
                ->delete();
            $locked->delete();

            return null;
        });
        if ($blocked === self::EVENT_GONE) {
            return response()->json(['message' => 'Event not found.'], 404);
        }
        if ($blocked) {
            return response()->json(['message' => $blocked], 409);
        }
        if ($imageUrl) {
            Storage::disk('public')->delete($this->publicStoragePath($imageUrl));
        }
        Storage::disk('local')->delete($requirementPaths);

        return response()->json(['message' => 'Event deleted successfully.']);
    }

    /** @param  iterable<Event>  $events */
    private function attachDeleteBlockers(iterable $events): void
    {
        $blockers = $this->deleteBlockers($events);

        foreach ($events as $event) {
            $event->delete_blocked_reason = $blockers[$event->id];
        }
    }

    /**
     * Why each event cannot be deleted, keyed by event id, or null when it can. An event that has
     * run, collected files or attendance, been reviewed or has a budget is kept on record
     * and cancelled instead; so is one that still holds a pending or approved venue booking, which cancelling releases. A pending approval request alone does not block, since every proposal has one.
     *
     * @param  iterable<Event>  $events
     * @return array<int, ?string>
     */
    private function deleteBlockers(iterable $events): array
    {
        $events = collect($events)->values();
        $ids = $events->pluck('id');
        $withFiles = EventRequirementFile::whereIn('event_id', $ids)->distinct()->pluck('event_id')->flip();
        $reviewed = ApprovalRequest::where('entity_type', 'event')->whereIn('entity_id', $ids)->where('status', '!=', 'pending')->distinct()->pluck('entity_id')->flip();
        $withAttendance = Attendance::whereIn('event_id', $ids)->distinct()->pluck('event_id')->flip();
        $withBudget = Budget::whereIn('event_id', $ids)->distinct()->pluck('event_id')->flip();
        $withBooking = VenueBooking::whereIn('event_id', $ids)->whereIn('status', EventVenueRelease::ACTIVE_STATUSES)->distinct()->pluck('event_id')->flip();

        return $events->mapWithKeys(function (Event $event) use ($withFiles, $reviewed, $withAttendance, $withBudget, $withBooking) {
            $reason = match (true) {
                in_array($event->status, ['ongoing', 'completed'], true) => "it is {$event->status}",
                $withFiles->has($event->id) => 'it has submitted requirement files',
                $reviewed->has($event->id) => 'it has already been reviewed in the approval workflow',
                $withAttendance->has($event->id) => 'it has attendance records',
                $withBudget->has($event->id) => 'it has a budget',
                $withBooking->has($event->id) => self::BOOKING_BLOCKER,
                default => null,
            };
            $advice = match (true) {
                $reason === self::BOOKING_BLOCKER => ' Cancel it instead to release the venue.',
                $event->status === 'cancelled' => ' It is already cancelled and stays on record.',
                default => ' Cancel it instead to keep the record.',
            };

            return [$event->id => $reason === null ? null : "This event cannot be deleted because {$reason}.{$advice}"];
        })->all();
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

        DB::transaction(function () use ($event, $data, $request) {
            $event->update($data);
            if ($data['status'] === 'cancelled') {
                $this->venueRelease->release($event, $request);
            }
        });

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
            'requirements' => ['nullable', 'string', 'max:4000'],
            'model' => ['nullable', 'string', 'max:100'],
        ]);

        if ($event->status === 'cancelled') {
            return response()->json(['message' => 'This event is cancelled, so a to-do list cannot be drafted for it.'], 422);
        }

        if ($event->start_time->lte(now()->addMinutes(5))) {
            return response()->json([
                'message' => 'Choose an event that starts at least five minutes from now so its tasks can be scheduled.',
            ], 422);
        }

        if (AiOutput::where('organization_id', $event->organization_id)
            ->where('feature_type', 'EVENT_WORKFLOW')->where('reference_type', Event::class)
            ->where('reference_id', $event->id)->where('decision_status', 'accepted')->exists()) {
            return response()->json(['message' => 'This event already has a saved to-do list. Existing tasks will not be replaced.'], 409);
        }

        $conflicts = Event::where('organization_id', $event->organization_id)
            ->whereKeyNot($event->id)
            ->where('status', '!=', 'cancelled')
            ->where('start_time', '<', $event->end_time)
            ->where('end_time', '>', $event->start_time)
            ->get(['id', 'title', 'start_time', 'end_time', 'location'])
            ->toArray();
        $context = [
            // The model cannot know the time, and the server rejects any deadline that is already past.
            'current_time' => now()->toISOString(),
            'event' => $event->only(['id', 'title', 'description', 'start_time', 'end_time', 'location', 'requires_budget']),
            'requirements' => trim($data['requirements'] ?? ''),
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
        $generated = $this->ai->generateStructured(
            AiInstructions::eventPlan(),
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

        $isTemplate = ! $generated;
        $templateReason = 'unavailable';
        $generated ??= ['data' => $this->templateWorkflow($event, $context, $templateReason), 'text' => '', 'model' => 'template-draft'];

        $workflow = $this->normalizeWorkflow($generated['data'], $event, $context['allowed_positions']);
        if ($workflow === null && ! $isTemplate) {
            // A plan the model got wrong should not leave the admin with an error: log the miss (ids only) and
            // fall back to the template, which goes through the same validation.
            Log::warning('Generated event plan failed validation; using the template plan.', [
                'event_id' => $event->id,
                'organization_id' => $event->organization_id,
                'model' => $generated['model'],
            ]);
            $isTemplate = true;
            $templateReason = 'rejected';
            $generated = ['data' => $this->templateWorkflow($event, $context, $templateReason), 'text' => '', 'model' => 'template-draft'];
            $workflow = $this->normalizeWorkflow($generated['data'], $event, $context['allowed_positions']);
        }
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

            return response()->json(['message' => 'The suggested plan was incomplete, so no tasks were created. Please try again.'], 422);
        }

        foreach ($workflow['tasks'] as &$task) {
            $task['recommendation'] = $this->delegation->recommend(
                $event->organization_id,
                $task['title'],
                'workflow',
                $task['recommended_role'],
            );
            $task['assigned_to'] = null;
        }
        unset($task);
        $planText = $this->workflowAsText($workflow);

        return DB::transaction(function () use ($request, $event, $context, $workflow, $planText, $generated, $version, $isTemplate) {
            $aiOutput = AiOutput::create([
                'organization_id' => $request->user()->organization_id,
                'feature_type' => 'EVENT_WORKFLOW',
                'reference_type' => Event::class,
                'reference_id' => $event->id,
                'prompt_text' => 'Structured event workflow generation',
                'output_text' => $planText,
                'model_name' => $generated['model'],
                'context_version' => $isTemplate ? 'event-workflow-template-v1' : 'event-workflow-v2',
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
                'is_template' => $isTemplate,
                'allowed_positions' => $context['allowed_positions'],
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
            return response()->json(['message' => 'This event plan could not be found.'], 404);
        }
        if ($aiOutput->decision_status !== 'pending') {
            return response()->json(['message' => 'This draft has already been saved or removed.'], 409);
        }
        if ($event->status === 'cancelled') {
            return response()->json(['message' => 'This event is cancelled, so its to-do list cannot be saved.'], 422);
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
            'tasks.*.assigned_to' => ['required', 'integer'],
        ]);
        $keyPositions = collect($data['tasks'])->pluck('key')->flip();
        $activePositions = SboPosition::where('organization_id', $event->organization_id)
            ->where('role', 'SBO_OFFICER')
            ->where('is_active', true)
            ->pluck('title');
        foreach ($data['tasks'] as $position => $task) {
            if (! empty($task['depends_on_key']) && (! $keyPositions->has($task['depends_on_key']) || $keyPositions[$task['depends_on_key']] >= $position)) {
                return response()->json(['message' => "'{$task['title']}' can only start after a task listed above it."], 422);
            }
            if (! $this->deadlineMatchesPhase(Carbon::parse($task['deadline']), $task['phase'], $event)) {
                $guidance = match ($task['phase']) {
                    'pre_event' => 'before the event starts',
                    'event_day' => 'during the event',
                    'post_event' => 'after the event ends and within 30 days',
                };

                return response()->json(['message' => "The due date for '{$task['title']}' must be {$guidance}."], 422);
            }
            if (! empty($task['recommended_role'])) {
                $canonical = $this->delegation->canonicalPosition($task['recommended_role'], $activePositions->all());
                if ($canonical === null) {
                    return response()->json(['message' => "Choose an active officer role for '{$task['title']}'."], 422);
                }
                $data['tasks'][$position]['recommended_role'] = $canonical;
            }
        }

        $created = DB::transaction(function () use ($request, $event, $aiOutput, $data) {
            // The event row is locked before any draft row, in every confirm, so two confirms of different
            // drafts queue here instead of each holding one draft and waiting on the other's.
            Event::whereKey($event->id)->lockForUpdate()->first();
            $current = AiOutput::whereKey($aiOutput->id)->lockForUpdate()->first();
            if (! $current || $current->decision_status !== 'pending') {
                abort(409, 'This draft has already been saved or removed.');
            }
            if (AiOutput::where('organization_id', $event->organization_id)
                ->where('feature_type', 'EVENT_WORKFLOW')->where('reference_type', Event::class)
                ->where('reference_id', $event->id)->where('decision_status', 'accepted')->exists()) {
                abort(409, 'This event already has a saved to-do list. Existing tasks will not be replaced.');
            }

            $recommendations = [];
            foreach ($data['tasks'] as $sequence => $draft) {
                $recommendations[$sequence] = $this->delegation->recommend($event->organization_id, $draft['title'], 'workflow', $draft['recommended_role'] ?? null);
                if (! collect($recommendations[$sequence]['rankings'])->contains('officer_id', (int) $draft['assigned_to'])) {
                    abort(422, "No officer is currently available for '{$draft['title']}'. Check officer status, positions, and open task limits.");
                }
            }
            foreach (collect($data['tasks'])->countBy(fn (array $draft) => (int) $draft['assigned_to']) as $officerId => $newTasks) {
                $ranking = collect($recommendations[array_key_first($recommendations)]['rankings'])->firstWhere('officer_id', $officerId);
                if ($ranking['max_active_tasks'] < $ranking['active_tasks'] + $newTasks) {
                    $room = max(0, $ranking['max_active_tasks'] - $ranking['active_tasks']);
                    abort(422, "{$ranking['name']} can take {$room} more open task".($room === 1 ? '' : 's')." but was given {$newTasks}. Choose another officer for some of them.");
                }
            }

            $byKey = [];
            $tasks = [];
            $overrides = 0;
            foreach ($data['tasks'] as $sequence => $draft) {
                $recommendation = $recommendations[$sequence];
                $recommendedId = $recommendation['recommended_officer_id'];
                $assignedTo = $draft['assigned_to'];
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
                    'deadline' => $this->localTime($draft['deadline']),
                    'status' => 'pending',
                    'assigned_to' => $assignedTo,
                    'is_ai_generated' => true,
                    'role_score' => $selected['role_score'],
                    'workload_score' => $selected['workload_score'],
                    'performance_score' => $selected['performance_score'],
                    'recency_score' => $selected['recency_score'],
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
                        'recency_score' => $ranking['recency_score'],
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

        return response()->json(['message' => 'Tasks saved and assigned. Each officer has been notified.', 'tasks' => collect($created)->map->fresh()->values()], 201);
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
                'recency_score' => $selected['recency_score'] ?? null,
                'total_score' => $selected['final_score'] ?? null,
                'weights' => $recommendation['weights'] ?? null,
            ];
        })->values();

        $generated = $this->ai->generateStructured(
            AiInstructions::workflowAssignmentExplanations(),
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
        $explanations = collect($generated['data']['explanations'] ?? [])
            ->filter(fn ($row) => is_array($row) && isset($row['task_id']))
            ->keyBy(fn ($row) => (int) $row['task_id']);
        $validExplanations = $explanations->filter(function ($row, $taskId) use ($facts) {
            $fact = $facts->firstWhere('task_id', (int) $taskId);

            return is_string($row['explanation'] ?? null)
                && trim($row['explanation']) !== ''
                && $fact
                && $this->ai->preservesNumericFacts($row['explanation'], $fact);
        });
        $generatedCount = 0;

        foreach ($tasks as $task) {
            $fact = $facts->firstWhere('task_id', $task->id);
            $explanation = $generated && $validExplanations->has($task->id) ? trim($validExplanations[$task->id]['explanation']) : null;
            if ($explanation) {
                $generatedCount++;
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
                'error_message' => $explanation ? null : 'The AI explanation was unavailable or invalid; deterministic assignment facts were retained.',
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
            'generated_count' => $generatedCount,
            'failed_count' => $tasks->count() - $generatedCount,
        ]);
    }

    public function discardWorkflow(Request $request, $id, AiOutput $aiOutput)
    {
        $event = Event::where('organization_id', $request->user()->organization_id)->find($id);
        if (! $event || $aiOutput->organization_id !== $request->user()->organization_id || (int) $aiOutput->reference_id !== (int) $event->id || $aiOutput->feature_type !== 'EVENT_WORKFLOW') {
            return response()->json(['message' => 'This event plan could not be found.'], 404);
        }
        if ($aiOutput->decision_status !== 'pending') {
            return response()->json(['message' => 'This draft has already been saved or removed.'], 409);
        }
        $changed = AiOutput::whereKey($aiOutput->id)->where('decision_status', 'pending')
            ->update(['decision_status' => 'discarded', 'decided_by' => $request->user()->school_id, 'decided_at' => now()]);
        if ($changed === 0) {
            return response()->json(['message' => 'This draft has already been saved or removed.'], 409);
        }
        $this->auditAiAction($request, 'workflow_discarded', $event, ['ai_output_id' => $aiOutput->id]);

        return response()->json(['message' => 'Draft removed. No tasks were created.']);
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

    public function personalAttendance(Request $request)
    {
        $filters = $request->validate([
            'page' => ['nullable', 'integer', 'min:1'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:50'],
        ]);

        $records = Attendance::query()
            ->where('user_id', $request->user()->school_id)
            ->whereHas('event', fn ($query) => $query
                ->where('organization_id', $request->user()->organization_id)
                ->whereIn('status', ['approved', 'ongoing', 'completed']));
        $attended = (clone $records)->whereIn('status', ['present', 'late'])->count();
        $missed = (clone $records)->where('status', 'absent')->count();
        $page = $records->with('event:id,title,start_time,end_time,status,location')
            ->orderByDesc('id')
            ->paginate($filters['per_page'] ?? 10);

        return response()->json([
            'summary' => [
                'attended' => $attended,
                'missed' => $missed,
                'rate' => $attended + $missed > 0 ? round($attended * 100 / ($attended + $missed)) : null,
            ],
            'records' => $page->items(),
            'pagination' => [
                'current_page' => $page->currentPage(),
                'last_page' => $page->lastPage(),
                'per_page' => $page->perPage(),
                'total' => $page->total(),
            ],
        ]);
    }

    public function getAttendance(Request $request, $id)
    {
        $event = Event::whereIn('organization_id', $request->user()->scopedOrganizationIds())->find($id);

        if (! $event) {
            return response()->json(['message' => 'Event not found.'], 404);
        }

        $filters = $request->validate([
            'search' => ['nullable', 'string', 'max:100'],
            'status' => ['nullable', FilterValues::rule(['in:present,late,excused,absent'])],
            'page' => ['nullable', 'integer', 'min:1'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $recordsQuery = Attendance::with([
            'user:school_id,first_name,last_name,email,role,position_title,department,program,major,year_level,section',
            'recorder:school_id,first_name,last_name,email,role,position_title',
        ])
            ->where('event_id', $id);

        $canManageAttendance = in_array($request->user()->role, ['ADMIN', 'SBO_OFFICER'], true);
        if (! $canManageAttendance) {
            $recordsQuery->where('user_id', $request->user()->school_id);
        }

        $recordCount = (clone $recordsQuery)->count();
        $checkedInCount = (clone $recordsQuery)
            ->whereIn('status', ['present', 'late'])
            ->whereNull('check_out_time')
            ->count();
        $summary = collect(['present', 'late', 'excused', 'absent'])
            ->mapWithKeys(fn (string $status) => [$status => (clone $recordsQuery)->where('status', $status)->count()]);

        if (! empty($filters['status'])) {
            $recordsQuery->whereIn('status', FilterValues::values($filters['status']));
        }
        if (! empty($filters['search'])) {
            $search = trim($filters['search']);
            $recordsQuery->whereHas('user', function ($userQuery) use ($search) {
                $userQuery->where('first_name', 'like', "%{$search}%")
                    ->orWhere('last_name', 'like', "%{$search}%")
                    ->orWhere('school_id', 'like', "%{$search}%")
                    ->orWhere('program', 'like', "%{$search}%")
                    ->orWhere('major', 'like', "%{$search}%")
                    ->orWhere('year_level', 'like', "%{$search}%")
                    ->orWhere('section', 'like', "%{$search}%");
                FullNameSearch::orWhereMatches($userQuery, $search);
            });
        }

        $records = $recordsQuery
            ->orderBy('check_in_time')
            ->orderBy('id')
            ->paginate($filters['per_page'] ?? 10);

        return response()->json([
            'event' => $event->only(['id', 'title', 'start_time', 'end_time', 'status', 'location', 'planning_details']),
            'count' => $recordCount,
            'checked_in_count' => $checkedInCount,
            'summary' => $summary,
            'records' => $records->items(),
            'pagination' => [
                'current_page' => $records->currentPage(),
                'last_page' => $records->lastPage(),
                'per_page' => $records->perPage(),
                'total' => $records->total(),
            ],
            'can_manage_attendance' => $canManageAttendance,
            'biometric_adapter' => [
                'configured' => config('fingerprint.matcher') === 'http' && filled(config('fingerprint.http.url')),
                'message' => 'Single-scan identification is available when the DigitalPersona reader and private SourceAFIS matcher are online.',
            ],
        ]);
    }

    public function recordAttendance(Request $request, $id)
    {
        if (! in_array($request->user()->role, ['ADMIN', 'SBO_OFFICER'], true)) {
            return response()->json(['message' => 'Only administrators and SBO officers can record attendance.'], 403);
        }

        $event = Event::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $event) {
            return response()->json(['message' => 'Event not found.'], 404);
        }

        $data = $request->validate([
            'user_id' => ['required', 'integer'],
            'method' => ['required', 'in:biometric,manual'],
            'status' => ['nullable', 'in:present,late,excused,absent'],
            'check_out_time' => ['nullable', 'date'],
            'remarks' => ['nullable', 'string', 'max:255'],
        ]);

        if (! in_array($event->status, ['approved', 'ongoing'], true)) {
            return response()->json(['message' => 'Only approved or ongoing events can accept attendance.'], 422);
        }

        if ($data['method'] === 'biometric') {
            return response()->json([
                'message' => 'Biometric attendance must be submitted through the fingerprint identification endpoint.',
            ], 422);
        }

        $attendeeBelongsToOrganization = User::whereHas('accountProfiles', fn ($profiles) => $profiles->where('organization_id', $request->user()->organization_id)->where('account_status', 'active'))
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
                'recorded_by' => $request->user()->school_id,
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

    /**
     * A standard checklist used when no AI writer can answer. It only restates the event's own dates
     * and active positions, so it passes through normalizeWorkflow like a generated plan.
     */
    private function templateWorkflow(Event $event, array $context, string $reason = 'unavailable'): array
    {
        $now = now();
        $lead = $event->start_time->timestamp - $now->timestamp;
        $beforeStart = fn (float $share) => $now->copy()->addSeconds((int) round($lead * $share))->toISOString();
        $duringEvent = $event->start_time->copy()->addSeconds((int) floor(($event->end_time->timestamp - $event->start_time->timestamp) / 2))->toISOString();
        $afterEnd = fn (int $days) => $event->end_time->copy()->addDays($days)->toISOString();
        $roleFor = function (array $preferred) use ($context) {
            foreach ($preferred as $title) {
                foreach ($context['allowed_positions'] as $position) {
                    if (strcasecmp($position, $title) === 0) {
                        return $position;
                    }
                }
            }

            return null;
        };
        $task = fn (string $key, string $title, string $description, string $phase, string $priority, string $deadline, ?string $dependsOn, ?string $role) => [
            'key' => $key,
            'title' => $title,
            'description' => $description,
            'phase' => $phase,
            'priority' => $priority,
            'deadline' => $deadline,
            'depends_on_key' => $dependsOn,
            'recommended_role' => $role,
        ];
        $tasks = [
            $task('confirm-plan', 'Confirm the schedule, venue and approvals', 'Check that the date, place and any needed approvals for the event are settled and written down.', 'pre_event', 'high', $beforeStart(0.3), null, $roleFor(['President', 'Vice President'])),
        ];
        if ($event->requires_budget) {
            $tasks[] = $task('confirm-budget', 'Confirm the budget and expected costs', 'List the expected costs and make sure they fit the approved budget before anything is bought.', 'pre_event', 'high', $beforeStart(0.45), 'confirm-plan', $roleFor(['Treasurer', 'Auditor']));
        }
        $tasks[] = $task('announce-event', 'Announce the event to the audience', 'Share the event details with the people who should attend and tell them how to take part.', 'pre_event', 'medium', $beforeStart(0.6), 'confirm-plan', $roleFor(['Public Information Officer', 'Public Relations Officer', 'Secretary']));
        $tasks[] = $task('prepare-venue', 'Prepare the venue, equipment and materials', 'Gather what the event needs and make sure the venue is ready before it starts.', 'pre_event', 'high', $beforeStart(0.9), 'confirm-plan', $roleFor(['Business Manager', 'Vice President']));
        $tasks[] = $task('run-event', 'Run the event and record attendance', 'Keep the program on schedule, look after participants and record who attended.', 'event_day', 'critical', $duringEvent, 'prepare-venue', $roleFor(['President', 'Vice President', 'Secretary']));
        $tasks[] = $task('close-out', 'Settle expenses and collect feedback', 'Pay or file what is owed, return borrowed items and ask participants how the event went.', 'post_event', 'medium', $afterEnd(3), 'run-event', $roleFor(['Treasurer', 'Auditor', 'Business Manager']));
        $tasks[] = $task('wrap-up-report', 'Write the event wrap-up report', 'Record what happened, what was spent and what to do better next time.', 'post_event', 'low', $afterEnd(7), 'close-out', $roleFor(['Secretary', 'Assistant Secretary']));

        return [
            'overview' => $reason === 'rejected'
                ? 'Template draft: the suggested plan did not pass the checks, so this is a standard checklist built from the event dates instead.'.(trim($context['requirements']) !== '' ? ' The context you typed was not used.' : '').' Review and edit every item before saving.'
                : 'Template draft: the AI writer is not available right now, so this is a standard checklist built from the event dates. Review and edit every item before saving.',
            'preparation_phases' => ['Before the event: confirm the plan, announce it and prepare the venue.', 'On the day: run the program and record attendance.', 'After the event: settle expenses, collect feedback and write the report.'],
            'timeline' => ['Event starts '.$event->start_time->toISOString(), 'Event ends '.$event->end_time->toISOString()],
            'resources' => ['Approvals and a confirmed venue', 'Equipment and materials the program needs', 'An attendance record'],
            'logistics' => ['Location: '.($event->location ?: 'not yet specified'), 'Set up the venue before the event starts and return borrowed items afterwards.'],
            'risks' => ['Details not yet confirmed, such as the venue, speakers or costs, can delay the preparation tasks.'],
            'scheduling_conflicts' => collect($context['schedule_conflicts'])->map(fn (array $conflict) => "Overlaps with {$conflict['title']}")->values()->all(),
            'tasks' => $tasks,
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
