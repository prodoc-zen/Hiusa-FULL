<?php

namespace App\Http\Controllers;

use App\Exceptions\InvoiceSettlementRequired;
use App\Models\AcademicSemester;
use App\Models\Announcement;
use App\Models\ApprovalRequest;
use App\Models\AuditLog;
use App\Models\Budget;
use App\Models\Election;
use App\Models\Event;
use App\Models\EventRequirementFile;
use App\Models\FinancialReport;
use App\Models\Notification;
use App\Models\Order;
use App\Models\Organization;
use App\Models\User;
use App\Services\ApprovalEntityLabel;
use App\Services\EventApprovalChain;
use App\Services\FinancialReportStatement;
use App\Services\OrderFulfillmentService;
use DomainException;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class ApprovalRequestController extends Controller
{
    private const ARCHIVED_MESSAGE = 'This organization is archived and read only.';

    private const HEAD_FIRST_MESSAGE = 'The Department Head must approve this event before the SAO can decide it.';

    public function __construct(
        private readonly OrderFulfillmentService $fulfillmentService,
        private readonly ApprovalEntityLabel $entityLabels,
        private readonly EventApprovalChain $eventChain,
    ) {}

    public function index(Request $request)
    {
        $paging = $request->validate([
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);

        $filters = $request->validate([
            'status' => ['nullable', 'in:pending,approved,rejected,all'],
            'entity_type' => ['nullable', 'in:event,budget,election,announcement,payment,financial_report'],
            'search' => ['nullable', 'string', 'max:120'],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date', 'after_or_equal:from'],
            'sort' => ['nullable', 'in:newest,oldest'],
            'scope' => ['nullable', 'in:awaiting,submitted'],
        ]);
        $submitted = ($filters['scope'] ?? null) === 'submitted';
        $user = $request->user();
        if ($user->role === 'SBO_OFFICER' && ! $submitted) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        $query = $this->rowsWithPeople();
        if ($submitted) {
            $this->scopeToSubmitted($query, $user, $this->readableOrganizationIds($request));
        } else {
            $this->scopeToAwaiting($query, $user, $this->readableOrganizationIds($request));
        }

        $status = $filters['status'] ?? ($submitted ? 'all' : 'pending');

        if ($status !== 'all') {
            $query->where('status', $status);
        }

        if (! empty($filters['entity_type'])) {
            $query->where('entity_type', $filters['entity_type']);
        }

        if (! empty($filters['search'])) {
            $search = trim($filters['search']);
            $query->where(function ($searchQuery) use ($search) {
                $searchQuery->where('entity_type', 'like', "%{$search}%")
                    ->orWhere('remarks', 'like', "%{$search}%")
                    ->orWhereHas('requester', fn ($requester) => $requester
                        ->where('first_name', 'like', "%{$search}%")
                        ->orWhere('last_name', 'like', "%{$search}%")
                        ->orWhere('school_id', 'like', "%{$search}%"));
            });
        }

        if (! empty($filters['from'])) {
            $query->whereDate('requested_at', '>=', $filters['from']);
        }

        if (! empty($filters['to'])) {
            $query->whereDate('requested_at', '<=', $filters['to']);
        }

        $query->orderBy('requested_at', ($filters['sort'] ?? 'newest') === 'oldest' ? 'asc' : 'desc');
        $query->orderBy('id');

        $approvals = $query->paginate($paging['per_page'] ?? 20);
        $this->attachEntityDetails($approvals);

        return response()->json($approvals);
    }

    public function show(Request $request, $approvalRequest)
    {
        $user = $request->user();
        $scoped = $user->scopedOrganizationIds();
        $approval = ctype_digit((string) $approvalRequest)
            ? $this->rowsWithPeople()->whereKey($approvalRequest)->where(function ($visible) use ($user, $scoped) {
                $visible->where(fn ($submitted) => $this->scopeToSubmitted($submitted, $user, $scoped));
                if ($user->role !== 'SBO_OFFICER') {
                    $visible->orWhere(fn ($awaiting) => $this->scopeToAwaiting($awaiting, $user, $scoped));
                }
            })->first()
            : null;

        if (! $approval) {
            return response()->json(['message' => 'Approval request not found.'], 404);
        }

        $this->attachEntityDetails(collect([$approval]));

        return response()->json($approval);
    }

    private function rowsWithPeople(): Builder
    {
        return ApprovalRequest::with([
            'requester:school_id,first_name,last_name,email,role,position_title,department,program,year_level,section',
            'reviewer:school_id,first_name,last_name,email,role,position_title',
            'assignedApprover:school_id,first_name,last_name,email,role,position_title',
        ]);
    }

    /** Requests the caller filed for their own organization. */
    private function scopeToSubmitted(Builder $query, User $user, array $organizationIds): void
    {
        $query->whereIn('organization_id', array_intersect($organizationIds, [$user->organization_id]));
    }

    /** Requests waiting on the caller's role, narrowed to the organizations the caller may read. */
    private function scopeToAwaiting(Builder $query, User $user, array $organizationIds): void
    {
        $query->where('required_role', $user->role)
            ->where(fn ($assigned) => $assigned->whereNull('assigned_approver')->orWhere('assigned_approver', $user->school_id));

        if ($user->role !== 'SUPER_ADMIN') {
            $query->whereIn('organization_id', $organizationIds);
        } else {
            $query->whereIn('entity_type', $this->superAdminReviewableEntityTypes());
        }
    }

    public function review(Request $request, $id)
    {
        $approvalQuery = ApprovalRequest::query();
        if ($request->user()->role !== 'SUPER_ADMIN') {
            $approvalQuery->whereIn('organization_id', $request->user()->scopedOrganizationIds());
        }
        $approval = $approvalQuery->find($id);

        if (! $approval) {
            return response()->json(['message' => 'Approval request not found.'], 404);
        }

        if ($request->user()->role === 'SUPER_ADMIN' && ! in_array($approval->entity_type, $this->superAdminReviewableEntityTypes(), true)) {
            return response()->json(['message' => 'Super Admin can only review financial reports and events.'], 403);
        }

        if ($approval->status !== 'pending') {
            return response()->json(['message' => 'This request has already been reviewed.'], 409);
        }

        if (! $this->organizationIsActive($approval->organization_id)) {
            return response()->json(['message' => self::ARCHIVED_MESSAGE], 409);
        }

        if (! $this->canReview($request->user()->role, $approval->required_role) || ($approval->assigned_approver && $approval->assigned_approver !== $request->user()->school_id)) {
            return response()->json(['message' => 'You are not authorized to review this request.'], 403);
        }

        if ($approval->requested_by === $request->user()->school_id) {
            return response()->json(['message' => 'You cannot review your own approval request.'], 403);
        }

        $data = $request->validate([
            'status' => ['required', 'in:approved,rejected'],
            'remarks' => ['nullable', 'string', 'required_if:status,rejected'],
        ]);

        if (! $this->entityExists($approval)) {
            return response()->json(['message' => 'The record attached to this approval request no longer exists.'], 409);
        }
        if ($approval->entity_type === 'event') {
            $event = Event::where('organization_id', $approval->organization_id)->find($approval->entity_id);
            if ($event?->academic_semester_id && $event->academic_semester_id !== AcademicSemester::active()?->id) {
                return response()->json(['message' => 'Historical semester event approvals are read only.'], 409);
            }
        }
        if ($approval->entity_type === 'election') {
            $election = Election::where('organization_id', $approval->organization_id)->find($approval->entity_id);
            if ($election?->academic_semester_id && $election->academic_semester_id !== AcademicSemester::active()?->id) {
                return response()->json(['message' => 'Historical semester election approvals are read only.'], 409);
            }
        }

        try {
            $freshApproval = DB::transaction(function () use ($approval, $data, $request) {
                $lockedQuery = ApprovalRequest::query();
                if ($request->user()->role !== 'SUPER_ADMIN') {
                    $lockedQuery->whereIn('organization_id', $request->user()->scopedOrganizationIds());
                }
                $approval = $lockedQuery->lockForUpdate()->findOrFail($approval->id);

                if ($approval->status !== 'pending') {
                    throw new DomainException('This request has already been reviewed.');
                }

                if (Organization::whereKey($approval->organization_id)->lockForUpdate()->value('lifecycle_status') !== 'active') {
                    throw new DomainException(self::ARCHIVED_MESSAGE);
                }

                $approval->update([
                    'status' => $data['status'],
                    'decision' => $data['status'],
                    'active_key' => null,
                    'remarks' => $data['remarks'] ?? null,
                    'reviewed_by' => $request->user()->school_id,
                    'reviewed_at' => now(),
                ]);

                if ($data['status'] === 'approved') {
                    $this->applyApproval($approval, $request);
                } else {
                    $this->applyRejection($approval, $request);
                }

                $fresh = $approval->fresh();
                $this->notifyRequester($fresh, $data['status']);
                $this->recordApprovalAudit($request, $fresh, $data['status']);

                return $fresh;
            });
        } catch (DomainException $exception) {
            $status = $exception instanceof InvoiceSettlementRequired || in_array($exception->getMessage(), ['This request has already been reviewed.', self::ARCHIVED_MESSAGE, self::HEAD_FIRST_MESSAGE], true) ? 409 : 422;

            return response()->json(['message' => $exception->getMessage()], $status);
        }

        $freshApproval->load([
            'requester:school_id,first_name,last_name,role',
            'reviewer:school_id,first_name,last_name,role',
        ]);
        $this->attachEntityDetails(collect([$freshApproval]));

        return response()->json($freshApproval);
    }

    private function organizationIsActive(int $organizationId): bool
    {
        return Organization::whereKey($organizationId)->value('lifecycle_status') === 'active';
    }

    private function canReview(string $userRole, ?string $requiredRole): bool
    {
        return $userRole === $requiredRole;
    }

    private function superAdminReviewableEntityTypes(): array
    {
        $types = ['financial_report', 'event'];

        if (config('approvals.budget_final') === 'SUPER_ADMIN') {
            $types[] = 'budget';
        }

        return $types;
    }

    private function applyApproval(ApprovalRequest $approval, Request $request): void
    {
        match ($approval->entity_type) {
            'event' => $this->approveEvent($approval),
            'budget' => $this->approveBudget($approval, $request),
            'election' => $this->approveElection($approval),
            'announcement' => $this->approveAnnouncement($approval, $request),
            'payment' => $this->fulfillmentService->approvePayment(
                Order::where('organization_id', $approval->organization_id)->findOrFail($approval->entity_id),
                $request->user()
            ),
            'financial_report' => $this->approveFinancialReport($approval, $request),
            default => null,
        };
    }

    private function approveBudget(ApprovalRequest $approval, Request $request): void
    {
        $budget = Budget::where('organization_id', $approval->organization_id)
            ->lockForUpdate()
            ->findOrFail($approval->entity_id);

        $finalRole = config('approvals.budget_final');

        if ($finalRole && $approval->required_role !== $finalRole) {
            $budget->update([
                'submission_status' => 'pending_sao',
                'department_head_approved_by' => $request->user()->school_id,
                'department_head_approved_at' => now(),
            ]);
            ApprovalRequest::create([
                'organization_id' => $budget->organization_id,
                'entity_type' => 'budget',
                'entity_id' => $budget->id,
                'requested_by' => $approval->requested_by,
                'required_role' => $finalRole,
                'status' => 'pending',
                'requested_at' => now(),
            ]);

            return;
        }

        $remaining = $budget->recomputedRemaining();
        $budget->update([
            'submission_status' => 'approved',
            'department_head_approved_by' => $request->user()->role === 'DEPARTMENT_HEAD' ? $request->user()->school_id : $budget->department_head_approved_by,
            'department_head_approved_at' => $request->user()->role === 'DEPARTMENT_HEAD' ? now() : $budget->department_head_approved_at,
            'remaining_amount' => $remaining,
            'overspending_risk' => Budget::overspendingRiskFor($remaining, (float) $budget->warning_threshold),
        ]);
    }

    private function approveFinancialReport(ApprovalRequest $approval, Request $request): void
    {
        $report = FinancialReport::where('organization_id', $approval->organization_id)
            ->lockForUpdate()
            ->findOrFail($approval->entity_id);

        if ($request->user()->role === 'DEPARTMENT_HEAD') {
            $report->update([
                'submission_status' => 'pending_sao',
                'department_head_approved_by' => $request->user()->school_id,
                'department_head_approved_at' => now(),
            ]);
            ApprovalRequest::create([
                'organization_id' => $report->organization_id,
                'entity_type' => 'financial_report',
                'entity_id' => $report->id,
                'requested_by' => $approval->requested_by,
                'required_role' => 'SUPER_ADMIN',
                'status' => 'pending',
                'active_key' => 'financial_report:'.$report->organization_id.':'.$report->id,
                'requested_at' => now(),
            ]);

            return;
        }

        $report->update([
            'submission_status' => 'approved',
            'sao_approved_by' => $request->user()->school_id,
            'sao_approved_at' => now(),
        ]);
    }

    private function approveElection(ApprovalRequest $approval): void
    {
        $election = Election::where('organization_id', $approval->organization_id)
            ->where('id', $approval->entity_id)
            ->first();

        if (! $election) {
            return;
        }

        $election->update([
            'status' => 'upcoming',
            'approved_at' => now(),
            'finalized_at' => null,
        ]);
    }

    private function approveEvent(ApprovalRequest $approval): void
    {
        $event = Event::where('organization_id', $approval->organization_id)
            ->where('id', $approval->entity_id)
            ->first();

        if (! $event) {
            return;
        }

        if ($approval->required_role === 'SUPER_ADMIN') {
            if ($this->eventChain->headRow($event)?->status === 'pending') {
                throw new DomainException(self::HEAD_FIRST_MESSAGE);
            }
        } elseif ($this->eventChain->requiresRequirements($event)) {
            if ($this->eventChain->requirementsSubmitted($event)) {
                $this->eventChain->openSaoReview($event, $approval->requested_by);
            }

            return;
        }

        $event->update([
            'status' => 'approved',
            'approved_at' => now(),
        ]);

        $recipientIds = User::where('organization_id', $approval->organization_id)
            ->where('account_status', 'active')
            ->where('school_id', '!=', $approval->requested_by)
            ->pluck('school_id');
        $now = now();

        foreach ($recipientIds->chunk(100) as $chunk) {
            Notification::insert($chunk->map(fn ($userId) => [
                'organization_id' => $approval->organization_id,
                'user_id' => $userId,
                'title' => 'Event Approved: '.Str::limit($event->title, 230),
                'message' => 'A new approved event is now available in the activity calendar.',
                'notification_type' => 'event',
                'reference_type' => Event::class,
                'reference_id' => $event->id,
                'is_read' => false,
                'sent_at' => $now,
                'created_at' => $now,
                'updated_at' => $now,
            ])->all());
        }
    }

    private function applyRejection(ApprovalRequest $approval, Request $request): void
    {
        match ($approval->entity_type) {
            'announcement' => Announcement::where('organization_id', $approval->organization_id)->where('id', $approval->entity_id)->update([
                'approval_status' => 'rejected',
                'reviewed_by' => $request->user()->school_id,
                'review_remarks' => $approval->remarks,
                'is_published' => false,
            ]),
            'payment' => $this->fulfillmentService->rejectPayment(
                Order::where('organization_id', $approval->organization_id)->findOrFail($approval->entity_id),
                $request->user(),
                (string) $approval->remarks
            ),
            'budget' => Budget::where('organization_id', $approval->organization_id)
                ->where('id', $approval->entity_id)
                ->update(['submission_status' => 'rejected']),
            'financial_report' => FinancialReport::where('organization_id', $approval->organization_id)
                ->where('id', $approval->entity_id)
                ->update(['submission_status' => 'rejected']),
            default => null,
        };
    }

    private function attachEntityDetails($approvals): void
    {
        $entities = [];
        $extras = [];
        foreach ($approvals->groupBy('entity_type') as $type => $group) {
            $entities[$type] = $this->loadEntities($type, $group->pluck('entity_id')->unique()->all());
            $extras[$type] = $this->summaryExtras($type, $entities[$type]);
        }

        foreach ($approvals as $approval) {
            $entity = $entities[$approval->entity_type]->get($approval->entity_id);
            $entity = $entity && (int) $entity->organization_id === (int) $approval->organization_id ? $entity : null;
            $approval->title = $this->entityTitle($approval, $entity);
            $approval->summary = $this->entitySummary($approval, $entity, $extras[$approval->entity_type][$approval->entity_id] ?? []);
        }
    }

    /** One query per entity type for the whole page, keyed by id. */
    private function loadEntities(string $type, array $ids): Collection
    {
        $query = match ($type) {
            'event' => Event::withCount([
                'tasks',
                'tasks as completed_tasks_count' => fn ($tasks) => $tasks->where('status', 'completed'),
                'attendanceRecords as present_count' => fn ($attendance) => $attendance->whereIn('status', ['present', 'late']),
            ]),
            'budget' => Budget::with('event:id,title'),
            'election' => Election::query(),
            'announcement' => Announcement::query(),
            'payment' => Order::with(['merchandise:id,name', 'student:school_id,first_name,last_name']),
            'financial_report' => FinancialReport::with(['organization:id,name,acronym', 'event:id,title', 'generator:school_id,first_name,last_name']),
            default => null,
        };

        return $query ? $query->whereIn('id', $ids)->get()->keyBy('id') : collect();
    }

    /**
     * Summary fields that need a query of their own, computed for every record of one type at once
     * so a page costs the same however many rows it holds. Keys match what the events, elections
     * and budgets endpoints return, so one lifecycle function reads both.
     *
     * @return array<int, array<string, mixed>> keyed by entity id
     */
    private function summaryExtras(string $type, Collection $entities): array
    {
        if ($entities->isEmpty()) {
            return [];
        }

        $ids = $entities->keys();

        return match ($type) {
            'event' => $this->eventExtras($entities),
            'budget' => collect(Budget::spentAmounts($ids))->map(fn (string $spent) => ['spent_amount' => $spent])->all(),
            'election' => ApprovalRequest::whereIn('id', ApprovalRequest::where('entity_type', 'election')->whereIn('entity_id', $ids)->selectRaw('MAX(id)')->groupBy('entity_id'))
                ->get(['entity_id', 'status'])
                ->mapWithKeys(fn (ApprovalRequest $latest) => [$latest->entity_id => ['approval_status' => $latest->status]])
                ->all(),
            default => [],
        };
    }

    private function eventExtras(Collection $events): array
    {
        $described = $this->eventChain->describe($events);
        $files = EventRequirementFile::with('requirement:id,name')->whereIn('event_id', $events->keys())->get()->groupBy('event_id');
        $budgets = Budget::whereIn('event_id', $events->keys())->orderBy('id')->get(['id', 'event_id', 'submission_status'])->groupBy('event_id');

        return $events->mapWithKeys(fn (Event $event) => [$event->id => [
            'approval_stage' => $described[$event->id]['approval_stage'],
            'requirements_required' => $described[$event->id]['requirements_required'],
            'requirements_submitted' => $described[$event->id]['requirements_submitted'],
            'budgets' => $budgets->get($event->id, collect())->map(fn (Budget $budget) => ['id' => $budget->id, 'submission_status' => $budget->submission_status])->all(),
            'requirement_files' => $files->get($event->id, collect())->map(fn ($file) => [
                'id' => $file->id,
                'requirement' => $file->requirement?->name,
                'original_name' => $file->original_name,
            ])->all(),
        ]])->all();
    }

    private function entityTitle(ApprovalRequest $approval, mixed $entity): string
    {
        if (! $entity) {
            return Str::headline($approval->entity_type).' Request #'.$approval->entity_id;
        }

        return match ($approval->entity_type) {
            'payment' => 'Merchandise payment #'.$entity->id,
            'financial_report' => $entity->title,
            default => $entity->title ?? $entity->name ?? Str::headline($approval->entity_type).' Request #'.$approval->entity_id,
        };
    }

    private function entitySummary(ApprovalRequest $approval, mixed $entity, array $extra): ?array
    {
        if (! $entity) {
            return null;
        }

        return match ($approval->entity_type) {
            'event' => [
                'start_time' => $entity->start_time,
                'end_time' => $entity->end_time,
                'location' => $entity->location,
                'status' => $entity->status,
                'requires_budget' => (bool) $entity->requires_budget,
                'tasks_count' => $entity->tasks_count,
                'completed_tasks_count' => $entity->completed_tasks_count,
                'present_count' => $entity->present_count,
                ...$extra,
            ],
            'budget' => [
                'submission_status' => $entity->submission_status,
                'allocated_amount' => $entity->allocated_amount,
                'remaining_amount' => $entity->remaining_amount,
                'department_head_approved_at' => $entity->department_head_approved_at,
                'event_title' => $entity->event?->title,
                ...$extra,
            ],
            'election' => [
                'start_time' => $entity->start_time,
                'end_time' => $entity->end_time,
                'status' => $entity->status,
                'target_status' => $entity->status,
                'finalized_at' => $entity->finalized_at,
                'results_visible' => $entity->results_visible,
                'approval_status' => null,
                ...$extra,
            ],
            'announcement' => [
                'target_role' => $entity->target_role,
                'category' => $entity->category,
                'approval_status' => $entity->approval_status,
                'is_published' => $entity->is_published,
            ],
            'payment' => [
                'buyer' => trim(($entity->student?->first_name ?? '').' '.($entity->student?->last_name ?? '')),
                'item' => $entity->merchandise?->name,
                'total_price' => $entity->total_price,
                'payment_method' => $entity->payment_method,
                'payment_reference' => $entity->payment_reference,
                'status' => $entity->status,
            ],
            'financial_report' => $this->financialReportSummary($entity),
            default => null,
        };
    }

    private function financialReportSummary(FinancialReport $report): array
    {
        $statement = FinancialReportStatement::from($report->savedTransactions());

        return [
            'organization' => $report->organization?->only(['id', 'name', 'acronym']),
            'report_type' => $report->report_type,
            'period_start' => $report->period_start,
            'period_end' => $report->period_end,
            'summary_text' => $report->summary_text,
            'submission_status' => $report->submission_status,
            'department_head_approved_at' => $report->department_head_approved_at,
            'signatories' => $report->signatories,
            'supporting_documents' => $report->supportingDocumentLinks(),
            'total_income' => $statement['totals']['income'],
            'total_expense' => $statement['totals']['expense'],
            'net_balance' => $statement['totals']['balance'],
            'cash_advances_released' => $statement['cash_advances']['released'],
            'cash_advance_repayments' => $statement['cash_advances']['repayments'],
        ];
    }

    private function approveAnnouncement(ApprovalRequest $approval, Request $request): void
    {
        $announcement = Announcement::where('organization_id', $approval->organization_id)->where('id', $approval->entity_id)->first();

        if (! $announcement) {
            return;
        }

        $announcement->update([
            'approval_status' => 'approved',
            'reviewed_by' => $request->user()->school_id,
            'review_remarks' => $approval->remarks,
            'is_published' => true,
            'published_at' => now(),
        ]);

        $this->dispatchAnnouncementNotifications($announcement->fresh());
    }

    private function dispatchAnnouncementNotifications(Announcement $announcement): void
    {
        $query = User::query()
            ->where('organization_id', $announcement->organization_id)
            ->where('account_status', 'active')
            ->where('school_id', '!=', $announcement->created_by);

        if ($announcement->target_role !== 'all') {
            $query->where('role', $announcement->target_role);
        }

        $userIds = $query->pluck('school_id');

        if ($userIds->isEmpty()) {
            return;
        }

        $now = now();
        $message = Str::limit(trim(preg_replace('/\s+/', ' ', strip_tags((string) $announcement->body))), 180);
        $title = 'New Announcement: '.Str::limit($announcement->title, 230);

        foreach ($userIds->chunk(100) as $chunk) {
            Notification::insert(
                $chunk->map(fn ($userId) => [
                    'organization_id' => $announcement->organization_id,
                    'user_id' => $userId,
                    'notification_type' => 'announcement',
                    'title' => $title,
                    'message' => $message,
                    'reference_type' => 'announcement',
                    'reference_id' => $announcement->id,
                    'is_read' => false,
                    'sent_at' => $now,
                    'created_at' => $now,
                    'updated_at' => $now,
                ])->all()
            );
        }
    }

    private function notifyRequester(ApprovalRequest $approval, string $status): void
    {
        $label = $this->entityLabels->for($approval);
        $message = Str::headline($approval->entity_type).' "'.$label.'" was '.$status.'.';
        $event = $approval->entity_type === 'event' && $status === 'approved' ? Event::find($approval->entity_id) : null;
        if ($event && ! $event->approved_at) {
            $message = 'Event "'.$label.'" was approved by the Department Head. '.($this->eventChain->saoRow($event)
                ? 'It is now with the Student Affairs Office.'
                : 'Upload the SAO event files to continue.');
        }
        Notification::create([
            'organization_id' => $approval->organization_id,
            'user_id' => $approval->requested_by,
            'title' => 'Approval Request '.Str::headline($status),
            'message' => $message,
            'notification_type' => 'general',
            'reference_type' => $approval->entity_type,
            'reference_id' => $approval->entity_id,
            'is_read' => false,
            'sent_at' => now(),
        ]);
    }

    private function entityExists(ApprovalRequest $approval): bool
    {
        $query = match ($approval->entity_type) {
            'event' => Event::query(),
            'budget' => Budget::query(),
            'election' => Election::query(),
            'announcement' => Announcement::query(),
            'payment' => Order::query(),
            'financial_report' => FinancialReport::query(),
            default => null,
        };

        return $query
            ? $query->where('organization_id', $approval->organization_id)->whereKey($approval->entity_id)->exists()
            : false;
    }

    private function recordApprovalAudit(Request $request, ApprovalRequest $approval, string $status): void
    {
        AuditLog::create([
            'organization_id' => $approval->organization_id,
            'user_id' => $request->user()?->school_id,
            'actor_role' => $request->user()?->role,
            'module' => 'approvals',
            'action' => 'reviewed_'.$status,
            'description' => 'SAO or designated approver '.($status === 'approved' ? 'approved' : 'rejected').' an approval request.',
            'record_type' => ApprovalRequest::class,
            'record_id' => $approval->id,
            'old_values' => null,
            'new_values' => [
                'entity_type' => $approval->entity_type,
                'entity_id' => $approval->entity_id,
                'status' => $status,
                'remarks' => $approval->remarks,
            ],
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);
    }
}
