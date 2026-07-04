<?php

namespace App\Http\Controllers;

use App\Models\Announcement;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class AnnouncementController extends Controller
{
    public function index(Request $request)
    {
        $user = $request->user();

        $allowedCategories = ['general', 'election', 'training', 'events', 'merchandise'];
        $category = strtolower((string) $request->query('category', ''));

        $query = Announcement::with('creator:id,first_name,last_name,role')
            ->orderBy('created_at', 'desc');

        if ($category !== '' && in_array($category, $allowedCategories, true)) {
            $query->where('category', $category);
        }

        if (in_array($user->role, ['student', 'adviser'])) {
            $query->where('is_published', true)
                ->where(function ($q) use ($user) {
                    $q->where('target_role', 'all')
                        ->orWhere('target_role', $user->role);
                });
        }

        return response()->json($query->get());
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'title'       => ['required', 'string', 'max:255'],
            'body'        => ['required', 'string'],
            'target_role' => ['required', 'in:all,student,officer,adviser'],
            'category'    => ['nullable', 'in:general,election,training,events,merchandise'],
            'is_published' => ['boolean'],
        ]);

        $announcement = Announcement::create([
            'title'        => $data['title'],
            'body'         => $data['body'],
            'target_role'  => $data['target_role'],
            'category'     => $data['category'] ?? 'general',
            'is_published' => $data['is_published'] ?? false,
            'created_by'   => $request->user()->id,
        ]);

        if ($announcement->is_published) {
            $this->dispatchAnnouncementNotifications($announcement);
        }

        return response()->json($announcement->load('creator:id,first_name,last_name,role'), 201);
    }

    public function update(Request $request, $id)
    {
        $announcement = Announcement::find($id);

        if (!$announcement) {
            return response()->json(['message' => 'Announcement not found.'], 404);
        }

        $user = $request->user();

        if ($announcement->created_by !== $user->id && $user->role !== 'admin') {
            return response()->json(['message' => 'You can only edit your own announcements.'], 403);
        }

        $data = $request->validate([
            'title'        => ['sometimes', 'required', 'string', 'max:255'],
            'body'         => ['sometimes', 'required', 'string'],
            'target_role'  => ['sometimes', 'required', 'in:all,student,officer,adviser'],
            'category'     => ['sometimes', 'required', 'in:general,election,training,events,merchandise'],
            'is_published' => ['sometimes', 'boolean'],
        ]);

        $wasPublished = (bool) $announcement->is_published;
        $announcement->update($data);

        if (!$wasPublished && $announcement->is_published) {
            $this->dispatchAnnouncementNotifications($announcement);
        }

        return response()->json($announcement->fresh()->load('creator:id,first_name,last_name,role'));
    }

    public function destroy(Request $request, $id)
    {
        $announcement = Announcement::find($id);

        if (!$announcement) {
            return response()->json(['message' => 'Announcement not found.'], 404);
        }

        $user = $request->user();

        if ($announcement->created_by !== $user->id && $user->role !== 'admin') {
            return response()->json(['message' => 'You can only delete your own announcements.'], 403);
        }

        $announcement->delete();

        return response()->json(['message' => 'Announcement deleted successfully.']);
    }

    public function togglePublish(Request $request, $id)
    {
        $announcement = Announcement::find($id);

        if (!$announcement) {
            return response()->json(['message' => 'Announcement not found.'], 404);
        }

        $user = $request->user();

        if ($announcement->created_by !== $user->id && $user->role !== 'admin') {
            return response()->json(['message' => 'You can only publish your own announcements.'], 403);
        }

        $wasPublished = $announcement->is_published;
        $announcement->update(['is_published' => !$wasPublished]);

        if (!$wasPublished && $announcement->is_published) {
            $this->dispatchAnnouncementNotifications($announcement);
        }

        return response()->json($announcement->fresh()->load('creator:id,first_name,last_name,role'));
    }

    private function dispatchAnnouncementNotifications(Announcement $announcement): void
    {
        $query = User::query()->where('id', '!=', $announcement->created_by);

        if ($announcement->target_role !== 'all') {
            $query->where('role', $announcement->target_role);
        }

        $userIds = $query->pluck('id');

        if ($userIds->isEmpty()) {
            return;
        }

        $now = now();
        $message = Str::limit(trim(preg_replace('/\s+/', ' ', strip_tags((string) $announcement->body))), 180);
        $title = 'New Announcement: ' . Str::limit($announcement->title, 230);

        foreach ($userIds->chunk(100) as $chunk) {
            Notification::insert(
                $chunk->map(fn($userId) => [
                    'user_id'    => $userId,
                    'title'      => $title,
                    'message'    => $message,
                    'is_read'    => false,
                    'created_at' => $now,
                    'updated_at' => $now,
                ])->all()
            );
        }
    }
}
