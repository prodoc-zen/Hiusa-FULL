<?php

namespace App\Http\Controllers;

use App\Models\AcademicSemester;
use App\Models\Candidate;
use App\Models\Election;
use App\Models\OfficerAppointment;
use App\Models\User;
use App\Services\ElectionHandoverService;
use App\Services\ElectionResolutionService;
use App\Services\ElectionTallyService;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class ElectionResultsController extends Controller
{
    /** Stored on the position for the reviewer's decision; the results row carries them as `resolution` and `runoff`. */
    private const POSITION_PRIVATE = [
        'runoff_candidate_ids', 'runoff_seats', 'result_status', 'resolved_winner_ids',
        'tie_rule_used', 'tie_explanation', 'tie_resolved_by', 'tie_resolved_at',
    ];

    public function __construct(
        private readonly ElectionTallyService $tally,
        private readonly ElectionResolutionService $resolution,
    ) {}

    public function results(Request $request, $id)
    {
        $user = $request->user();
        $organizationIds = $user->electionOrganizationIds();
        $this->synchronizeScheduledStatuses($organizationIds, (int) $id);
        $election = Election::whereIn('organization_id', $organizationIds)->find($id);
        if (! $election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        if (! in_array($election->status, ['active', 'closed'], true) || ($election->status === 'active' && ! $election->finalized_at)) {
            return response()->json(['message' => 'Results are available after the ballot is finalized and voting opens.'], 403);
        }

        // The reviewer reads a tie waiting for a decision even before the results are published.
        $reviewer = in_array($user->role, ['DEPARTMENT_HEAD', 'SUPER_ADMIN'], true);
        if (! $election->results_visible && $user->role !== 'ADMIN' && ! ($reviewer && $election->phase === 'tie_resolution')) {
            return response()->json(['message' => 'Election results have not been released yet.'], 403);
        }

        $standings = $this->tally->standings($election);
        $allCandidates = Candidate::with(['user:school_id,first_name,last_name', 'partylist:id,name'])
            ->whereIn('position_id', $standings->pluck('position.id'))
            ->get()
            ->groupBy('position_id');
        $totals = $this->tally->totals($election);
        $closed = $election->status === 'closed';
        $legacy = (int) $election->tally_version === 1;

        $handedOver = $election->access_handed_over_at !== null;
        $skippedTitles = $handedOver ? app(ElectionHandoverService::class)->skippedTitles($election) : [];
        $appointments = ! $legacy && $closed
            ? OfficerAppointment::where('election_id', $election->id)->where('kind', 'incoming')->get(['election_position_id', 'status', 'term_starts_on'])
            : collect();
        $resolvers = User::whereIn('school_id', $standings->pluck('position.tie_resolved_by')->filter()->unique())
            ->get(['school_id', 'first_name', 'last_name'])
            ->keyBy('school_id');

        // Runoff votes and runoff winners reach everyone but the Admin and the reviewer only when the runoff is published.
        $hidden = ! $reviewer && $user->role !== 'ADMIN' && $election->runoff_publish_at !== null && now()->lt($election->runoff_publish_at);
        $runoffEnded = $election->runoff_ends_at !== null && $election->runoff_ends_at->lt(now());

        $results = $standings->map(function (array $standing) use ($allCandidates, $totals, $closed, $legacy, $handedOver, $skippedTitles, $appointments, $resolvers, $hidden, $runoffEnded, $election) {
            $position = $standing['position'];
            $runoff = $closed && ! $legacy ? $standing['runoff'] : null;
            $mask = $hidden && $runoff !== null;
            $runoffIds = $runoff['candidate_ids'] ?? [];

            $status = $closed ? $standing['status'] : null;
            if ($mask && in_array($status, ['decided', 'resolved', 'tie_pending'], true)) {
                $status = 'runoff_voting';
            }

            $winners = $closed ? $standing['winners'] : collect();
            if ($mask) {
                $winners = $winners->reject(fn (Candidate $candidate) => in_array((int) $candidate->id, $runoffIds, true));
            }

            $candidates = $allCandidates->get($position->id, collect())
                ->map(function (Candidate $c) use ($totals, $closed, $mask, $runoffEnded, $runoffIds) {
                    $count = $totals[$c->id] ?? ['votes' => 0, 'runoff_votes' => 0];

                    return [
                        'id' => $c->id,
                        'name' => trim(($c->user->first_name ?? '').' '.($c->user->last_name ?? '')),
                        'partylist' => $c->partylist ? $c->partylist->name : 'Independent',
                        'image_url' => $c->image_url,
                        'platform' => $c->platform,
                        'votes' => $closed ? $count['votes'] : null,
                        'runoff_votes' => $closed && ! $mask && $runoffEnded && in_array((int) $c->id, $runoffIds, true) ? $count['runoff_votes'] : null,
                    ];
                })
                ->when($closed, fn (Collection $rows) => $rows->sortByDesc('votes'))
                ->values();

            $resolved = $closed && ! $legacy && ! $mask && $position->resolved_winner_ids !== null;
            $tie = $legacy
                ? $closed && $standing['status'] === 'tie'
                : $closed && in_array($status, ElectionTallyService::UNRESOLVED, true);
            $own = $appointments->where('election_position_id', $position->id);
            $upcoming = $closed && ! $mask ? $own->where('status', 'upcoming')->sortBy('term_starts_on')->first() : null;

            return [
                'position' => $position->makeHidden(self::POSITION_PRIVATE),
                'status' => $status,
                'candidates' => $candidates,
                'totalVotes' => $closed ? $candidates->sum('votes') : null,
                'winner_ids' => $winners->pluck('id')->values(),
                'tie' => $tie,
                'runoff' => $runoff === null ? null : [
                    'candidate_ids' => $runoff['candidate_ids'],
                    'seats' => $runoff['seats'],
                    'starts_at' => $election->runoff_starts_at?->toISOString(),
                    'ends_at' => $election->runoff_ends_at?->toISOString(),
                    'publish_at' => $election->runoff_publish_at?->toISOString(),
                ],
                'resolution' => $resolved ? [
                    'rule_used' => $position->tie_rule_used,
                    'explanation' => $position->tie_explanation,
                    'resolved_by' => ($by = $resolvers->get($position->tie_resolved_by)) ? trim($by->first_name.' '.$by->last_name) : null,
                    'resolved_at' => $position->tie_resolved_at?->toISOString(),
                ] : null,
                'access_handed_over' => $handedOver && $closed && $standing['winners']->isNotEmpty() && ! in_array($position->title, $skippedTitles, true),
                'officer_access' => $own->contains('status', 'active') ? 'active' : ($upcoming ? 'upcoming' : null),
                'term_starts_on' => $upcoming?->term_starts_on?->format('Y-m-d'),
            ];
        })->values();

        return response()->json($results);
    }

    private function synchronizeScheduledStatuses(array $organizationIds, ?int $electionId = null): void
    {
        Election::synchronizeScheduledStatuses($organizationIds, $electionId);
    }

    /** The Admin schedules the one runoff for the positions that need it. It can be changed until it starts. */
    public function runoff(Request $request, $id)
    {
        $user = $request->user();
        $election = Election::where('organization_id', $user->organization_id)->find($id);
        if (! $election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        $data = $request->validate([
            'runoff_starts_at' => ['required', 'date'],
            'runoff_ends_at' => ['required', 'date'],
            'runoff_publish_at' => ['required', 'date'],
        ]);

        $starts = $this->localTime($data['runoff_starts_at']);
        $ends = $this->localTime($data['runoff_ends_at']);
        $publish = $this->localTime($data['runoff_publish_at']);
        $errors = [];

        if ($starts->lte(now())) {
            $errors['runoff_starts_at'] = ['The runoff must start in the future.'];
        }
        if ($ends->lte($starts)) {
            $errors['runoff_ends_at'] = ['The runoff must end after it starts.'];
        }
        if ($publish->lt($ends)) {
            $errors['runoff_publish_at'] = ['Results cannot be published before the runoff ends.'];
        }

        $semester = $election->academic_semester_id ? AcademicSemester::find($election->academic_semester_id) : null;
        if ($semester) {
            $first = Carbon::parse($semester->starts_on->format('Y-m-d'), config('app.timezone'))->startOfDay();
            $last = Carbon::parse($semester->ends_on->format('Y-m-d'), config('app.timezone'))->endOfDay();
            $message = 'The runoff must stay inside the semester of this election.';

            if ($starts->lt($first)) {
                $errors['runoff_starts_at'] ??= [$message];
            }
            if ($ends->gt($last)) {
                $errors['runoff_ends_at'] ??= [$message];
            }
            if ($publish->gt($last)) {
                $errors['runoff_publish_at'] ??= [$message];
            }
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        $refusal = $this->resolution->scheduleRunoff($election, $starts, $ends, $publish, $user, $request->ip());
        if ($refusal !== null) {
            return response()->json(['message' => $refusal], 409);
        }

        $election->refresh();

        return response()->json([
            'success' => true,
            'message' => 'The runoff is scheduled.',
            'runoff_starts_at' => $election->runoff_starts_at?->toISOString(),
            'runoff_ends_at' => $election->runoff_ends_at?->toISOString(),
            'runoff_publish_at' => $election->runoff_publish_at?->toISOString(),
        ]);
    }

    /** The reviewer (the dean, or the SAO for a university-wide organization) settles a tie the runoff did not break. */
    public function resolveTie(Request $request, $id, $position)
    {
        $user = $request->user();
        $election = Election::with('organization:id,college_id,is_university_wide')->find($id);
        $organization = $election?->organization;

        $reviews = $organization
            && $organization->approvalRole(config('approvals.routes.election')) === $user->role
            && ($user->role === 'SUPER_ADMIN' || in_array((int) $election->organization_id, array_map('intval', $user->scopedOrganizationIds()), true));

        if (! $reviews) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        $data = $request->validate([
            'winner_candidate_ids' => ['required', 'array', 'min:1'],
            'winner_candidate_ids.*' => ['integer', 'distinct'],
            'explanation' => ['required', 'string', 'max:2000'],
            'rule_used' => [Rule::requiredIf(blank($election->tie_break_rule)), 'nullable', 'string', 'max:500'],
        ]);

        $this->synchronizeScheduledStatuses([(int) $election->organization_id], (int) $election->id);

        $refusal = $this->resolution->resolveTie(
            $election,
            (int) $position,
            $data['winner_candidate_ids'],
            $data['explanation'],
            $data['rule_used'] ?? null,
            $user,
            $request->ip(),
        );

        if ($refusal !== null) {
            return response()->json(['message' => $refusal], 409);
        }

        return response()->json(['success' => true, 'message' => 'The tie is settled.']);
    }
}
