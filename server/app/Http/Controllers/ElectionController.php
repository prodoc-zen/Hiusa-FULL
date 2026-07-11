<?php

namespace App\Http\Controllers;

use App\Models\ApprovalRequest;
use App\Models\Election;
use App\Models\Vote;
use App\Models\Candidate;
use App\Models\ElectionPosition;
use App\Models\Partylist;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class ElectionController extends Controller
{
    private function storePartylistBanner(Request $request): string
    {
        $file = $request->file('banner');
        $ext = strtolower($file->extension() ?: 'jpg');
        $filename = Str::uuid()->toString() . '.' . $ext;
        $destDir = public_path('uploads/partylists');

        if (!is_dir($destDir)) {
            mkdir($destDir, 0755, true);
        }

        $file->move($destDir, $filename);

        return '/uploads/partylists/' . $filename;
    }

    private function deletePartylistBanner(?string $bannerUrl): void
    {
        if (!$bannerUrl) {
            return;
        }

        if (str_starts_with($bannerUrl, '/storage/')) {
            Storage::delete('public/' . ltrim(str_replace('/storage/', '', $bannerUrl), '/'));
            return;
        }

        if (str_starts_with($bannerUrl, '/uploads/')) {
            $fullPath = public_path(ltrim($bannerUrl, '/'));
            if (is_file($fullPath)) {
                @unlink($fullPath);
            }
        }
    }

    public function index(Request $request)
    {
        $query = Election::withCount(['votes', 'positions', 'candidates'])
            ->where('organization_id', $request->user()->organization_id);

        if ($request->user()?->role === 'STUDENT') {
            $query->where('status', 'active');
        }

        $elections = $query
            ->orderBy('created_at', 'desc')
            ->get();
            
        return response()->json($elections);
    }

    public function show(Request $request, $id)
    {
        $user = $request->user();
        $with = [
            'positions.candidates.user',
            'positions.candidates.partylist',
            'positions.candidates.position',
            'candidates.user',
            'candidates.partylist',
            'candidates.position',
        ];

        if ($user?->role !== 'STUDENT') {
            $with[] = 'votes.voter';
        }

        $election = Election::with($with)
            ->where('organization_id', $user->organization_id)
            ->find($id);

        if (!$election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        if ($user?->role === 'STUDENT') {
            if ($election->status !== 'active') {
                return response()->json(['message' => 'Students can only access active elections.'], 403);
            }

            // Only return this student's own votes (never expose other voters' identities)
            $myVotes = Vote::where('election_id', $id)
                ->where('voter_id', $user->id)
                ->get(['id', 'position_id', 'candidate_id', 'vote_hash', 'voter_id']);

            // Aggregate counts per candidate so live standings work without exposing voter identity
            $candidateIds = $election->candidates->pluck('id');
            $voteCounts = $candidateIds->isNotEmpty()
                ? Vote::whereIn('candidate_id', $candidateIds)
                    ->selectRaw('candidate_id, COUNT(*) as count')
                    ->groupBy('candidate_id')
                    ->get()->pluck('count', 'candidate_id')
                : collect();

            $data = $election->toArray();
            $data['my_votes']    = $myVotes;
            $data['vote_counts'] = $voteCounts;

            return response()->json($data);
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

        $targetStatus = $data['status'];

        $election = Election::create([
            ...$data,
            'status' => 'pending_approval',
            'organization_id' => $request->user()->organization_id,
        ]);

        ApprovalRequest::create([
            'organization_id' => $request->user()->organization_id,
            'entity_type' => 'election',
            'entity_id' => $election->id,
            'title' => $election->title,
            'summary' => [
                'start_time' => $election->start_time,
                'end_time' => $election->end_time,
                'target_status' => $targetStatus,
            ],
            'requested_by' => $request->user()->id,
        ]);

        return response()->json($election, 201);
    }

    public function update(Request $request, $id)
    {
        $election = Election::where('organization_id', $request->user()->organization_id)->find($id);

        if (!$election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        $data = $request->validate([
            'title' => ['sometimes', 'required', 'string', 'max:255'],
            'start_time' => ['sometimes', 'required', 'date'],
            'end_time' => ['sometimes', 'required', 'date'],
            'status' => ['sometimes', 'required', 'in:upcoming,active,closed'],
        ]);

        if (array_key_exists('status', $data) && $election->status === 'pending_approval') {
            return response()->json([
                'message' => 'This election is awaiting Department Head approval and cannot be activated directly.',
            ], 422);
        }

        $endTime   = isset($data['end_time'])   ? \Carbon\Carbon::parse($data['end_time'])   : $election->end_time;
        $startTime = isset($data['start_time']) ? \Carbon\Carbon::parse($data['start_time']) : $election->start_time;
        if ($endTime->lte($startTime)) {
            return response()->json(['message' => 'End time must be after start time.'], 422);
        }

        $election->update($data);

        ApprovalRequest::where('entity_type', 'election')
            ->where('entity_id', $election->id)
            ->where('status', 'rejected')
            ->update([
                'status' => 'pending',
                'reviewed_by' => null,
                'reviewed_at' => null,
                'remarks' => null,
                'requested_at' => now(),
            ]);

        return response()->json($election->fresh());
    }

    public function destroy(Request $request, $id)
    {
        $election = Election::where('organization_id', $request->user()->organization_id)->find($id);

        if (!$election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        if ($election->votes()->exists()) {
            return response()->json(['message' => 'Cannot delete an election that already has votes cast.'], 409);
        }

        $election->delete();

        return response()->json(['message' => 'Election deleted successfully']);
    }

    public function positionsIndex(Request $request, $id)
    {
        $election = Election::where('organization_id', $request->user()->organization_id)->find($id);

        if (!$election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        return response()->json($election->positions()->withCount('candidates')->orderBy('id')->get());
    }

    public function positionsStore(Request $request, $id)
    {
        $election = Election::where('organization_id', $request->user()->organization_id)->find($id);

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
        $election = Election::where('organization_id', $request->user()->organization_id)->find($id);

        if (!$election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        $position = ElectionPosition::where('election_id', $election->id)->find($positionId);

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

    public function positionsDestroy(Request $request, $id, $positionId)
    {
        $election = Election::where('organization_id', $request->user()->organization_id)->find($id);

        if (!$election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        $position = ElectionPosition::where('election_id', $election->id)->find($positionId);

        if (!$position) {
            return response()->json(['message' => 'Position not found'], 404);
        }

        if ($position->votes()->exists()) {
            return response()->json(['message' => 'Cannot delete a position that already has votes cast.'], 409);
        }

        $position->delete();

        return response()->json(['message' => 'Position deleted successfully']);
    }

    public function candidatesIndex(Request $request, $id)
    {
        $election = Election::where('organization_id', $request->user()->organization_id)->find($id);

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
        $election = Election::where('organization_id', $request->user()->organization_id)->find($id);

        if (!$election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        $data = $request->validate([
            'user_id' => ['required', 'exists:users,school_id'],
            'position_id' => ['required', 'exists:election_positions,id'],
            'partylist_id' => ['nullable', 'exists:partylists,id'],
            'platform' => ['nullable', 'string'],
            'image' => ['nullable', 'image', 'mimes:jpeg,png,jpg,webp', 'max:2048'],
        ]);

        $candidateUser = User::find($data['user_id']);
        if (!$candidateUser || $candidateUser->role !== 'STUDENT' || $candidateUser->organization_id !== $request->user()->organization_id) {
            return response()->json(['message' => 'Only students can be added as candidates.'], 422);
        }

        $position = ElectionPosition::where('election_id', $election->id)->find($data['position_id']);

        if (!$position) {
            return response()->json(['message' => 'Position does not belong to this election'], 422);
        }

        if (!empty($data['partylist_id']) && !Partylist::where('organization_id', $request->user()->organization_id)->where('id', $data['partylist_id'])->exists()) {
            return response()->json(['message' => 'Selected partylist does not belong to this organization.'], 422);
        }

        $alreadyCandidate = Candidate::where('election_id', $election->id)
            ->where('user_id', $data['user_id'])
            ->exists();

        if ($alreadyCandidate) {
            return response()->json(['message' => 'This student is already assigned as a candidate in this election.'], 422);
        }

        $imageUrl = null;
        if ($request->hasFile('image')) {
            $path = $request->file('image')->store('candidates', 'public');
            $imageUrl = Storage::url($path);
        }

        $candidate = Candidate::create([
            'election_id' => $election->id,
            'user_id' => $data['user_id'],
            'position_id' => $data['position_id'],
            'partylist_id' => $data['partylist_id'] ?? null,
            'platform' => $data['platform'] ?? null,
            'image_url' => $imageUrl,
        ]);

        return response()->json($candidate->load(['user', 'partylist', 'position']), 201);
    }

    public function candidatesUpdate(Request $request, $id, $candidateId)
    {
        $election = Election::where('organization_id', $request->user()->organization_id)->find($id);

        if (!$election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        $candidate = Candidate::where('election_id', $election->id)->find($candidateId);

        if (!$candidate) {
            return response()->json(['message' => 'Candidate not found'], 404);
        }

        $data = $request->validate([
            'user_id' => ['sometimes', 'required', 'exists:users,school_id'],
            'position_id' => ['sometimes', 'required', 'exists:election_positions,id'],
            'partylist_id' => ['nullable', 'exists:partylists,id'],
            'platform' => ['nullable', 'string'],
            'image' => ['nullable', 'image', 'mimes:jpeg,png,jpg,webp', 'max:2048'],
        ]);

        if (array_key_exists('position_id', $data)) {
            $position = ElectionPosition::where('election_id', $candidate->election_id)->find($data['position_id']);

            if (!$position) {
                return response()->json(['message' => 'Position does not belong to this election'], 422);
            }
        }

        if (array_key_exists('user_id', $data)) {
            $candidateUser = User::find($data['user_id']);
            if (!$candidateUser || $candidateUser->role !== 'STUDENT' || $candidateUser->organization_id !== $request->user()->organization_id) {
                return response()->json(['message' => 'Only students can be assigned as candidates.'], 422);
            }

            $alreadyCandidate = Candidate::where('election_id', $candidate->election_id)
                ->where('user_id', $data['user_id'])
                ->where('id', '!=', $candidate->id)
                ->exists();

            if ($alreadyCandidate) {
                return response()->json(['message' => 'This student is already assigned as a candidate in this election.'], 422);
            }
        }

        if (!empty($data['partylist_id']) && !Partylist::where('organization_id', $request->user()->organization_id)->where('id', $data['partylist_id'])->exists()) {
            return response()->json(['message' => 'Selected partylist does not belong to this organization.'], 422);
        }

        if ($request->hasFile('image')) {
            if ($candidate->image_url && str_starts_with($candidate->image_url, '/storage/')) {
                Storage::delete('public/' . ltrim(str_replace('/storage/', '', $candidate->image_url), '/'));
            }
            $path = $request->file('image')->store('candidates', 'public');
            $data['image_url'] = Storage::url($path);
        }
        unset($data['image']);

        $candidate->update($data);

        return response()->json($candidate->fresh()->load(['user', 'partylist', 'position']));
    }

    public function candidatesDestroy(Request $request, $id, $candidateId)
    {
        $election = Election::where('organization_id', $request->user()->organization_id)->find($id);

        if (!$election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        $candidate = Candidate::where('election_id', $election->id)->find($candidateId);

        if (!$candidate) {
            return response()->json(['message' => 'Candidate not found'], 404);
        }

        if ($candidate->votes()->exists()) {
            return response()->json(['message' => 'Cannot delete a candidate that already has votes cast.'], 409);
        }

        $candidate->delete();

        return response()->json(['message' => 'Candidate deleted successfully']);
    }

    public function partylistsIndex(Request $request)
    {
        return response()->json(
            Partylist::withCount('candidates')
                ->where('organization_id', $request->user()->organization_id)
                ->orderBy('name')
                ->get()
        );
    }

    public function partylistsStore(Request $request)
    {
        $data = $request->validate([
            'name' => [
                'required',
                'string',
                'max:255',
                Rule::unique('partylists', 'name')->where(fn ($query) => $query->where('organization_id', $request->user()->organization_id)),
            ],
            'acronym' => ['nullable', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'banner' => ['nullable', 'image', 'mimes:jpeg,png,jpg,webp', 'max:5120'],
        ]);

        $bannerUrl = null;
        if ($request->hasFile('banner')) {
            $bannerUrl = $this->storePartylistBanner($request);
        }

        $partylist = Partylist::create([
            'name' => $data['name'],
            'organization_id' => $request->user()->organization_id,
            'acronym' => $data['acronym'] ?? null,
            'description' => $data['description'] ?? null,
            'banner_url' => $bannerUrl,
        ]);

        return response()->json($partylist, 201);
    }

    public function partylistsUpdate(Request $request, $id)
    {
        $partylist = Partylist::where('organization_id', $request->user()->organization_id)->find($id);

        if (!$partylist) {
            return response()->json(['message' => 'Partylist not found'], 404);
        }

        $data = $request->validate([
            'name' => [
                'sometimes',
                'required',
                'string',
                'max:255',
                Rule::unique('partylists', 'name')
                    ->where(fn ($query) => $query->where('organization_id', $request->user()->organization_id))
                    ->ignore($id),
            ],
            'acronym' => ['nullable', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'banner' => ['nullable', 'image', 'mimes:jpeg,png,jpg,webp', 'max:5120'],
        ]);

        if ($request->hasFile('banner')) {
            $this->deletePartylistBanner($partylist->banner_url);
            $partylist->banner_url = $this->storePartylistBanner($request);
        }

        $partylist->fill([
            'name' => $data['name'] ?? $partylist->name,
            'acronym' => array_key_exists('acronym', $data) ? $data['acronym'] : $partylist->acronym,
            'description' => array_key_exists('description', $data) ? $data['description'] : $partylist->description,
        ])->save();

        return response()->json($partylist->fresh());
    }

    public function partylistsDestroy(Request $request, $id)
    {
        $partylist = Partylist::where('organization_id', $request->user()->organization_id)->find($id);

        if (!$partylist) {
            return response()->json(['message' => 'Partylist not found'], 404);
        }

        if ($partylist->candidates()->exists()) {
            return response()->json(['message' => 'Cannot delete a partylist that has active candidates assigned to it.'], 409);
        }

        $partylist->delete();

        return response()->json(['message' => 'Partylist deleted successfully']);
    }

    public function vote(Request $request, $id)
    {
        $election = Election::where('organization_id', $request->user()->organization_id)->find($id);
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

        if (Vote::where('election_id', $election->id)->where('voter_id', $voter->id)->exists()) {
            return response()->json(['message' => 'You have already voted in this election.'], 422);
        }

        $receipts = [];

        try {
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
        } catch (\Illuminate\Database\UniqueConstraintViolationException $e) {
            return response()->json(['message' => 'You have already voted for one of these positions.'], 422);
        } catch (\Exception $e) {
            if (str_contains($e->getMessage(), 'UNIQUE constraint failed') || str_contains($e->getMessage(), 'Duplicate entry')) {
                return response()->json(['message' => 'You have already voted for one of these positions.'], 422);
            }
            throw $e;
        }

        return response()->json([
            'success' => true,
            'message' => 'Your ballot has been cast successfully!',
            'receipt' => $receipts[0] ?? 'CAST-SUCCESSFUL',
            'receipts' => $receipts,
        ]);
    }

    public function voters(Request $request, $id)
    {
        $election = Election::where('organization_id', $request->user()->organization_id)->find($id);
        if (!$election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        $voterIds = Vote::where('election_id', $id)
            ->distinct()
            ->pluck('voter_id');

        $students = User::where('role', 'STUDENT')
            ->where('organization_id', $request->user()->organization_id)
            ->orderBy('last_name')
            ->orderBy('first_name')
            ->get(['school_id', 'first_name', 'last_name', 'email'])
            ->map(fn($s) => array_merge($s->toArray(), ['has_voted' => $voterIds->contains($s->id)]));

        return response()->json($students);
    }

    public function results(Request $request, $id)
    {
        $election = Election::where('organization_id', $request->user()->organization_id)->find($id);
        if (!$election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        $positions = ElectionPosition::where('election_id', $id)->get();
        $positionIds = $positions->pluck('id');

        $allCandidates = Candidate::with(['user:school_id,first_name,last_name', 'partylist:id,name'])
            ->withCount('votes')
            ->whereIn('position_id', $positionIds)
            ->get()
            ->groupBy('position_id');

        $results = $positions->map(function ($position) use ($allCandidates) {
            $candidates = $allCandidates->get($position->id, collect())
                ->map(fn($c) => [
                    'id'       => $c->id,
                    'name'     => trim(($c->user->first_name ?? '') . ' ' . ($c->user->last_name ?? '')),
                    'partylist' => $c->partylist ? $c->partylist->name : 'Independent',
                    'votes'    => $c->votes_count,
                ])
                ->sortByDesc('votes')
                ->values();

            return [
                'position'   => $position,
                'candidates' => $candidates,
                'totalVotes' => $candidates->sum('votes'),
            ];
        })->values();

        return response()->json($results);
    }
}
