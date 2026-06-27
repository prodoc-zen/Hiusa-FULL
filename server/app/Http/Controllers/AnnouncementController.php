<?php

namespace App\Http\Controllers;

use App\Models\Announcement;
use Illuminate\Http\Request;

class AnnouncementController extends Controller
{
    public function index(Request $request)
    {
        $user = $request->user();

        $query = Announcement::with('creator:id,first_name,last_name,role')
            ->orderBy('created_at', 'desc');

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
            'is_published' => ['boolean'],
        ]);

        $announcement = Announcement::create([
            'title'        => $data['title'],
            'body'         => $data['body'],
            'target_role'  => $data['target_role'],
            'is_published' => $data['is_published'] ?? false,
            'created_by'   => $request->user()->id,
        ]);

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
            'is_published' => ['sometimes', 'boolean'],
        ]);

        $announcement->update($data);

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

        $announcement->update(['is_published' => !$announcement->is_published]);

        return response()->json($announcement->fresh()->load('creator:id,first_name,last_name,role'));
    }
}
