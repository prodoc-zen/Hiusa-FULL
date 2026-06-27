<?php

namespace App\Http\Controllers;

use App\Models\Election;
use App\Models\Vote;
use App\Models\Candidate;
use App\Models\ElectionPosition;
use App\Models\Partylist;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class ElectionController extends Controller
{
    public function index()
    {
        $query = Election::withCount(['votes', 'positions', 'candidates']);

        if (request()->user()?->role === 'student') {
            $query->where('status', 'active');
        }

        $elections = $query
            ->orderBy('created_at', 'desc')
            ->get();
            
        return response()->json($elections);
    }

    public function show($id)
    {
        $election = Election::with([
            'positions.candidates.user',
            'positions.candidates.partylist',
            'candidates.user',
            'candidates.partylist',
            'votes.voter'
        ])->find($id);

        if (!$election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        if (request()->user()?->role === 'student' && $election->status !== 'active') {
            return response()->json(['message' => 'Students can only access active elections.'], 403);
        }

        return response()->json($election);
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'title' => ['required', 'string', 'max:255'],
            'start_time' => ['required', 'date'],
            'end_time' => ['required', 'date', 'after:start_time'],
            'status' => ['required', 'in:upcoming,active,closed'],
        ]);

        $election = Election::create($data);

        return response()->json($election, 201);
    }

    public function update(Request $request, $id)
    {
        $election = Election::find($id);

        if (!$election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        $data = $request->validate([
            'title' => ['sometimes', 'required', 'string', 'max:255'],
            'start_time' => ['sometimes', 'required', 'date'],
            'end_time' => ['sometimes', 'required', 'date'],
            'status' => ['sometimes', 'required', 'in:upcoming,active,closed'],
        ]);

        if (array_key_exists('start_time', $data) && array_key_exists('end_time', $data) && $data['end_time'] <= $data['start_time']) {
            return response()->json(['message' => 'End time must be after start time.'], 422);
        }

        $election->update($data);

        return response()->json($election->fresh());
    }

    public function destroy($id)
    {
        $election = Election::find($id);

        if (!$election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        $election->delete();

        return response()->json(['message' => 'Election deleted successfully']);
    }

    public function positionsIndex($id)
    {
        $election = Election::find($id);

        if (!$election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        return response()->json($election->positions()->withCount('candidates')->orderBy('id')->get());
    }

    public function positionsStore(Request $request, $id)
    {
        $election = Election::find($id);

        if (!$election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        $data = $request->validate([
            'title' => ['required', 'string', 'max:100'],
            'max_winners' => ['nullable', 'integer', 'min:1'],
        ]);

        $position = $election->positions()->create([
            'title' => $data['title'],
            'max_winners' => $data['max_winners'] ?? 1,
        ]);

        return response()->json($position, 201);
    }

    public function positionsUpdate(Request $request, $id, $positionId)
    {
        $position = ElectionPosition::where('election_id', $id)->find($positionId);

        if (!$position) {
            return response()->json(['message' => 'Position not found'], 404);
        }

        $data = $request->validate([
            'title' => ['sometimes', 'required', 'string', 'max:100'],
            'max_winners' => ['sometimes', 'required', 'integer', 'min:1'],
        ]);

        $position->update($data);

        return response()->json($position->fresh());
    }

    public function positionsDestroy($id, $positionId)
    {
        $position = ElectionPosition::where('election_id', $id)->find($positionId);

        if (!$position) {
            return response()->json(['message' => 'Position not found'], 404);
        }

        $position->delete();

        return response()->json(['message' => 'Position deleted successfully']);
    }

    public function candidatesIndex($id)
    {
        $election = Election::find($id);

        if (!$election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        return response()->json(
            Candidate::with(['user', 'partylist', 'position'])
                ->where('election_id', $election->id)
                ->orderBy('id')
                ->get()
        );
    }

    public function candidatesStore(Request $request, $id)
    {
        $election = Election::find($id);

        if (!$election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        $data = $request->validate([
            'user_id' => ['required', 'exists:users,id'],
            'position_id' => ['required', 'exists:election_positions,id'],
            'partylist_id' => ['nullable', 'exists:partylists,id'],
            'platform' => ['nullable', 'string'],
            'image_url' => ['nullable', 'string', 'max:255'],
        ]);

        $position = ElectionPosition::where('election_id', $election->id)->find($data['position_id']);

        if (!$position) {
            return response()->json(['message' => 'Position does not belong to this election'], 422);
        }

        $candidate = Candidate::create([
            'election_id' => $election->id,
            'user_id' => $data['user_id'],
            'position_id' => $data['position_id'],
            'partylist_id' => $data['partylist_id'] ?? null,
            'platform' => $data['platform'] ?? null,
            'image_url' => $data['image_url'] ?? null,
        ]);

        return response()->json($candidate->load(['user', 'partylist', 'position']), 201);
    }

    public function candidatesUpdate(Request $request, $id, $candidateId)
    {
        $candidate = Candidate::where('election_id', $id)->find($candidateId);

        if (!$candidate) {
            return response()->json(['message' => 'Candidate not found'], 404);
        }

        $data = $request->validate([
            'user_id' => ['sometimes', 'required', 'exists:users,id'],
            'position_id' => ['sometimes', 'required', 'exists:election_positions,id'],
            'partylist_id' => ['nullable', 'exists:partylists,id'],
            'platform' => ['nullable', 'string'],
            'image_url' => ['nullable', 'string', 'max:255'],
        ]);

        if (array_key_exists('position_id', $data)) {
            $position = ElectionPosition::where('election_id', $candidate->election_id)->find($data['position_id']);

            if (!$position) {
                return response()->json(['message' => 'Position does not belong to this election'], 422);
            }
        }

        $candidate->update($data);

        return response()->json($candidate->fresh()->load(['user', 'partylist', 'position']));
    }

    public function candidatesDestroy($id, $candidateId)
    {
        $candidate = Candidate::where('election_id', $id)->find($candidateId);

        if (!$candidate) {
            return response()->json(['message' => 'Candidate not found'], 404);
        }

        $candidate->delete();

        return response()->json(['message' => 'Candidate deleted successfully']);
    }

    public function partylistsIndex()
    {
        return response()->json(Partylist::withCount('candidates')->orderBy('name')->get());
    }

    public function partylistsStore(Request $request)
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255', 'unique:partylists,name'],
            'acronym' => ['nullable', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
        ]);

        $partylist = Partylist::create($data);

        return response()->json($partylist, 201);
    }

    public function partylistsUpdate(Request $request, $id)
    {
        $partylist = Partylist::find($id);

        if (!$partylist) {
            return response()->json(['message' => 'Partylist not found'], 404);
        }

        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'acronym' => ['nullable', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
        ]);

        $partylist->update($data);

        return response()->json($partylist->fresh());
    }

    public function partylistsDestroy($id)
    {
        $partylist = Partylist::find($id);

        if (!$partylist) {
            return response()->json(['message' => 'Partylist not found'], 404);
        }

        $partylist->delete();

        return response()->json(['message' => 'Partylist deleted successfully']);
    }

    public function vote(Request $request, $id)
    {
        $election = Election::find($id);
        if (!$election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        if ($election->status !== 'active') {
            return response()->json(['message' => 'This election is not currently accepting votes'], 400);
        }

        $request->validate([
            'votes' => 'required|array',
            'votes.*.position_id' => 'required|exists:election_positions,id',
            'votes.*.candidate_id' => 'required|exists:candidates,id',
        ]);

        $voter = $request->user();
        
        $receipts = [];

        DB::transaction(function () use ($election, $voter, $request, &$receipts) {
            foreach ($request->votes as $voteData) {
                // Verify candidate belongs to the position and election
                $candidate = Candidate::where('id', $voteData['candidate_id'])
                    ->where('position_id', $voteData['position_id'])
                    ->where('election_id', $election->id)
                    ->first();

                if (!$candidate) {
                    throw ValidationException::withMessages([
                        'votes' => ['Invalid candidate selection for the specified position.']
                    ]);
                }

                // Check if user has already voted for this specific position (secondary safety check)
                $hasVotedPosition = Vote::where('election_id', $election->id)
                    ->where('position_id', $voteData['position_id'])
                    ->where('voter_id', $voter->id)
                    ->exists();

                if ($hasVotedPosition) {
                    throw ValidationException::withMessages([
                        'votes' => ['Multiple votes for a single position are not permitted.']
                    ]);
                }

                $hash = strtoupper(Str::random(12));
                $receipts[] = $hash;

                Vote::create([
                    'election_id' => $election->id,
                    'position_id' => $voteData['position_id'],
                    'candidate_id' => $voteData['candidate_id'],
                    'voter_id' => $voter->id,
                    'vote_hash' => $hash,
                ]);
            }
        });

        return response()->json([
            'success' => true,
            'message' => 'Your ballot has been cast successfully!',
            'receipt' => $receipts[0] ?? 'CAST-SUCCESSFUL',
            'receipts' => $receipts,
        ]);
    }

    public function voters($id)
    {
        $election = Election::find($id);
        if (!$election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        $voterIds = Vote::where('election_id', $id)
            ->distinct()
            ->pluck('voter_id');

        $students = User::where('role', 'student')
            ->orderBy('last_name')
            ->orderBy('first_name')
            ->get(['id', 'school_id', 'first_name', 'last_name', 'email'])
            ->map(fn($s) => array_merge($s->toArray(), ['has_voted' => $voterIds->contains($s->id)]));

        return response()->json($students);
    }

    public function results($id)
    {
        $election = Election::find($id);
        if (!$election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        $positions = ElectionPosition::where('election_id', $id)->get();
        $results = [];

        foreach ($positions as $position) {
            $candidates = Candidate::with(['user', 'partylist'])
                ->where('position_id', $position->id)
                ->get()
                ->map(function ($candidate) {
                    $votesCount = Vote::where('candidate_id', $candidate->id)->count();
                    return [
                        'id' => $candidate->id,
                        'name' => $candidate->user->first_name . ' ' . $candidate->user->last_name,
                        'partylist' => $candidate->partylist ? $candidate->partylist->name : 'Independent',
                        'votes' => $votesCount,
                    ];
                })
                ->sortByDesc('votes')
                ->values();

            $totalVotes = $candidates->sum('votes');

            $results[] = [
                'position' => $position,
                'candidates' => $candidates,
                'totalVotes' => $totalVotes,
            ];
        }

        return response()->json($results);
    }
}
