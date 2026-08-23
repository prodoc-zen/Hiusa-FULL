<?php

namespace App\Http\Controllers;

use App\Models\ApprovalRequest;
use App\Models\AuditLog;
use App\Models\Candidate;
use App\Models\Election;
use App\Models\ElectionPosition;
use App\Models\Partylist;
use App\Models\User;
use App\Models\Vote;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
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
        $filename = Str::uuid()->toString().'.'.$ext;
        $destDir = public_path('uploads/partylists');

        if (! is_dir($destDir)) {
            mkdir($destDir, 0755, true);
        }

        $file->move($destDir, $filename);

        return '/uploads/partylists/'.$filename;
    }

    private function deletePartylistBanner(?string $bannerUrl): void
    {
        if (! $bannerUrl) {
            return;
        }

        if (str_starts_with($bannerUrl, '/storage/')) {
            Storage::delete('public/'.ltrim(str_replace('/storage/', '', $bannerUrl), '/'));

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
        $this->synchronizeScheduledStatuses($request->user()->organization_id);

        $query = Election::withCount(['votes', 'positions', 'candidates'])
            ->where('organization_id', $request->user()->organization_id);

        if ($request->user()?->role === 'STUDENT') {
            $query->where(function ($studentQuery) {
                $studentQuery
                    ->where('status', 'active')
                    ->orWhere(function ($resultsQuery) {
                        $resultsQuery
                            ->where('status', 'closed')
                            ->where('results_visible', true);
                    });
            });
        }

        $elections = $query
            ->orderBy('created_at', 'desc')
            ->get();

        return response()->json($elections);
    }

    public function show(Request $request, $id)
    {
        $user = $request->user();
        $this->synchronizeScheduledStatuses($user->organization_id, $id);
        $with = [
            'positions.candidates.user',
            'positions.candidates.partylist',
            'positions.candidates.position',
            'candidates.user',
            'candidates.partylist',
            'candidates.position',
        ];

        $election = Election::with($with)
            ->where('organization_id', $user->organization_id)
            ->find($id);

        if (! $election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        if ($user?->role === 'STUDENT') {
            if ($election->status !== 'active' && ! ($election->status === 'closed' && $election->results_visible)) {
                return response()->json(['message' => 'Students can only access active elections or visible election results.'], 403);
            }

            // Only return this student's own votes (never expose other voters' identities)
            $myVotes = Vote::where('election_id', $id)
                ->where('voter_id', $user->id)
                ->get(['id', 'position_id', 'candidate_id', 'vote_hash', 'voter_id']);

            $data = $election->toArray();
            $data['my_votes'] = $myVotes;
            $data['vote_counts'] = Vote::where('election_id', $id)
                ->selectRaw('candidate_id, COUNT(*) as vote_count')
                ->groupBy('candidate_id')
                ->pluck('vote_count', 'candidate_id');
            $data['voters_count'] = Vote::where('election_id', $id)
                ->distinct('voter_id')
                ->count('voter_id');

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
            'status' => ['nullable', 'in:upcoming,active,closed,pending_approval'],
            'results_visible' => ['boolean'],
            'positions' => ['sometimes', 'array', 'min:1', 'max:30'],
            'positions.*.title' => ['required', 'string', 'max:100', 'distinct:ignore_case'],
            'positions.*.max_winners' => ['required', 'integer', 'min:1', 'max:20'],
        ]);

        $election = DB::transaction(function () use ($data, $request) {
            $election = Election::create([
                'title' => trim($data['title']),
                'start_time' => $data['start_time'],
                'end_time' => $data['end_time'],
                'status' => 'pending_approval',
                'results_visible' => $data['results_visible'] ?? true,
                'organization_id' => $request->user()->organization_id,
            ]);

            foreach ($data['positions'] ?? [] as $position) {
                $election->positions()->create([
                    'title' => trim($position['title']),
                    'max_winners' => $position['max_winners'],
                ]);
            }

            ApprovalRequest::create([
                'organization_id' => $request->user()->organization_id,
                'entity_type' => 'election',
                'entity_id' => $election->id,
                'requested_by' => $request->user()->id,
                'required_role' => 'DEPARTMENT_HEAD',
            ]);

            return $election;
        });

        $election->load('positions');
        $this->recordElectionAudit(
            $request,
            'created',
            Election::class,
            $election->id,
            null,
            $this->auditableElectionValues($election)
        );

        return response()->json($election, 201);
    }

    public function update(Request $request, $id)
    {
        $election = Election::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        $data = $request->validate([
            'title' => ['sometimes', 'required', 'string', 'max:255'],
            'start_time' => ['sometimes', 'required', 'date'],
            'end_time' => ['sometimes', 'required', 'date'],
            'status' => ['sometimes', 'required', 'in:upcoming,active,closed,pending_approval'],
            'results_visible' => ['boolean'],
        ]);
        $requestedFields = array_keys($data);
        $oldValues = $this->auditableElectionValues($election);

        $endTime = isset($data['end_time']) ? \Carbon\Carbon::parse($data['end_time']) : $election->end_time;
        $startTime = isset($data['start_time']) ? \Carbon\Carbon::parse($data['start_time']) : $election->start_time;
        if ($endTime->lte($startTime)) {
            return response()->json(['message' => 'End time must be after start time.'], 422);
        }

        if (($data['status'] ?? null) === 'active' && ! $election->approved_at) {
            return response()->json(['message' => 'Election must be approved before it can be opened.'], 422);
        }

        if (($data['status'] ?? null) === 'closed' && ! $election->approved_at) {
            return response()->json(['message' => 'Only an approved election can be closed.'], 422);
        }

        if (($data['status'] ?? null) === 'active') {
            $periodMessage = $this->votingPeriodStatusMessage($election, $startTime, $endTime);
            if ($periodMessage) {
                return response()->json(['message' => $periodMessage], 422);
            }
        }

        if (! empty($data['status']) && ! $this->validElectionStatusTransition($election->status, $data['status'])) {
            return response()->json(['message' => "Election status cannot change from {$election->status} to {$data['status']}."], 422);
        }

        if ($election->votes()->exists() && count(array_intersect(array_keys($data), ['title', 'start_time', 'end_time'])) > 0) {
            return response()->json(['message' => 'Election details cannot be changed after votes have been cast.'], 409);
        }

        if ($election->approved_at && $this->hasMaterialElectionChange($data)) {
            $data['status'] = 'pending_approval';
            $data['approved_at'] = null;
            $this->reopenApproval($election, $request);
        }

        $election->update($data);

        ApprovalRequest::where('entity_type', 'election')
            ->where('entity_id', $election->id)
            ->where('status', 'rejected')
            ->where('organization_id', $election->organization_id)
            ->get()
            ->each(fn (ApprovalRequest $approval) => $approval->resubmit());

        $freshElection = $election->fresh();
        $this->recordElectionAudit(
            $request,
            $requestedFields === ['status'] ? 'status_changed' : 'updated',
            Election::class,
            $election->id,
            $oldValues,
            $this->auditableElectionValues($freshElection)
        );

        return response()->json($freshElection);
    }

    private function hasMaterialElectionChange(array $data): bool
    {
        return count(array_intersect(array_keys($data), [
            'title',
            'start_time',
            'end_time',
        ])) > 0;
    }

    private function validElectionStatusTransition(string $currentStatus, string $nextStatus): bool
    {
        $allowed = [
            'pending_approval' => ['pending_approval'],
            'upcoming' => ['upcoming', 'active', 'closed'],
            'active' => ['active', 'closed'],
            'closed' => ['closed', 'active'],
        ];

        return in_array($nextStatus, $allowed[$currentStatus] ?? [], true);
    }

    private function reopenApproval(Election $election, Request $request): void
    {
        ApprovalRequest::where('entity_type', 'election')
            ->where('entity_id', $election->id)
            ->where('organization_id', $election->organization_id)
            ->latest('id')
            ->first()
            ?->reopen($request->user()->id, 'DEPARTMENT_HEAD');
    }

    private function ballotIsLockedResponse(Election $election)
    {
        if (! $election->votes()->exists()) {
            return null;
        }

        return response()->json([
            'message' => 'Ballot setup cannot be changed after votes have been cast.',
        ], 409);
    }

    private function votingPeriodStatusMessage(Election $election, $startTime = null, $endTime = null): ?string
    {
        $start = $startTime ? Carbon::parse($startTime) : $election->start_time;
        $end = $endTime ? Carbon::parse($endTime) : $election->end_time;
        $now = now();

        if ($end->lte($start)) {
            return 'End time must be after start time.';
        }

        if ($now->lt($start)) {
            return 'Voting period has not started yet. Voting opens '.$start->toDayDateTimeString().'.';
        }

        if ($now->gt($end)) {
            return 'Voting period has already ended. Update the end time before reopening this election.';
        }

        return null;
    }

    private function synchronizeScheduledStatuses(int $organizationId, ?int $electionId = null): void
    {
        $now = now();
        $baseQuery = fn () => Election::query()
            ->where('organization_id', $organizationId)
            ->whereNotNull('approved_at')
            ->when($electionId, fn ($query) => $query->whereKey($electionId));

        // Keep the persisted workflow status aligned with the approved voting
        // schedule. Closed elections remain closed so an administrator can
        // still end voting early without the scheduler reopening them.
        $baseQuery()
            ->where('status', 'upcoming')
            ->where('end_time', '<', $now)
            ->update(['status' => 'closed']);

        $baseQuery()
            ->where('status', 'upcoming')
            ->where('start_time', '<=', $now)
            ->where('end_time', '>=', $now)
            ->update(['status' => 'active']);

        $baseQuery()
            ->where('status', 'active')
            ->where('end_time', '<', $now)
            ->update(['status' => 'closed']);
    }

    public function destroy(Request $request, $id)
    {
        $election = Election::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        if ($election->votes()->exists() && ! $request->boolean('confirmed')) {
            return response()->json([
                'message' => 'This election already has cast votes. Confirm deletion to permanently remove the election and all associated votes.',
            ], 409);
        }

        $oldValues = $this->auditableElectionValues($election);
        $electionId = $election->id;

        ApprovalRequest::where('organization_id', $election->organization_id)
            ->where('entity_type', 'election')
            ->where('entity_id', $election->id)
            ->delete();

        $election->delete();
        $this->recordElectionAudit($request, 'deleted', Election::class, $electionId, $oldValues, null);

        return response()->json(['message' => 'Election deleted successfully']);
    }

    public function positionsIndex(Request $request, $id)
    {
        $election = Election::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        return response()->json($election->positions()->withCount('candidates')->orderBy('id')->get());
    }

    public function positionsStore(Request $request, $id)
    {
        $election = Election::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        if ($locked = $this->ballotIsLockedResponse($election)) {
            return $locked;
        }

        $data = $request->validate([
            'title' => [
                'required',
                'string',
                'max:100',
                Rule::unique('election_positions', 'title')->where(fn ($query) => $query->where('election_id', $election->id)),
            ],
            'max_winners' => ['nullable', 'integer', 'min:1', 'max:20'],
        ]);

        try {
            $position = $election->positions()->create([
                'title' => trim($data['title']),
                'max_winners' => $data['max_winners'] ?? 1,
            ]);
        } catch (UniqueConstraintViolationException) {
            return response()->json(['message' => 'This position already exists in the election.'], 422);
        }

        $this->recordElectionAudit(
            $request,
            'position_added',
            ElectionPosition::class,
            $position->id,
            null,
            $this->auditablePositionValues($position)
        );

        return response()->json($position, 201);
    }

    public function positionsUpdate(Request $request, $id, $positionId)
    {
        $election = Election::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        $position = ElectionPosition::where('election_id', $election->id)->find($positionId);

        if (! $position) {
            return response()->json(['message' => 'Position not found'], 404);
        }

        if ($locked = $this->ballotIsLockedResponse($election)) {
            return $locked;
        }

        $oldValues = $this->auditablePositionValues($position);

        $data = $request->validate([
            'title' => [
                'sometimes',
                'required',
                'string',
                'max:100',
                Rule::unique('election_positions', 'title')
                    ->where(fn ($query) => $query->where('election_id', $election->id))
                    ->ignore($position->id),
            ],
            'max_winners' => ['sometimes', 'required', 'integer', 'min:1', 'max:20'],
        ]);

        if (isset($data['title'])) {
            $data['title'] = trim($data['title']);
        }

        $position->update($data);

        $freshPosition = $position->fresh();
        $this->recordElectionAudit(
            $request,
            'position_updated',
            ElectionPosition::class,
            $position->id,
            $oldValues,
            $this->auditablePositionValues($freshPosition)
        );

        return response()->json($freshPosition);
    }

    public function positionsDestroy(Request $request, $id, $positionId)
    {
        $election = Election::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        $position = ElectionPosition::where('election_id', $election->id)->find($positionId);

        if (! $position) {
            return response()->json(['message' => 'Position not found'], 404);
        }

        if ($locked = $this->ballotIsLockedResponse($election)) {
            return $locked;
        }

        if ($position->votes()->exists()) {
            return response()->json(['message' => 'Cannot delete a position that already has votes cast.'], 409);
        }

        $oldValues = $this->auditablePositionValues($position);
        $position->delete();
        $this->recordElectionAudit($request, 'position_removed', ElectionPosition::class, $position->id, $oldValues, null);

        return response()->json(['message' => 'Position deleted successfully']);
    }

    public function candidatesIndex(Request $request, $id)
    {
        $election = Election::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $election) {
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

        if (! $election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        if ($locked = $this->ballotIsLockedResponse($election)) {
            return $locked;
        }

        $data = $request->validate([
            'user_id' => ['required', 'exists:users,school_id'],
            'position_id' => ['required', 'exists:election_positions,id'],
            'partylist_id' => ['nullable', 'exists:partylists,id'],
            'platform' => ['nullable', 'string', 'max:2000'],
            'image' => ['nullable', 'image', 'mimes:jpeg,png,jpg,webp', 'max:2048'],
        ]);

        $candidateUser = User::find($data['user_id']);
        if (! $candidateUser || $candidateUser->role !== 'STUDENT' || $candidateUser->organization_id !== $request->user()->organization_id) {
            return response()->json(['message' => 'Only students can be added as candidates.'], 422);
        }

        $position = ElectionPosition::where('election_id', $election->id)->find($data['position_id']);

        if (! $position) {
            return response()->json(['message' => 'Position does not belong to this election'], 422);
        }

        if (! empty($data['partylist_id']) && ! Partylist::where('organization_id', $request->user()->organization_id)->where('id', $data['partylist_id'])->exists()) {
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

        try {
            $candidate = Candidate::create([
                'election_id' => $election->id,
                'user_id' => $data['user_id'],
                'position_id' => $data['position_id'],
                'partylist_id' => $data['partylist_id'] ?? null,
                'platform' => $data['platform'] ?? null,
                'image_url' => $imageUrl,
            ]);
        } catch (UniqueConstraintViolationException) {
            if ($imageUrl && str_starts_with($imageUrl, '/storage/')) {
                Storage::delete('public/'.ltrim(str_replace('/storage/', '', $imageUrl), '/'));
            }

            return response()->json(['message' => 'This student is already assigned as a candidate in this election.'], 422);
        }

        $candidate->load(['user', 'partylist', 'position']);
        $this->recordElectionAudit(
            $request,
            'candidate_added',
            Candidate::class,
            $candidate->id,
            null,
            $this->auditableCandidateValues($candidate)
        );

        return response()->json($candidate, 201);
    }

    public function candidatesUpdate(Request $request, $id, $candidateId)
    {
        $election = Election::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        $candidate = Candidate::where('election_id', $election->id)->find($candidateId);

        if (! $candidate) {
            return response()->json(['message' => 'Candidate not found'], 404);
        }

        if ($locked = $this->ballotIsLockedResponse($election)) {
            return $locked;
        }

        $oldValues = $this->auditableCandidateValues($candidate);

        $data = $request->validate([
            'user_id' => ['sometimes', 'required', 'exists:users,school_id'],
            'position_id' => ['sometimes', 'required', 'exists:election_positions,id'],
            'partylist_id' => ['nullable', 'exists:partylists,id'],
            'platform' => ['nullable', 'string', 'max:2000'],
            'image' => ['nullable', 'image', 'mimes:jpeg,png,jpg,webp', 'max:2048'],
        ]);

        if (array_key_exists('position_id', $data)) {
            $position = ElectionPosition::where('election_id', $candidate->election_id)->find($data['position_id']);

            if (! $position) {
                return response()->json(['message' => 'Position does not belong to this election'], 422);
            }
        }

        if (array_key_exists('user_id', $data)) {
            $candidateUser = User::find($data['user_id']);
            if (! $candidateUser || $candidateUser->role !== 'STUDENT' || $candidateUser->organization_id !== $request->user()->organization_id) {
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

        if (! empty($data['partylist_id']) && ! Partylist::where('organization_id', $request->user()->organization_id)->where('id', $data['partylist_id'])->exists()) {
            return response()->json(['message' => 'Selected partylist does not belong to this organization.'], 422);
        }

        $oldImageUrl = $candidate->image_url;
        $newImageUrl = null;
        if ($request->hasFile('image')) {
            $path = $request->file('image')->store('candidates', 'public');
            $newImageUrl = Storage::url($path);
            $data['image_url'] = $newImageUrl;
        }
        unset($data['image']);

        try {
            $candidate->update($data);
        } catch (UniqueConstraintViolationException) {
            if ($newImageUrl) {
                Storage::delete('public/'.ltrim(str_replace('/storage/', '', $newImageUrl), '/'));
            }

            return response()->json(['message' => 'This student is already assigned as a candidate in this election.'], 422);
        }

        if ($newImageUrl && $oldImageUrl && str_starts_with($oldImageUrl, '/storage/')) {
            Storage::delete('public/'.ltrim(str_replace('/storage/', '', $oldImageUrl), '/'));
        }

        $freshCandidate = $candidate->fresh()->load(['user', 'partylist', 'position']);
        $this->recordElectionAudit(
            $request,
            'candidate_updated',
            Candidate::class,
            $candidate->id,
            $oldValues,
            $this->auditableCandidateValues($freshCandidate)
        );

        return response()->json($freshCandidate);
    }

    public function candidatesDestroy(Request $request, $id, $candidateId)
    {
        $election = Election::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        $candidate = Candidate::where('election_id', $election->id)->find($candidateId);

        if (! $candidate) {
            return response()->json(['message' => 'Candidate not found'], 404);
        }

        if ($locked = $this->ballotIsLockedResponse($election)) {
            return $locked;
        }

        if ($candidate->votes()->exists()) {
            return response()->json(['message' => 'Cannot delete a candidate that already has votes cast.'], 409);
        }

        $oldValues = $this->auditableCandidateValues($candidate);
        $imageUrl = $candidate->image_url;
        $candidate->delete();
        if ($imageUrl && str_starts_with($imageUrl, '/storage/')) {
            Storage::delete('public/'.ltrim(str_replace('/storage/', '', $imageUrl), '/'));
        }
        $this->recordElectionAudit($request, 'candidate_removed', Candidate::class, $candidate->id, $oldValues, null);

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
            'acronym' => ['nullable', 'string', 'max:30'],
            'description' => ['nullable', 'string', 'max:2000'],
            'banner' => ['nullable', 'image', 'mimes:jpeg,png,jpg,webp', 'max:5120'],
        ]);

        $bannerUrl = null;
        if ($request->hasFile('banner')) {
            $bannerUrl = $this->storePartylistBanner($request);
        }

        try {
            $partylist = Partylist::create([
                'name' => $data['name'],
                'organization_id' => $request->user()->organization_id,
                'acronym' => $data['acronym'] ?? null,
                'description' => $data['description'] ?? null,
                'banner_url' => $bannerUrl,
            ]);
        } catch (UniqueConstraintViolationException) {
            $this->deletePartylistBanner($bannerUrl);

            return response()->json(['message' => 'A partylist with this name already exists.'], 422);
        }

        $this->recordElectionAudit(
            $request,
            'partylist_added',
            Partylist::class,
            $partylist->id,
            null,
            $this->auditablePartylistValues($partylist)
        );

        return response()->json($partylist, 201);
    }

    public function partylistsUpdate(Request $request, $id)
    {
        $partylist = Partylist::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $partylist) {
            return response()->json(['message' => 'Partylist not found'], 404);
        }

        $oldValues = $this->auditablePartylistValues($partylist);

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
            'acronym' => ['nullable', 'string', 'max:30'],
            'description' => ['nullable', 'string', 'max:2000'],
            'banner' => ['nullable', 'image', 'mimes:jpeg,png,jpg,webp', 'max:5120'],
        ]);

        $oldBannerUrl = $partylist->banner_url;
        $newBannerUrl = $request->hasFile('banner') ? $this->storePartylistBanner($request) : null;
        if ($newBannerUrl) {
            $partylist->banner_url = $newBannerUrl;
        }

        try {
            $partylist->fill([
                'name' => $data['name'] ?? $partylist->name,
                'acronym' => array_key_exists('acronym', $data) ? $data['acronym'] : $partylist->acronym,
                'description' => array_key_exists('description', $data) ? $data['description'] : $partylist->description,
            ])->save();
        } catch (UniqueConstraintViolationException) {
            $this->deletePartylistBanner($newBannerUrl);

            return response()->json(['message' => 'A partylist with this name already exists.'], 422);
        }

        if ($newBannerUrl) {
            $this->deletePartylistBanner($oldBannerUrl);
        }

        $freshPartylist = $partylist->fresh();
        $this->recordElectionAudit(
            $request,
            'partylist_updated',
            Partylist::class,
            $partylist->id,
            $oldValues,
            $this->auditablePartylistValues($freshPartylist)
        );

        return response()->json($freshPartylist);
    }

    public function partylistsDestroy(Request $request, $id)
    {
        $partylist = Partylist::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $partylist) {
            return response()->json(['message' => 'Partylist not found'], 404);
        }

        if ($partylist->candidates()->exists()) {
            return response()->json(['message' => 'Cannot delete a partylist that has active candidates assigned to it.'], 409);
        }

        $oldValues = $this->auditablePartylistValues($partylist);
        $bannerUrl = $partylist->banner_url;
        $partylist->delete();
        $this->deletePartylistBanner($bannerUrl);
        $this->recordElectionAudit($request, 'partylist_removed', Partylist::class, $partylist->id, $oldValues, null);

        return response()->json(['message' => 'Partylist deleted successfully']);
    }

    public function vote(Request $request, $id)
    {
        $this->synchronizeScheduledStatuses($request->user()->organization_id, (int) $id);
        $election = Election::where('organization_id', $request->user()->organization_id)->find($id);
        if (! $election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        if ($election->status !== 'active') {
            return response()->json(['message' => 'This election is not currently accepting votes'], 400);
        }

        if ($periodMessage = $this->votingPeriodStatusMessage($election)) {
            return response()->json(['message' => $periodMessage], 422);
        }

        $request->validate([
            'votes' => 'required|array|min:1',
            'votes.*.position_id' => 'required|distinct|exists:election_positions,id',
            'votes.*.candidate_id' => 'required|distinct|exists:candidates,id',
        ]);

        $expectedPositionIds = ElectionPosition::where('election_id', $election->id)
            ->whereHas('candidates')
            ->pluck('id')
            ->sort()
            ->values();
        $submittedPositionIds = collect($request->votes)
            ->pluck('position_id')
            ->map(fn ($value) => (int) $value)
            ->sort()
            ->values();

        if ($expectedPositionIds->isEmpty()) {
            return response()->json(['message' => 'This election does not have a complete official ballot yet.'], 422);
        }

        if ($submittedPositionIds->all() !== $expectedPositionIds->all()) {
            return response()->json(['message' => 'Please select one candidate for every position on the official ballot.'], 422);
        }

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

                    if (! $candidate) {
                        throw ValidationException::withMessages([
                            'votes' => ['Invalid candidate selection for the specified position.'],
                        ]);
                    }

                    // Check if user has already voted for this specific position (secondary safety check)
                    $hasVotedPosition = Vote::where('election_id', $election->id)
                        ->where('position_id', $voteData['position_id'])
                        ->where('voter_id', $voter->id)
                        ->exists();

                    if ($hasVotedPosition) {
                        throw ValidationException::withMessages([
                            'votes' => ['Multiple votes for a single position are not permitted.'],
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
        } catch (UniqueConstraintViolationException $e) {
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
        if (! $election) {
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
            ->map(fn ($s) => array_merge($s->toArray(), ['has_voted' => $voterIds->contains($s->id)]));

        return response()->json($students);
    }

    public function results(Request $request, $id)
    {
        $this->synchronizeScheduledStatuses($request->user()->organization_id, (int) $id);
        $election = Election::where('organization_id', $request->user()->organization_id)->find($id);
        if (! $election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        if ($election->status !== 'closed') {
            return response()->json(['message' => 'Election results are available after the election closes and results are released.'], 403);
        }

        if (! $election->results_visible && $request->user()->role !== 'ADMIN') {
            return response()->json(['message' => 'Election results have not been released yet.'], 403);
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
                ->map(fn ($c) => [
                    'id' => $c->id,
                    'name' => trim(($c->user->first_name ?? '').' '.($c->user->last_name ?? '')),
                    'partylist' => $c->partylist ? $c->partylist->name : 'Independent',
                    'votes' => $c->votes_count,
                ])
                ->sortByDesc('votes')
                ->values();

            return [
                'position' => $position,
                'candidates' => $candidates,
                'totalVotes' => $candidates->sum('votes'),
            ];
        })->values();

        return response()->json($results);
    }

    private function auditableCandidateValues(Candidate $candidate): array
    {
        return [
            'id' => $candidate->id,
            'election_id' => $candidate->election_id,
            'user_id' => $candidate->user_id,
            'position_id' => $candidate->position_id,
            'partylist_id' => $candidate->partylist_id,
            'platform' => $candidate->platform,
            'image_url' => $candidate->image_url,
        ];
    }

    private function auditableElectionValues(Election $election): array
    {
        return [
            'id' => $election->id,
            'organization_id' => $election->organization_id,
            'title' => $election->title,
            'start_time' => $election->start_time?->toISOString(),
            'end_time' => $election->end_time?->toISOString(),
            'status' => $election->status,
            'results_visible' => (bool) $election->results_visible,
            'approved_at' => $election->approved_at?->toISOString(),
        ];
    }

    private function auditablePositionValues(ElectionPosition $position): array
    {
        return [
            'id' => $position->id,
            'election_id' => $position->election_id,
            'title' => $position->title,
            'max_winners' => $position->max_winners,
        ];
    }

    private function auditablePartylistValues(Partylist $partylist): array
    {
        return [
            'id' => $partylist->id,
            'organization_id' => $partylist->organization_id,
            'name' => $partylist->name,
            'acronym' => $partylist->acronym,
            'description' => $partylist->description,
            'banner_url' => $partylist->banner_url,
        ];
    }

    private function recordElectionAudit(Request $request, string $action, string $recordType, int|string|null $recordId, ?array $oldValues, ?array $newValues): void
    {
        AuditLog::create([
            'organization_id' => $request->user()?->organization_id,
            'user_id' => $request->user()?->school_id,
            'module' => 'elections',
            'action' => $action,
            'record_type' => $recordType,
            'record_id' => $recordId,
            'old_values' => $oldValues,
            'new_values' => $newValues,
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);
    }
}
