<?php

namespace App\Http\Controllers;

use App\Models\Announcement;
use App\Models\ApprovalRequest;
use App\Models\AuditLog;
use App\Models\Budget;
use App\Models\Election;
use App\Models\Event;
use App\Models\Notification;
use App\Models\Order;
use App\Models\User;
use App\Services\OrderFulfillmentService;
use DomainException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class ApprovalRequestController extends Controller
{
    public function __construct(private readonly OrderFulfillmentService $fulfillmentService) {}

    public function index(Request $request)
    {
        $paging = $request->validate([
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);

        $requiredRole = $request->user()->role === 'ADMIN' ? 'ADMIN' : 'DEPARTMENT_HEAD';
        $query = ApprovalRequest::with([
            'requester:school_id,first_name,last_name,role',
            'reviewer:school_id,first_name,last_name,role',
        ])
            ->where('organization_id', $request->user()->organization_id)
            ->where('required_role', $requiredRole)
            ->orderBy('requested_at', 'desc');

        $status = $request->query('status', 'pending');

        if ($status !== 'all') {
            $query->where('status', $status);
        }

        $approvals = $query->paginate($paging['per_page'] ?? 20);
        $this->attachEntityDetails($approvals);

        return response()->json($approvals);
    }

    public function review(Request $request, $id)
    {
        $approval = ApprovalRequest::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $approval) {
            return response()->json(['message' => 'Approval request not found.'], 404);
        }

        if ($approval->status !== 'pending') {
            return response()->json(['message' => 'This request has already been reviewed.'], 409);
        }

        if (! $this->canReview($request->user()->role, $approval->required_role)) {
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
                $approval = ApprovalRequest::where('organization_id', $request->user()->organization_id)
                    ->lockForUpdate()
                    ->findOrFail($approval->id);

                if ($approval->status !== 'pending') {
                    throw new DomainException('This request has already been reviewed.');
                }

                $approval->update([
                    'status' => $data['status'],
                    'active_key' => null,
                    'remarks' => $data['remarks'] ?? null,
                    'reviewed_by' => $request->user()->id,
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
        if ($userRole === 'ADMIN') {
            return $requiredRole === 'ADMIN';
        }

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
            default => null,
        };
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
                'reviewed_by' => $request->user()->id,
                'review_remarks' => $approval->remarks,
                'is_published' => false,
            ]),
            'payment' => $this->fulfillmentService->rejectPayment(
                Order::where('organization_id', $approval->organization_id)->findOrFail($approval->entity_id),
                $request->user(),
                (string) $approval->remarks
            ),
            default => null,
        };
    }

    private function attachEntityDetails($approvals): void
    {
        $grouped = $approvals->groupBy('entity_type');
        $organizationId = $approvals->first()?->organization_id;
        $entities = [
            'event' => Event::where('organization_id', $organizationId)->whereIn('id', $grouped->get('event', collect())->pluck('entity_id'))->get()->keyBy('id'),
            'budget' => Budget::with('event:id,title')->where('organization_id', $organizationId)->whereIn('id', $grouped->get('budget', collect())->pluck('entity_id'))->get()->keyBy('id'),
            'election' => Election::where('organization_id', $organizationId)->whereIn('id', $grouped->get('election', collect())->pluck('entity_id'))->get()->keyBy('id'),
            'announcement' => Announcement::where('organization_id', $organizationId)->whereIn('id', $grouped->get('announcement', collect())->pluck('entity_id'))->get()->keyBy('id'),
            'payment' => Order::with([
                'merchandise:id,name',
                'student:school_id,first_name,last_name',
            ])->where('organization_id', $organizationId)->whereIn('id', $grouped->get('payment', collect())->pluck('entity_id'))->get()->keyBy('id'),
        ];

        foreach ($approvals as $approval) {
            $entity = ($entities[$approval->entity_type] ?? collect())->get($approval->entity_id);
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
            default => null,
        };
    }

    private function approveAnnouncement(ApprovalRequest $approval, Request $request): void
    {
        $announcement = Announcement::where('organization_id', $approval->organization_id)->where('id', $approval->entity_id)->first();

        if (! $announcement) {
            return;
        }

        $announcement->update([
            'approval_status' => 'approved',
            'reviewed_by' => $request->user()->id,
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
        Notification::create([
            'organization_id' => $approval->organization_id,
            'user_id' => $approval->requested_by,
            'title' => 'Approval Request '.Str::headline($status),
            'message' => Str::headline($approval->entity_type).' request #'.$approval->entity_id.' was '.$status.'.',
            'notification_type' => 'general',
            'reference_type' => 'approval_request',
            'reference_id' => $approval->id,
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
            default => null,
        };

        return $query
            ? $query->where('organization_id', $approval->organization_id)->whereKey($approval->entity_id)->exists()
            : false;
    }

    private function recordApprovalAudit(Request $request, ApprovalRequest $approval, string $status): void
    {
        AuditLog::create([
            'organization_id' => $request->user()?->organization_id,
            'user_id' => $request->user()?->school_id,
            'module' => 'approvals',
            'action' => 'reviewed_'.$status,
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
