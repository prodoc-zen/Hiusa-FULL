<?php

namespace App\Http\Controllers;

use App\Models\Notification;
use App\Models\User;
use Illuminate\Http\Request;

class NotificationController extends Controller
{
    public function index(Request $request)
    {
        $notifications = Notification::where('user_id', $request->user()->id)
            ->orderBy('created_at', 'desc')
            ->get();

        return response()->json([
            'notifications' => $notifications,
            'unread_count'  => $notifications->where('is_read', false)->count(),
        ]);
    }

    public function markRead(Request $request, $id)
    {
        $notification = Notification::find($id);

        if (!$notification) {
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
            ->where('is_read', false)
            ->update(['is_read' => true]);

        return response()->json(['message' => 'All notifications marked as read.']);
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'title'       => ['required', 'string', 'max:255'],
            'message'     => ['required', 'string'],
            'user_id'     => ['nullable', 'exists:users,id'],
            'target_role' => ['nullable', 'in:student,officer,adviser,admin'],
        ]);

        if (!empty($data['user_id'])) {
            $notification = Notification::create([
                'user_id' => $data['user_id'],
                'title'   => $data['title'],
                'message' => $data['message'],
                'is_read' => false,
            ]);

            return response()->json($notification, 201);
        }

        if (!empty($data['target_role'])) {
            $userIds = User::where('role', $data['target_role'])->pluck('id');
            $now = now();

            Notification::insert(
                $userIds->map(fn($uid) => [
                    'user_id'    => $uid,
                    'title'      => $data['title'],
                    'message'    => $data['message'],
                    'is_read'    => false,
                    'created_at' => $now,
                    'updated_at' => $now,
                ])->all()
            );

            return response()->json([
                'message' => "Sent to {$userIds->count()} user(s).",
                'count'   => $userIds->count(),
            ], 201);
        }

        return response()->json(['message' => 'Provide either user_id or target_role.'], 422);
    }
}
