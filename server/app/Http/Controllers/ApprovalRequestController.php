<?php

namespace App\Http\Controllers;

use App\Models\Announcement;
use App\Models\ApprovalRequest;
use App\Models\AuditLog;
use App\Models\Budget;
use App\Models\Election;
use App\Models\Event;
use App\Models\FinancialReport;
use App\Models\Notification;
use App\Models\Order;
use App\Models\Transaction;
use App\Models\User;
use App\Services\ApprovalEntityLabel;
use App\Services\OrderFulfillmentService;
use DomainException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class ApprovalRequestController extends Controller
{
    public function __construct(
        private readonly OrderFulfillmentService $fulfillmentService,
        private readonly ApprovalEntityLabel $entityLabels,
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
        ]);
        $requiredRole = $request->user()->role;
        $query = ApprovalRequest::with([
            'requester:school_id,first_name,last_name,email,role,position_title,department,program,year_level,section',
            'reviewer:school_id,first_name,last_name,email,role,position_title',
            'assignedApprover:school_id,first_name,last_name,email,role,position_title',
        ])
            ->where('required_role', $requiredRole)
            ->where(fn ($assigned) => $assigned->whereNull('assigned_approver')->orWhere('assigned_approver', $request->user()->school_id));
        if ($request->user()->role !== 'SUPER_ADMIN') {
            $query->where('organization_id', $request->user()->organization_id);
        }

        $status = $filters['status'] ?? 'pending';

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

    public function review(Request $request, $id)
    {
        $approvalQuery = ApprovalRequest::query();
        if ($request->user()->role !== 'SUPER_ADMIN') {
            $approvalQuery->where('organization_id', $request->user()->organization_id);
        }
        $approval = $approvalQuery->find($id);

        if (! $approval) {
            return response()->json(['message' => 'Approval request not found.'], 404);
        }

        if ($approval->status !== 'pending') {
            return response()->json(['message' => 'This request has already been reviewed.'], 409);
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

        try {
            $freshApproval = DB::transaction(function () use ($approval, $data, $request) {
                $lockedQuery = ApprovalRequest::query();
                if ($request->user()->role !== 'SUPER_ADMIN') {
                    $lockedQuery->where('organization_id', $request->user()->organization_id);
                }
                $approval = $lockedQuery->lockForUpdate()->findOrFail($approval->id);

                if ($approval->status !== 'pending') {
                    throw new DomainException('This request has already been reviewed.');
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
            $status = $exception->getMessage() === 'This request has already been reviewed.' ? 409 : 422;

            return response()->json(['message' => $exception->getMessage()], $status);
        }

        $freshApproval->load([
            'requester:school_id,first_name,last_name,role',
            'reviewer:school_id,first_name,last_name,role',
        ]);
        $this->attachEntityDetails(collect([$freshApproval]));

        return response()->json($freshApproval);
    }

    private function canReview(string $userRole, ?string $requiredRole): bool
    {
        return $userRole === $requiredRole;
    }

    private function applyApproval(ApprovalRequest $approval, Request $request): void
    {
        match ($approval->entity_type) {
            'event' => $this->approveEvent($approval),
            'budget' => Budget::where('organization_id', $approval->organization_id)->where('id', $approval->entity_id)->update([
                'remaining_amount' => Budget::where('organization_id', $approval->organization_id)->where('id', $approval->entity_id)->value('allocated_amount'),
            ]),
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
            'status' => $this->approvedElectionStatus($election),
            'approved_at' => now(),
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

    private function approvedElectionStatus(Election $election): string
    {
        $now = now();

        if ($election->start_time && $now->lt($election->start_time)) {
            return 'upcoming';
        }

        if ($election->end_time && $now->gt($election->end_time)) {
            return 'closed';
        }

        return 'active';
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
            'financial_report' => FinancialReport::where('organization_id', $approval->organization_id)
                ->where('id', $approval->entity_id)
                ->update(['submission_status' => 'rejected']),
            default => null,
        };
    }

    private function attachEntityDetails($approvals): void
    {
        $grouped = $approvals->groupBy('entity_type');
        foreach ($approvals as $approval) {
            $entity = match ($approval->entity_type) {
                'event' => Event::where('organization_id', $approval->organization_id)->find($approval->entity_id),
                'budget' => Budget::with('event:id,title')->where('organization_id', $approval->organization_id)->find($approval->entity_id),
                'election' => Election::where('organization_id', $approval->organization_id)->find($approval->entity_id),
                'announcement' => Announcement::where('organization_id', $approval->organization_id)->find($approval->entity_id),
                'payment' => Order::with(['merchandise:id,name', 'student:school_id,first_name,last_name'])->where('organization_id', $approval->organization_id)->find($approval->entity_id),
                'financial_report' => FinancialReport::with(['organization:id,name,acronym', 'event:id,title', 'generator:school_id,first_name,last_name'])
                    ->where('organization_id', $approval->organization_id)->find($approval->entity_id),
                default => null,
            };
            $approval->title = $this->entityTitle($approval, $entity);
            $approval->summary = $this->entitySummary($approval, $entity);
        }
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

    private function entitySummary(ApprovalRequest $approval, mixed $entity): ?array
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
            ],
            'budget' => [
                'allocated_amount' => $entity->allocated_amount,
                'remaining_amount' => $entity->remaining_amount,
                'event_title' => $entity->event?->title,
            ],
            'election' => [
                'start_time' => $entity->start_time,
                'end_time' => $entity->end_time,
                'target_status' => $entity->status,
                'results_visible' => $entity->results_visible,
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
        $transactions = Transaction::where('organization_id', $report->organization_id)
            ->whereIn('id', $report->source_transaction_ids ?? [])
            ->get(['type', 'amount']);

        return [
            'organization' => $report->organization?->only(['id', 'name', 'acronym']),
            'report_type' => $report->report_type,
            'period_start' => $report->period_start,
            'period_end' => $report->period_end,
            'summary_text' => $report->summary_text,
            'submission_status' => $report->submission_status,
            'signatories' => $report->signatories,
            'supporting_documents' => $report->supporting_documents ?? [],
            'total_income' => round((float) $transactions->where('type', 'income')->sum('amount'), 2),
            'total_expense' => round((float) $transactions->where('type', 'expense')->sum('amount'), 2),
            'net_balance' => round((float) $transactions->where('type', 'income')->sum('amount') - (float) $transactions->where('type', 'expense')->sum('amount'), 2),
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
        Notification::create([
            'organization_id' => $approval->organization_id,
            'user_id' => $approval->requested_by,
            'title' => 'Approval Request '.Str::headline($status),
            'message' => Str::headline($approval->entity_type).' "'.$label.'" was '.$status.'.',
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
