<?php

namespace App\Http\Controllers;

use App\Models\Candidate;
use App\Models\Election;
use App\Models\ElectionPosition;
use App\Services\ElectionHandoverService;
use Illuminate\Http\Request;

class ElectionResultsController extends Controller
{
    public function results(Request $request, $id)
    {
        $organizationIds = $request->user()->electionOrganizationIds();
        $this->synchronizeScheduledStatuses($organizationIds, (int) $id);
        $election = Election::whereIn('organization_id', $organizationIds)->find($id);
        if (! $election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        if (! in_array($election->status, ['active', 'closed'], true) || ($election->status === 'active' && ! $election->finalized_at)) {
            return response()->json(['message' => 'Results are available after the ballot is finalized and voting opens.'], 403);
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

        $standings = app(ElectionHandoverService::class)->standings($election)->keyBy(fn (array $row) => $row['position']->id);
        $handedOver = $election->access_handed_over_at !== null;
        $skippedTitles = $handedOver ? app(ElectionHandoverService::class)->skippedTitles($election) : [];

        $closed = $election->status === 'closed';

        $results = $positions->map(function ($position) use ($allCandidates, $standings, $handedOver, $skippedTitles, $closed) {
            $candidates = $allCandidates->get($position->id, collect())
                ->map(fn ($c) => [
                    'id' => $c->id,
                    'name' => trim(($c->user->first_name ?? '').' '.($c->user->last_name ?? '')),
                    'partylist' => $c->partylist ? $c->partylist->name : 'Independent',
                    'image_url' => $c->image_url,
                    'platform' => $c->platform,
                    'votes' => $closed ? $c->votes_count : null,
                ])
                ->when($closed, fn ($rows) => $rows->sortByDesc('votes'))
                ->values();

            $standing = $standings->get($position->id);

            return [
                'position' => $position,
                'candidates' => $candidates,
                'totalVotes' => $closed ? $allCandidates->get($position->id, collect())->sum('votes_count') : null,
                'winner_ids' => $closed && $standing ? $standing['winners']->pluck('id')->values() : [],
                'tie' => $closed && (bool) ($standing['tie'] ?? false),
                'access_handed_over' => $handedOver && $standing && $standing['winners']->isNotEmpty() && ! in_array($position->title, $skippedTitles, true),
            ];
        })->values();

        return response()->json($results);
    }

    private function synchronizeScheduledStatuses(array $organizationIds, ?int $electionId = null): void
    {
        Election::synchronizeScheduledStatuses($organizationIds, $electionId);
    }

    public function runoff(Request $request, $id)
    {
        abort(501);
    }

    public function resolveTie(Request $request, $id, $position)
    {
        abort(501);
    }
}
