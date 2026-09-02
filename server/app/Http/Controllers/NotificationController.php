<?php

namespace App\Http\Controllers;

use App\Models\Notification;
use App\Models\User;
use Illuminate\Http\Request;

class NotificationController extends Controller
{
    public function index(Request $request)
    {
        $paging = $request->validate([
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);

        $query = Notification::where('user_id', $request->user()->id)
            ->where('organization_id', $request->user()->organization_id)
            ->where(function ($query) {
                $query->whereNull('scheduled_at')->orWhere('scheduled_at', '<=', now());
            });

        $unreadCount = (clone $query)->where('is_read', false)->count();
        $notifications = $query
            ->orderByRaw('COALESCE(sent_at, created_at) DESC')
            ->paginate($paging['per_page'] ?? 20);

        return response()->json([
            ...$notifications->toArray(),
            'unread_count' => $unreadCount,
        ]);
    }

    public function markRead(Request $request, $id)
    {
        $notification = Notification::where('organization_id', $request->user()->organization_id)
            ->where(function ($query) {
                $query->whereNull('scheduled_at')->orWhere('scheduled_at', '<=', now());
            })
            ->find($id);

        if (! $notification) {
            return response()->json(['message' => 'Notification not found.'], 404);
        }

        if ($notification->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        $notification->update(['is_read' => true]);

        return response()->json($notification->fresh());
    }

    public function markAllRead(Request $request)
    {
        Notification::where('user_id', $request->user()->id)
            ->where('organization_id', $request->user()->organization_id)
            ->where('is_read', false)
            ->where(function ($query) {
                $query->whereNull('scheduled_at')->orWhere('scheduled_at', '<=', now());
            })
            ->update(['is_read' => true]);

        return response()->json(['message' => 'All notifications marked as read.']);
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'title' => ['required', 'string', 'max:255'],
            'message' => ['required', 'string'],
            'user_id' => ['nullable', 'exists:users,school_id'],
            'target_role' => ['nullable', 'in:STUDENT,SBO_OFFICER,ADMIN,DEPARTMENT_HEAD'],
            'notification_type' => ['nullable', 'in:general,event,announcement,task,election,merchandise,financial'],
            'reference_type' => ['nullable', 'string', 'max:40'],
            'reference_id' => ['nullable', 'integer'],
            'scheduled_at' => ['nullable', 'date'],
        ]);

        if (! empty($data['user_id'])) {
            $recipientBelongsToOrganization = User::where('organization_id', $request->user()->organization_id)
                ->where('school_id', $data['user_id'])
                ->where('account_status', 'active')
                ->exists();

            if (! $recipientBelongsToOrganization) {
                return response()->json(['message' => 'Select an active user from this organization.'], 422);
            }

            $notification = Notification::create($this->payload($data, $request->user()->organization_id, $data['user_id']));

            return response()->json($notification, 201);
        }

        if (! empty($data['target_role'])) {
            $userIds = User::where('organization_id', $request->user()->organization_id)
                ->where('role', $data['target_role'])
                ->where('account_status', 'active')
                ->pluck('school_id');

            Notification::insert(
                $userIds->map(fn ($uid) => $this->payload($data, $request->user()->organization_id, $uid))->all()
            );

            return response()->json([
                'message' => "Sent to {$userIds->count()} user(s).",
                'count' => $userIds->count(),
            ], 201);
        }

        return response()->json(['message' => 'Provide either user_id or target_role.'], 422);
    }

    private function payload(array $data, int $organizationId, int $userId): array
    {
        $now = now();

        return [
            'organization_id' => $organizationId,
            'user_id' => $userId,
            'notification_type' => $data['notification_type'] ?? 'general',
            'title' => $data['title'],
            'message' => $data['message'],
            'reference_type' => $data['reference_type'] ?? null,
            'reference_id' => $data['reference_id'] ?? null,
            'scheduled_at' => $data['scheduled_at'] ?? null,
            'sent_at' => empty($data['scheduled_at']) ? $now : null,
            'is_read' => false,
            'created_at' => $now,
            'updated_at' => $now,
        ];
    }
}
