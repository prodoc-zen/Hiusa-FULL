<?php

namespace App\Http\Controllers;

use App\Models\Announcement;
use App\Models\Election;
use App\Models\Event;
use App\Models\Vote;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class StudentFeedController extends Controller
{
    public function index(Request $request)
    {
        $data = $request->validate([
            'page' => ['nullable', 'integer', 'min:1', 'max:10000'],
            'per_page' => ['nullable', 'integer', 'min:10', 'max:20'],
        ]);

        $user = $request->user();
        $organizationId = $user->organization_id;
        $perPage = (int) ($data['per_page'] ?? 12);

        $announcements = DB::table('announcements')
            ->selectRaw("'announcement' as item_type, id as item_id, COALESCE(published_at, created_at) as sort_at, is_pinned as is_pinned")
            ->where('organization_id', $organizationId)
            ->where('is_published', true)
            ->where('approval_status', 'approved')
            ->where(function ($query) use ($user) {
                $query->where('target_role', 'all')->orWhere('target_role', $user->role);
            });

        $events = DB::table('events')
            ->selectRaw("'event' as item_type, id as item_id, created_at as sort_at, 0 as is_pinned")
            ->where('organization_id', $organizationId)
            ->whereIn('status', ['approved', 'ongoing', 'completed']);

        $elections = DB::table('elections')
            ->selectRaw("'election' as item_type, id as item_id, created_at as sort_at, 0 as is_pinned")
            ->where('organization_id', $organizationId)
            ->where(function ($query) {
                $query->where('status', 'active')
                    ->where('start_time', '<=', now())
                    ->where('end_time', '>=', now())
                    ->orWhere(function ($closed) {
                        $closed->where('status', 'closed')->where('results_visible', true);
                    });
            });

        $page = DB::query()
            ->fromSub($announcements->unionAll($events)->unionAll($elections), 'feed_items')
            ->orderByDesc('is_pinned')
            ->orderByDesc('sort_at')
            ->orderByDesc('item_type')
            ->orderByDesc('item_id')
            ->simplePaginate($perPage);
        $rows = collect($page->items());

        $announcementModels = Announcement::with('creator:school_id,first_name,last_name,position_title')
            ->where('organization_id', $organizationId)
            ->whereIn('id', $rows->where('item_type', 'announcement')->pluck('item_id'))
            ->get()->keyBy('id');
        $eventModels = Event::with('creator:school_id,first_name,last_name,position_title')
            ->where('organization_id', $organizationId)
            ->whereIn('id', $rows->where('item_type', 'event')->pluck('item_id'))
            ->get()->keyBy('id');
        $electionModels = Election::withCount(['positions', 'candidates'])
            ->where('organization_id', $organizationId)
            ->whereIn('id', $rows->where('item_type', 'election')->pluck('item_id'))
            ->get()->keyBy('id');

        $votedElectionIds = Vote::where('voter_id', $user->id)
            ->whereIn('election_id', $electionModels->keys())
            ->distinct()->pluck('election_id')->map(fn ($id) => (int) $id)->all();

        $items = $rows->map(function ($row) use ($announcementModels, $eventModels, $electionModels, $votedElectionIds) {
            $model = match ($row->item_type) {
                'announcement' => $announcementModels->get($row->item_id),
                'event' => $eventModels->get($row->item_id),
                'election' => $electionModels->get($row->item_id),
                default => null,
            };
            if (! $model) {
                return null;
            }

            $payload = match ($row->item_type) {
                'announcement' => [
                    'id' => $model->id,
                    'title' => $model->title,
                    'body' => $model->body,
                    'image_url' => $model->image_url,
                    'category' => $model->category,
                    'target_role' => $model->target_role,
                    'is_important' => $model->is_important,
                    'published_at' => $model->published_at,
                    'created_at' => $model->created_at,
                    'creator' => $model->creator,
                ],
                'event' => [
                    'id' => $model->id,
                    'title' => $model->title,
                    'description' => $model->description,
                    'image_url' => $model->image_url,
                    'start_time' => $model->start_time,
                    'end_time' => $model->end_time,
                    'location' => $model->location,
                    'status' => $model->status,
                    'created_at' => $model->created_at,
                    'creator' => $model->creator,
                ],
                'election' => [
                    'id' => $model->id,
                    'title' => $model->title,
                    'image_url' => $model->image_url,
                    'start_time' => $model->start_time,
                    'end_time' => $model->end_time,
                    'status' => $model->status,
                    'positions_count' => $model->positions_count,
                    'candidates_count' => $model->candidates_count,
                    'has_voted' => in_array((int) $model->id, $votedElectionIds, true),
                    'created_at' => $model->created_at,
                ],
            };

            return [
                'key' => $row->item_type.'-'.$row->item_id,
                'type' => $row->item_type,
                'sort_at' => $row->sort_at,
                'is_pinned' => (bool) $row->is_pinned,
                'data' => $payload,
            ];
        })->filter()->values();

        $activeElection = Election::withCount(['positions', 'candidates'])
            ->where('organization_id', $organizationId)
            ->where('status', 'active')
            ->where('start_time', '<=', now())
            ->where('end_time', '>=', now())
            ->orderBy('end_time')->first();
        if ($activeElection) {
            $activeElection->has_voted = Vote::where('voter_id', $user->id)
                ->where('election_id', $activeElection->id)->exists();
        }

        $upcomingEvents = Event::where('organization_id', $organizationId)
            ->whereIn('status', ['approved', 'ongoing'])
            ->where('end_time', '>=', now())
            ->orderBy('start_time')->limit(3)
            ->get(['id', 'title', 'start_time', 'end_time', 'location', 'status']);

        return response()->json([
            'items' => $items,
            'organization' => $user->organization?->only(['id', 'name', 'acronym', 'college']),
            'sidebar' => ['active_election' => $activeElection, 'upcoming_events' => $upcomingEvents],
            'pagination' => [
                'current_page' => $page->currentPage(),
                'has_more' => $page->hasMorePages(),
                'next_page' => $page->hasMorePages() ? $page->currentPage() + 1 : null,
                'per_page' => $perPage,
            ],
        ]);
    }
}
