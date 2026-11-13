<?php

namespace App\Services;

use App\Models\Candidate;
use App\Models\Election;
use App\Models\ElectionPosition;
use App\Models\Vote;
use Illuminate\Support\Collection;

/**
 * Counts an election position by position. Votes are read by candidate and round only, never by voter.
 *
 * Tally version 1 is the reading the earlier elections were closed under (only candidates with votes, a tie at the last
 * seat leaves the tied out). Version 2 follows the approved rules: no candidate is vacant, candidates not more than the
 * seats are elected unopposed, otherwise the top totals win, and a tie at the last seat elects those strictly ahead and
 * sends the tied candidates to the one runoff for the seats that remain.
 */
class ElectionTallyService
{
    /** Statuses of a position that still waits on a runoff or on the reviewer. */
    public const UNRESOLVED = ['runoff_required', 'runoff_scheduled', 'runoff_voting', 'tie_pending'];

    /**
     * Per position: status, seats, candidates ranked by round 1 votes (each with votes and runoff_votes), winners, the
     * candidates still tied, whether the seat was elected unopposed, the seats the tied candidates still compete for
     * (open_seats) and the round 1 tie that sent them to a runoff (runoff: candidate_ids and seats, otherwise null).
     * Version 1 statuses are decided or tie; version 2 statuses are vacant, unopposed, decided, resolved, runoff_required,
     * runoff_scheduled, runoff_voting and tie_pending.
     *
     * @return Collection<int, array{position: ElectionPosition, status: string, seats: int, candidates: Collection, winners: Collection, tied: Collection, unopposed: bool, open_seats: int, runoff: array{candidate_ids: array<int, int>, seats: int}|null}>
     */
    public function standings(Election $election): Collection
    {
        $legacy = (int) $election->tally_version === 1;
        $positions = ElectionPosition::where('election_id', $election->id)
            ->orderBy('id')
            ->get()
            ->when(! $legacy, fn (Collection $rows) => $rows->filter(fn (ElectionPosition $position) => $position->is_active !== false)->values());
        $candidates = Candidate::whereIn('position_id', $positions->pluck('id'))->get()->groupBy('position_id');
        $totals = $this->totals($election);

        return $positions->map(function (ElectionPosition $position) use ($election, $legacy, $candidates, $totals) {
            $own = $candidates->get($position->id, collect())->each(function (Candidate $candidate) use ($totals) {
                $candidate->setAttribute('votes', $totals[$candidate->id]['votes'] ?? 0);
                $candidate->setAttribute('runoff_votes', $totals[$candidate->id]['runoff_votes'] ?? 0);
            });

            return $legacy ? $this->earlierReading($position, $own) : $this->currentReading($election, $position, $own);
        });
    }

    /**
     * Round 1 and round 2 votes per candidate id, counted from the votes table without reading who cast them.
     *
     * @return array<int, array{votes: int, runoff_votes: int}>
     */
    public function totals(Election $election): array
    {
        $totals = [];

        Vote::query()
            ->where('election_id', $election->id)
            ->select('candidate_id', 'round')
            ->selectRaw('count(*) as total')
            ->groupBy('candidate_id', 'round')
            ->get()
            ->each(function ($row) use (&$totals) {
                $key = (int) $row->round === 2 ? 'runoff_votes' : 'votes';
                $totals[(int) $row->candidate_id] ??= ['votes' => 0, 'runoff_votes' => 0];
                $totals[(int) $row->candidate_id][$key] = (int) $row->total;
            });

        return $totals;
    }

    /** The reading elections closed before the full process were counted under. A tie at the last seat leaves the tied out. */
    private function earlierReading(ElectionPosition $position, Collection $candidates): array
    {
        $ranked = $this->rank($candidates, 'votes')->filter(fn (Candidate $candidate) => $candidate->votes > 0)->values();
        $seats = max(1, (int) $position->max_winners);
        $cutoff = $ranked->get($seats - 1)?->votes;
        $beyond = $ranked->get($seats)?->votes;
        $tie = $cutoff !== null && $beyond !== null && $beyond === $cutoff;

        return $this->row(
            $position,
            $tie ? 'tie' : 'decided',
            $seats,
            $ranked,
            $tie ? $ranked->filter(fn (Candidate $candidate) => $candidate->votes > $cutoff)->values() : $ranked->take($seats)->values(),
            $tie ? $ranked->filter(fn (Candidate $candidate) => $candidate->votes === $cutoff)->values() : collect(),
        );
    }

