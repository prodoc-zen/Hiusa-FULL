<?php

namespace App\Http\Controllers;

use App\Models\AccountProfile;
use App\Models\Candidate;
use App\Models\Election;
use App\Models\ElectionBallot;
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

    /**
     * Casts one secret ballot in the round that is open. Who took part is stored in election_ballots; the choices are
     * stored in votes with no voter id and only the day they were cast, so nothing links a voter to a choice. Any
     * position may be skipped and a whole ballot may be blank.
     */
    public function vote(Request $request, $id)
    {
        $votingOrganizationIds = $request->user()->votingOrganizationIds();
        $this->synchronizeScheduledStatuses($votingOrganizationIds, (int) $id);
        $election = Election::whereIn('organization_id', $votingOrganizationIds)->find($id);
        if (! $election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        $round = $election->openRound();
        if ($round === null) {
            if (! $election->isHalted() && $election->status === 'active' && $election->approved_at && $election->finalized_at
                && $periodMessage = $this->votingPeriodStatusMessage($election)) {
                return response()->json(['message' => $periodMessage], 422);
            }

            return response()->json(['message' => 'This election is not currently accepting votes'], 400);
        }

        if (! $this->onVoterRoll($election, $request->user())) {
            return response()->json(['message' => self::JOINED_AFTER_ROLL], 403);
        }

        $request->validate([
            'selections' => ['present', 'array'],
            'selections.*.position_id' => ['required', 'integer', 'distinct'],
            'selections.*.candidate_ids' => ['present', 'array'],
            'selections.*.candidate_ids.*' => ['integer', 'distinct'],
        ]);

        $voter = $request->user();
        $refusal = $round === 2 ? 'You have already voted in this runoff.' : 'You have already voted in this election.';
        if (ElectionBallot::hasVoted($election->id, $voter->school_id, $round)) {
            return response()->json(['message' => $refusal], 422);
        }

        $choices = $this->validatedChoices($election, $round, $request->input('selections'));

        try {
            $ballot = DB::transaction(function () use ($election, $voter, $round, $choices) {
                $ballot = ElectionBallot::create([
                    'election_id' => $election->id,
                    'round' => $round,
                    'voter_id' => $voter->school_id,
                    'receipt_ref' => $this->newReceiptReference(),
                    'submitted_at' => now(),
                ]);

                // Day precision only: a vote cannot be matched to a ballot by the time it was cast.
                $castAt = now()->startOfDay();
                foreach ($choices as $positionId => $candidateIds) {
                    foreach ($candidateIds as $candidateId) {
                        Vote::create([
                            'election_id' => $election->id,
                            'position_id' => $positionId,
                            'candidate_id' => $candidateId,
                            'voter_id' => null,
                            'round' => $round,
                            'vote_hash' => strtoupper(Str::random(12)),
                            'cast_at' => $castAt,
                        ]);
                    }
                }

                return $ballot;
            });
        } catch (UniqueConstraintViolationException $e) {
            if (ElectionBallot::hasVoted($election->id, $voter->school_id, $round)) {
                return response()->json(['message' => $refusal], 422);
            }
            throw $e;
        }

        return response()->json([
            'success' => true,
            'message' => 'Your ballot has been cast successfully!',
            'receipt' => $ballot->receipt_ref,
            'submitted_at' => $ballot->submitted_at,
            'election_title' => $election->title,
            'round' => $round,
        ]);
    }

    /**
     * The chosen candidate ids per position, after every rule of the open round: the position belongs to the election,
     * is active, has candidates (and a runoff in round 2), the choices stay inside the limit and belong to that position.
     *
     * @param  array<int, array{position_id: int|string, candidate_ids: array<int, int|string>}>  $selections
     * @return array<int, array<int, int>> candidate ids keyed by position id; an empty list is a skipped position
     */
    private function validatedChoices(Election $election, int $round, array $selections): array
    {
        $positionIds = collect($selections)->pluck('position_id')->map(fn ($value) => (int) $value)->all();
        $positions = ElectionPosition::where('election_id', $election->id)
            ->whereIn('id', $positionIds)
            ->where('is_active', true)
            ->whereHas('candidates')
            ->get()
            ->keyBy('id');
        if ($positions->count() !== count($positionIds)) {
            throw ValidationException::withMessages(['selections' => ['The ballot lists a position that is not on this election.']]);
        }

        $choices = [];
        foreach ($selections as $selection) {
            $position = $positions[(int) $selection['position_id']];
            $candidateIds = array_map('intval', $selection['candidate_ids']);

            if ($round === 2) {
                $runoffIds = array_map('intval', $position->runoff_candidate_ids ?? []);
                if ($runoffIds === []) {
                    throw ValidationException::withMessages(['selections' => ["{$position->title} is not in the runoff."]]);
                }
                if (array_diff($candidateIds, $runoffIds) !== []) {
                    throw ValidationException::withMessages(['selections' => ["Choose only the candidates in the runoff for {$position->title}."]]);
                }
                $limit = (int) ($position->runoff_seats ?? $position->max_winners);
            } else {
                $limit = min((int) ($position->vote_limit ?? $position->max_winners), (int) $position->max_winners);
            }

            if (count($candidateIds) > $limit) {
                throw ValidationException::withMessages(['selections' => ["Choose at most {$limit} for {$position->title}."]]);
            }

            if ($candidateIds !== [] && Candidate::where('election_id', $election->id)->where('position_id', $position->id)->whereIn('id', $candidateIds)->count() !== count($candidateIds)) {
                throw ValidationException::withMessages(['selections' => ["Invalid candidate selection for {$position->title}."]]);
            }

            $choices[$position->id] = $candidateIds;
        }

        return $choices;
    }

    private function newReceiptReference(): string
    {
        do {
            $reference = strtoupper(Str::random(12));
        } while (ElectionBallot::where('receipt_ref', $reference)->exists());

        return $reference;
    }

    public function voters(Request $request, $id)
    {
        $organizationId = $request->user()->organization_id;
        $election = Election::where('organization_id', $organizationId)->find($id);
        if (! $election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        // Participation lives in election_ballots, never in the choices, so the list can say who voted without a choice.
        $round = (int) $request->query('round') === 2 ? 2 : 1;
        $voterIds = ElectionBallot::where('election_id', $id)
            ->where('round', $round)
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
