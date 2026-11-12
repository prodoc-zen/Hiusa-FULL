<?php

namespace App\Http\Controllers;

use App\Models\AccountProfile;
use App\Models\Candidate;
use App\Models\Election;
use App\Models\ElectionPosition;
use App\Models\User;
use App\Models\Vote;
use App\Support\FullNameSearch;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class ElectionBallotController extends Controller
{
    private const JOINED_AFTER_ROLL = 'You joined after the voter list was finalized, so you cannot vote in this election.';

    private function onVoterRoll(Election $election, User $user): bool
    {
        return $election->listsVoter($user->school_id);
    }

    public function vote(Request $request, $id)
    {
        $votingOrganizationIds = $request->user()->votingOrganizationIds();
        $this->synchronizeScheduledStatuses($votingOrganizationIds, (int) $id);
        $election = Election::whereIn('organization_id', $votingOrganizationIds)->find($id);
        if (! $election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        if ($election->status !== 'active' || ! $election->approved_at || ! $election->finalized_at) {
            return response()->json(['message' => 'This election is not currently accepting votes'], 400);
        }

        if ($periodMessage = $this->votingPeriodStatusMessage($election)) {
            return response()->json(['message' => $periodMessage], 422);
        }

        if (! $this->onVoterRoll($election, $request->user())) {
            return response()->json(['message' => self::JOINED_AFTER_ROLL], 403);
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
        $organizationId = $request->user()->organization_id;
        $election = Election::where('organization_id', $organizationId)->find($id);
        if (! $election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        $voterIds = Vote::where('election_id', $id)
            ->distinct()
            ->pluck('voter_id');

        // Belonging to the organization is an active profile there, as in the people directory; a member the
        // head added keeps their own account in the college and still votes and counts here. The ballot
        // (`vote`) admits exactly this set, through the same scope. Someone who already voted stays on the list
        // after losing voting access (outgoing officers at the handover), so turnout never drops below the ballots.
        $onRoll = AccountProfile::onVoterRoll($election->finalized_at)->where('account_profiles.organization_id', $organizationId)->select('account_profiles.id');
        $votersQuery = AccountProfile::where('account_profiles.organization_id', $organizationId)
            ->where(fn ($profiles) => $profiles->whereIn('account_profiles.id', $onRoll)->orWhereIn('account_profiles.user_school_id', $voterIds));

        $eligibleTotal = (clone $votersQuery)->count();
        $votedCount = (clone $votersQuery)->whereIn('account_profiles.user_school_id', $voterIds)->count();

        $search = trim((string) $request->query('search', ''));
        $vote = $request->query('vote');

        $paginated = $votersQuery
            ->join('users as voter', 'voter.school_id', '=', 'account_profiles.user_school_id')
            ->when($search !== '', fn ($query) => $query->where(function ($matches) use ($search) {
                $matches->where('voter.first_name', 'like', "%{$search}%")
                    ->orWhere('voter.last_name', 'like', "%{$search}%")
                    ->orWhere('voter.school_id', 'like', "%{$search}%");
                FullNameSearch::orWhereMatches($matches, $search, 'voter');
            }))
            ->when($vote === 'voted', fn ($query) => $query->whereIn('voter.school_id', $voterIds))
            ->when($vote === 'not_voted', fn ($query) => $query->whereNotIn('voter.school_id', $voterIds))
            ->orderBy('voter.last_name')
            ->orderBy('voter.first_name')
            ->select(['voter.school_id', 'voter.first_name', 'voter.last_name', 'voter.email', 'account_profiles.role'])
            ->paginate(10)
            ->through(fn ($voter) => array_merge($voter->toArray(), [
                'has_voted' => $voterIds->contains($voter->school_id),
            ]));

        return response()->json(array_merge($paginated->toArray(), [
            'summary' => [
                'eligible_total' => $eligibleTotal,
                'voted_count' => $votedCount,
                'turnout_percent' => $eligibleTotal > 0 ? round(($votedCount / $eligibleTotal) * 100, 1) : 0.0,
            ],
        ]));
    }

    private function votingPeriodStatusMessage(Election $election, $startTime = null, $endTime = null): ?string
    {
        $start = $startTime ? $this->localTime($startTime) : $election->start_time;
        $end = $endTime ? $this->localTime($endTime) : $election->end_time;
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

    private function synchronizeScheduledStatuses(array $organizationIds, ?int $electionId = null): void
    {
        Election::synchronizeScheduledStatuses($organizationIds, $electionId);
    }
}