    private function currentReading(Election $election, ElectionPosition $position, Collection $candidates): array
    {
        $seats = max(1, (int) $position->max_winners);
        $ranked = $this->rank($candidates, 'votes');

        if ($ranked->isEmpty()) {
            return $this->row($position, 'vacant', $seats, $ranked, collect(), collect());
        }

        if ($ranked->count() <= $seats) {
            return $this->row($position, 'unopposed', $seats, $ranked, $ranked, collect(), unopposed: true);
        }

        $cutoff = $ranked->get($seats - 1)->votes;

        if ($ranked->get($seats)->votes !== $cutoff) {
            return $this->row($position, 'decided', $seats, $ranked, $ranked->take($seats)->values(), collect());
        }

        $ahead = $ranked->filter(fn (Candidate $candidate) => $candidate->votes > $cutoff)->values();
        $tied = $ranked->filter(fn (Candidate $candidate) => $candidate->votes === $cutoff)->values();
        $remaining = $seats - $ahead->count();
        $runoff = ['candidate_ids' => $tied->pluck('id')->map(fn ($id) => (int) $id)->all(), 'seats' => $remaining];
        $make = fn (string $status, Collection $winners, Collection $stillTied, int $open) => $this->row($position, $status, $seats, $ranked, $winners, $stillTied, open: $open, runoff: $runoff);
        $now = now();

        $resolved = collect($position->resolved_winner_ids ?? [])->map(fn ($id) => (int) $id);
        if ($resolved->isNotEmpty()) {
            return $make('resolved', $ahead->concat($tied->filter(fn (Candidate $candidate) => $resolved->contains((int) $candidate->id)))->values(), collect(), 0);
        }

        if ($election->runoff_ends_at !== null && $election->runoff_ends_at->lt($now)) {
            $second = $tied->sort(fn (Candidate $a, Candidate $b) => [$b->runoff_votes, $a->id] <=> [$a->runoff_votes, $b->id])->values();
            $secondCutoff = $second->get($remaining - 1)->runoff_votes;

            if ($second->get($remaining)->runoff_votes !== $secondCutoff) {
                return $make('decided', $ahead->concat($second->take($remaining))->values(), collect(), 0);
            }

            $aheadAgain = $second->filter(fn (Candidate $candidate) => $candidate->runoff_votes > $secondCutoff)->values();

            return $make(
                'tie_pending',
                $ahead->concat($aheadAgain)->values(),
                $second->filter(fn (Candidate $candidate) => $candidate->runoff_votes === $secondCutoff)->values(),
                $remaining - $aheadAgain->count(),
            );
        }

        if ($election->runoff_starts_at !== null) {
            return $make($election->runoff_starts_at->gt($now) ? 'runoff_scheduled' : 'runoff_voting', $ahead, $tied, $remaining);
        }

        return $make('runoff_required', $ahead, $tied, $remaining);
    }

    private function row(ElectionPosition $position, string $status, int $seats, Collection $candidates, Collection $winners, Collection $tied, bool $unopposed = false, int $open = 0, ?array $runoff = null): array
    {
        return [
            'position' => $position,
            'status' => $status,
            'seats' => $seats,
            'candidates' => $candidates,
            'winners' => $winners,
            'tied' => $tied,
            'unopposed' => $unopposed,
            'open_seats' => $open,
            'runoff' => $runoff,
        ];
    }

    /** Most votes first; equal totals keep the order the candidates were listed in. */
    private function rank(Collection $candidates, string $by): Collection
    {
        return $candidates->sort(fn (Candidate $a, Candidate $b) => [$b->{$by}, $a->id] <=> [$a->{$by}, $b->id])->values();
    }
}
