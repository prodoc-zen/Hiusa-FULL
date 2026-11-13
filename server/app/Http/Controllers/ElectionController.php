<?php

namespace App\Http\Controllers;

use App\Models\AcademicSemester;
use App\Models\AccountProfile;
use App\Models\ApprovalRequest;
use App\Models\AuditLog;
use App\Models\Candidate;
use App\Models\Election;
use App\Models\ElectionApplication;
use App\Models\ElectionBallot;
use App\Models\ElectionPosition;
use App\Models\Partylist;
use App\Models\User;
use App\Models\Vote;
use App\Services\ElectionHandoverService;
use App\Support\FilterValues;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class ElectionController extends Controller
{
    private const ELECTION_GONE = 'election_gone';

    private const CANDIDATES_FROM_APPLICATIONS = 'Candidates of this election come from approved applications.';

    private const JOINED_AFTER_ROLL = 'You joined after the voter list was finalized, so you cannot vote in this election.';

    /** A draft may be saved with only a title, but the voting window columns are required, so these stand in until the dates are given. */
    private const DRAFT_START = '2000-01-01 00:00:00';

    private const DRAFT_END = '2000-01-01 00:00:01';

    /** The seven schedule steps of a filing election, in order, with the message when a step breaks the order. */
    private const SCHEDULE_ORDER = [
        'filing_ends_at' => ['filing_starts_at', true, 'Filing must close after it opens.'],
        'screening_starts_at' => ['filing_ends_at', false, 'Screening cannot start before filing closes.'],
        'screening_ends_at' => ['screening_starts_at', true, 'Screening must end after it starts.'],
        'campaign_starts_at' => ['screening_ends_at', false, 'The campaign cannot start before screening ends.'],
        'campaign_ends_at' => ['campaign_starts_at', true, 'The campaign must end after it starts.'],
        'start_time' => ['campaign_ends_at', false, 'Voting cannot start before the campaign ends.'],
        'end_time' => ['start_time', true, 'Voting must end after it starts.'],
        'results_publish_at' => ['end_time', false, 'Results cannot be published before voting ends.'],
    ];

    /** Fields that, once changed on an approved filing election, send it back for approval. */
    private const MATERIAL_ELECTION_FIELDS = [
        'filing_starts_at', 'filing_ends_at', 'screening_starts_at', 'screening_ends_at', 'campaign_starts_at',
        'campaign_ends_at', 'start_time', 'end_time', 'results_publish_at', 'rules', 'tie_break_rule', 'min_units', 'min_gpa',
    ];

    private const MATERIAL_POSITION_FIELDS = ['title', 'max_winners', 'description', 'is_executive', 'vote_limit', 'eligible_year_levels', 'other_qualifications', 'is_active'];

    private function storeElectionImage(Request $request): string
    {
        return Storage::url($request->file('image')->store('elections', 'public'));
    }

    private function deleteElectionImage(?string $imageUrl): void
    {
        if ($imageUrl && str_starts_with($imageUrl, '/storage/elections/')) {
            Storage::disk('public')->delete(ltrim(str_replace('/storage/', '', $imageUrl), '/'));
        }
    }

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

    private function memberViewOnly(?User $user): bool
    {
        if ($user?->role === 'STUDENT') {
            return true;
        }

        $profile = $user?->role === 'SBO_OFFICER' ? $user->activeProfile() : null;

        return $profile !== null && ! $profile->allowsModule('elections');
    }

    /** A draft was saved but never submitted: pending approval, no submission time and no approval row. */
    private function isDraft(Election $election): bool
    {
        return $election->status === 'pending_approval'
            && $election->submitted_at === null
            && ! ApprovalRequest::where('entity_type', 'election')->where('entity_id', $election->id)->exists();
    }

    /** Drafts belong to the Admin who is writing them, so the reviewer and members never list them. */
    private function withoutDrafts($query)
    {
        return $query->where(fn ($election) => $election
            ->where('status', '!=', 'pending_approval')
            ->orWhereNotNull('submitted_at')
            ->orWhereExists(fn ($approval) => $approval->select(DB::raw(1))
                ->from('approval_requests')
                ->whereColumn('approval_requests.entity_id', 'elections.id')
                ->where('approval_requests.entity_type', 'election')));
    }

    /** A filing election is shown to members from approval onward, as long as it has a phase and is not cancelled. */
    private function filingVisibleToMembers(Election $election): bool
    {
        return $election->usesFiling()
            && $election->approved_at !== null
            && $election->cancelled_at === null
            && $election->phase !== null
            && $election->status !== 'pending_approval';
    }

    /** A draft keeps stand-in voting dates in the table; the payload reports them as not yet set. */
    private function electionPayload(Election $election): array
    {
        $payload = $election->toArray();
        if ($election->start_time?->format('Y-m-d H:i:s') === self::DRAFT_START) {
            $payload['start_time'] = null;
            $payload['end_time'] = null;
        }

        return $payload;
    }

    /**
     * Every viewer's own ballot state for the round that is open (round 2 only inside a runoff), and the
     * application counts the Admin and officers follow. Only the viewer's own participation is read.
     *
     * @param  Collection<int, Election>  $elections
     * @param  array<int, array>  $payloads
     */
    private function withParticipationFields(Request $request, Collection $elections, array $payloads): array
    {
        $user = $request->user();
        $ballots = ElectionBallot::whereIn('election_id', $elections->pluck('id'))
            ->where('voter_id', $user->school_id)
            ->get()
            ->groupBy('election_id');
        $counts = in_array($user->role, ['ADMIN', 'SBO_OFFICER'], true) ? $this->applicationCounts($elections->pluck('id')->all()) : null;
        $byId = $elections->keyBy('id');

        return array_map(function (array $payload) use ($byId, $ballots, $counts) {
            $election = $byId[$payload['id']];
            $openRound = $election->openRound();
            $round = $openRound === 2 ? 2 : 1;
            $ballot = ($ballots[$election->id] ?? collect())->firstWhere('round', $round);

            $payload['open_round'] = $openRound;
            $payload['has_voted'] = $ballot !== null;
            $payload['my_ballot'] = $ballot ? [
                'receipt_ref' => $ballot->receipt_ref,
                'submitted_at' => $ballot->submitted_at?->toISOString(),
                'round' => $round,
            ] : null;
            if ($counts !== null) {
                $payload['application_counts'] = $counts[$election->id];
            }

            return $payload;
        }, $payloads);
    }

    /** @return array<int, array<string, int>> */
    private function applicationCounts(array $electionIds): array
    {
        $empty = ['pending_review' => 0, 'for_revision' => 0, 'approved' => 0, 'rejected' => 0, 'withdrawn' => 0];
        $counts = array_fill_keys($electionIds, $empty);
        $rows = ElectionApplication::whereIn('election_id', $electionIds)
            ->whereIn('status', array_keys($empty))
            ->selectRaw('election_id, status, COUNT(*) as total')
            ->groupBy('election_id', 'status')
            ->get();
        foreach ($rows as $row) {
            $counts[$row->election_id][$row->status] = (int) $row->total;
        }

        return $counts;
    }

    public function index(Request $request)
    {
        $filters = $request->validate(['academic_semester_id' => ['nullable', FilterValues::rule(['integer', 'exists:academic_semesters,id'])]]);
        $user = $request->user();
        $readableOrgIds = $user->role === 'DEPARTMENT_HEAD' ? $this->readableOrganizationIds($request) : $user->electionOrganizationIds();
        $this->synchronizeScheduledStatuses($readableOrgIds);

        $query = Election::withCount(['votes', 'positions', 'candidates'])
            ->withCount(['ballots as voters_count' => fn ($ballots) => $ballots->where('round', 1)])
            ->with('organization:id,name,acronym')
            ->whereIn('organization_id', $readableOrgIds);
        $selectedSemesterId = $filters['academic_semester_id'] ?? AcademicSemester::selected($request)?->id;
        if ($selectedSemesterId) {
            // An election made before any semester existed belongs to no period, so no period hides it.
            $query->where(fn ($period) => $period->whereIn('academic_semester_id', FilterValues::values($selectedSemesterId))
                ->orWhereNull('academic_semester_id'));
        }

        if ($user->role === 'DEPARTMENT_HEAD') {
            $this->withoutDrafts($query);
        }

        if ($this->memberViewOnly($request->user())) {
            $query->whereNull('cancelled_at')->where(function ($studentQuery) {
                $studentQuery
                    ->where(function ($openQuery) {
                        $openQuery->whereIn('status', ['upcoming', 'active'])->whereNotNull('finalized_at');
                    })
                    ->orWhere(function ($resultsQuery) {
                        $resultsQuery
                            ->whereIn('status', ['active', 'closed'])
                            ->whereNotNull('finalized_at')
                            ->where('results_visible', true);
                    })
                    ->orWhere(function ($filingQuery) {
                        $filingQuery
                            ->whereNotNull('filing_starts_at')
                            ->whereNotNull('approved_at')
                            ->whereNotNull('phase')
                            ->where('status', '!=', 'pending_approval');
                    });
            });
        }

        $elections = $query
            ->orderBy('created_at', 'desc')
            ->get();

        $payloads = $elections->map(fn (Election $election) => $this->electionPayload($election))->all();

        return response()->json($this->withApprovalFields($request, $this->withParticipationFields($request, $elections, $payloads)));
    }

    public function show(Request $request, $id)
    {
        $user = $request->user();
        $organizationIds = $user->electionOrganizationIds();
        $this->synchronizeScheduledStatuses($organizationIds, $id);
        $with = [
            'positions.candidates.user:school_id,first_name,last_name,program,year_level',
            'positions.candidates.partylist',
            'positions.candidates.position',
            'candidates.user:school_id,first_name,last_name,program,year_level',
            'candidates.partylist',
            'candidates.position',
        ];

        $election = Election::with($with)
            ->whereIn('organization_id', $organizationIds)
            ->find($id);

        if (! $election || ($user->role === 'DEPARTMENT_HEAD' && $this->isDraft($election))) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        if ($this->memberViewOnly($user) && ! $this->filingVisibleToMembers($election)) {
            if ($election->cancelled_at || ! $election->finalized_at || ($election->status !== 'active' && ! ($election->status === 'closed' && $election->results_visible))) {
                return response()->json(['message' => 'Students can only access active elections or visible election results.'], 403);
            }
        }

        // Every eligible role receives only its own ballot records. Other voter identities are never exposed by
        // this endpoint. Votes cast under the secret ballot carry no voter id, so only legacy rows can match.
        $myVotes = Vote::where('election_id', $id)
            ->where('voter_id', $user->school_id)
            ->get(['id', 'position_id', 'candidate_id', 'vote_hash', 'voter_id', 'cast_at']);

        [$data] = $this->withParticipationFields($request, collect([$election]), [$this->electionPayload($election)]);
        [$data] = $this->withApprovalFields($request, [$data]);
        $data['my_votes'] = $myVotes;
        if ($election->status === 'closed' && ($election->results_visible || $user->role === 'ADMIN')) {
            // Round 1 only: runoff totals are read through the results endpoint, which holds them back until they are published.
            $data['vote_counts'] = Vote::where('election_id', $id)
                ->where('round', 1)
                ->selectRaw('candidate_id, COUNT(*) as vote_count')
                ->groupBy('candidate_id')
                ->pluck('vote_count', 'candidate_id');
        }
        $data['voters_count'] = ElectionBallot::where('election_id', $id)->where('round', 1)->count();
        $data['ballot_refusal'] = $this->onVoterRoll($election, $user) ? null : self::JOINED_AFTER_ROLL;

        return response()->json($data);
    }

    /** @return array<int, string> the schedule fields in the order they must happen */
    private function scheduleFields(): array
    {
        return ['filing_starts_at', 'filing_ends_at', 'screening_starts_at', 'screening_ends_at', 'campaign_starts_at', 'campaign_ends_at', 'start_time', 'end_time', 'results_publish_at'];
    }

    /** The checks the Admin form and the API share for the new setup fields. */
    private function setupRules(bool $complete, bool $filing): array
    {
        $scheduleRule = $filing && $complete ? ['required', 'date'] : ['nullable', 'date'];

        return [
            'description' => ['nullable', 'string', 'max:5000'],
            'filing_starts_at' => $scheduleRule,
            'filing_ends_at' => $scheduleRule,
            'screening_starts_at' => $scheduleRule,
            'screening_ends_at' => $scheduleRule,
            'campaign_starts_at' => $scheduleRule,
            'campaign_ends_at' => $scheduleRule,
            'results_publish_at' => $scheduleRule,
            'rules' => [$filing && $complete ? 'required' : 'nullable', 'string', 'max:20000'],
            'tie_break_rule' => [$filing && $complete ? 'required' : 'nullable', 'string', 'max:500'],
            'min_units' => ['nullable', 'integer', 'between:0,60'],
            'min_gpa' => ['nullable', 'numeric', 'between:0,5'],
        ];
    }

    /** The checks for the ballot position fields, under a prefix such as `positions.*.` or none. */
    private function positionRules(string $prefix = ''): array
    {
        return [
            $prefix.'description' => ['nullable', 'string', 'max:255'],
            $prefix.'is_executive' => ['sometimes', 'boolean'],
            $prefix.'vote_limit' => ['nullable', 'integer', 'min:1', 'max:20'],
            $prefix.'eligible_year_levels' => ['nullable', 'array', 'max:6'],
            $prefix.'eligible_year_levels.*' => ['integer', 'between:1,6'],
            $prefix.'other_qualifications' => ['nullable', 'string', 'max:500'],
            $prefix.'is_active' => ['sometimes', 'boolean'],
        ];
    }

    /** The position columns a request may set, in the form they are stored. */
    private function positionAttributes(array $position): array
    {
        $attributes = [];
        foreach (['description', 'vote_limit', 'other_qualifications'] as $field) {
            if (array_key_exists($field, $position)) {
                $attributes[$field] = $position[$field];
            }
        }
        foreach (['is_executive', 'is_active'] as $field) {
            if (array_key_exists($field, $position)) {
                $attributes[$field] = (bool) $position[$field];
            }
        }
        if (array_key_exists('eligible_year_levels', $position)) {
            $levels = collect($position['eligible_year_levels'] ?? [])->map(fn ($level) => (int) $level)->unique()->sort()->values()->all();
            $attributes['eligible_year_levels'] = $levels === [] ? null : $levels;
        }

        return $attributes;
    }

    /** A position may let a voter choose up to its seats and no more. */
    private function assertVoteLimit(?int $voteLimit, int $seats, string $key): void
    {
        if ($voteLimit !== null && $voteLimit > $seats) {
            throw ValidationException::withMessages([$key => ['A voter cannot choose more candidates than there are seats ('.$seats.').']]);
        }
    }

    /** Dates arrive as UTC instants; they are kept as Manila wall-clock time like the voting window. */
    private function localSchedule(array $data): array
    {
        foreach ($this->scheduleFields() as $field) {
            if (! empty($data[$field])) {
                $data[$field] = $this->localTime($data[$field]);
            }
        }

        return $data;
    }

    /**
     * Each step of the schedule must come after the one before it. A step that is not set is skipped, so a draft
     * is only checked where both neighbours are filled in.
     *
     * @param  array<string, ?Carbon>  $values
     */
    private function assertScheduleOrder(array $values): void
    {
        foreach (self::SCHEDULE_ORDER as $field => [$previous, $strict, $message]) {
            $current = $values[$field] ?? null;
            $before = $values[$previous] ?? null;
            if ($current === null || $before === null) {
                continue;
            }
            if ($strict ? $current->lte($before) : $current->lt($before)) {
                throw ValidationException::withMessages([$field => [$message]]);
            }
        }
    }

    /** @param  array<string, ?Carbon>  $values */
    private function assertScheduleInsideSemester(array $values, ?AcademicSemester $semester): void
    {
        if (! $semester) {
            return;
        }

        foreach ($this->scheduleFields() as $field) {
            $value = $values[$field] ?? null;
            if ($value === null) {
                continue;
            }
            if ($value->toDateString() < $semester->starts_on->toDateString() || $value->toDateString() > $semester->ends_on->toDateString()) {
                throw ValidationException::withMessages([$field => ['The election schedule must fall within the semester you are working in ('.$semester->starts_on->format('M j, Y').' to '.$semester->ends_on->format('M j, Y').').']]);
            }
        }
    }

    /** One approval request to the reviewer, routed as every election proposal is. */
    private function requestApproval(Election $election, Request $request): ApprovalRequest
    {
        return ApprovalRequest::create([
            'organization_id' => $election->organization_id,
            'entity_type' => 'election',
            'entity_id' => $election->id,
            'requested_by' => $request->user()->id,
            'required_role' => $request->user()->organization->approvalRole(config('approvals.routes.election')),
        ]);
    }

    /** An approved election whose material terms changed goes back to the reviewer and its ballot unlocks. */
    private function reopenApproval(Request $request, Election $election): void
    {
        DB::transaction(function () use ($election, $request) {
            $election->update(['status' => 'pending_approval', 'approved_at' => null, 'finalized_at' => null]);
            $this->requestApproval($election, $request);
        });
        $this->recordElectionAudit($request, 'approval_reopened', Election::class, $election->id, null, $this->auditableElectionValues($election->fresh()));
    }

    /** Voting has opened once the election is open or closed, or its approved window has started. */
    private function votingHasOpened(Election $election): bool
    {
        return in_array($election->status, ['active', 'closed'], true)
            || ($election->approved_at !== null && $election->start_time !== null && $election->start_time->lte(now()));
    }

    /** True when the request really changes a schedule date, the rules, the tie-break rule or a qualification. */
    private function materialChange(Election $election, array $data): bool
    {
        foreach (self::MATERIAL_ELECTION_FIELDS as $field) {
            if (! array_key_exists($field, $data)) {
                continue;
            }
            $new = $data[$field];
            $old = $election->{$field};
            if ($new instanceof Carbon || $old instanceof Carbon) {
                if ($new === null || $old === null || ! Carbon::parse($new)->eq($old)) {
                    return true;
                }
            } elseif ($field === 'min_gpa') {
                if (($new === null) !== ($old === null) || ($new !== null && (float) $new !== (float) $old)) {
                    return true;
                }
            } elseif ((string) ($new ?? '') !== (string) ($old ?? '')) {
                return true;
            }
        }

        return false;
    }

    /**
     * What stops an election from being sent to the reviewer, keyed by the field it belongs to.
     *
     * @return array<string, array<int, string>>
     */
    private function submissionProblems(Election $election): array
    {
        $problems = [];
        $placeholder = $election->start_time?->format('Y-m-d H:i:s') === self::DRAFT_START;

        if ($election->usesFiling()) {
            $values = [];
            foreach ($this->scheduleFields() as $field) {
                $values[$field] = ($field === 'start_time' || $field === 'end_time') && $placeholder ? null : $election->{$field};
                if ($values[$field] === null) {
                    $problems[$field] = ['This date is required.'];
                }
            }
            foreach (['rules' => 'The official rules are required.', 'tie_break_rule' => 'The tie-break rule is required.'] as $field => $message) {
                if (blank($election->{$field})) {
                    $problems[$field] = [$message];
                }
            }
            if ($problems === []) {
                try {
                    $this->assertScheduleOrder($values);
                    $this->assertScheduleInsideSemester($values, $election->academic_semester_id ? AcademicSemester::find($election->academic_semester_id) : null);
                } catch (ValidationException $exception) {
                    $problems += $exception->errors();
                }
            }
        } elseif ($placeholder) {
            $problems['start_time'] = ['Set when voting starts and ends.'];
        } else {
            try {
                $this->assertScheduleInsideSemester(['start_time' => $election->start_time, 'end_time' => $election->end_time], $election->academic_semester_id ? AcademicSemester::find($election->academic_semester_id) : null);
            } catch (ValidationException $exception) {
                $problems += $exception->errors();
            }
        }

        if ($election->academic_semester_id && blank($election->informative_letter_path)) {
            $problems['informative_letter'] = ['The informative letter (PDF) is required.'];
        }
        if (! $election->positions()->where('is_active', true)->exists()) {
            $problems['positions'] = ['Add at least one active position.'];
        }

        return $problems;
    }

    public function store(Request $request)
    {
        $semester = AcademicSemester::selected($request);
        if (AcademicSemester::exists() && ! $semester) {
            return response()->json(['message' => 'SAO must activate an academic semester before new elections can be created.'], 409);
        }
        $draft = $request->boolean('draft');
        $filing = $request->filled('filing_starts_at');
        $complete = ! $draft;
        $data = $request->validate([
            'title' => ['required', 'string', 'max:255'],
            'room' => ['nullable', 'string', 'max:120'],
            'start_time' => $complete ? ['required', 'date'] : ['nullable', 'date'],
            'end_time' => $complete ? ['required', 'date', 'after:start_time'] : ['nullable', 'date'],
            'status' => ['nullable', 'in:upcoming,active,closed,pending_approval'],
            'results_visible' => ['boolean'],
            'image' => ['nullable', 'image', 'mimes:jpeg,png,jpg,webp', 'max:5120'],
            'informative_letter' => [$semester && $complete ? 'required' : 'nullable', 'file', 'mimes:pdf', 'max:10240'],
            'positions' => $filing && $complete ? ['required', 'array', 'min:1', 'max:30'] : ($complete ? ['sometimes', 'array', 'min:1', 'max:30'] : ['sometimes', 'nullable', 'array', 'max:30']),
            'positions.*.title' => ['required', 'string', 'max:100', 'distinct:ignore_case'],
            'positions.*.max_winners' => ['required', 'integer', 'min:1', 'max:20'],
            ...$this->positionRules('positions.*.'),
            ...$this->setupRules($complete, $filing),
        ]);
        foreach ($data['positions'] ?? [] as $index => $position) {
            $this->assertVoteLimit(isset($position['vote_limit']) ? (int) $position['vote_limit'] : null, (int) $position['max_winners'], "positions.{$index}.vote_limit");
        }
        if ($filing && $complete && ! collect($data['positions'] ?? [])->contains(fn ($position) => (bool) ($position['is_active'] ?? true))) {
            throw ValidationException::withMessages(['positions' => ['Add at least one active position.']]);
        }
        // The client sends UTC instants. Stored and compared as Manila wall-clock time, or every
        // window lands 8 hours early and a 9 AM vote opens at 1 AM.
        $data = $this->localSchedule($data);
        if ($filing) {
            $this->assertScheduleOrder($data);
            $this->assertScheduleInsideSemester($data, $semester);
        } elseif (isset($data['start_time'], $data['end_time'])
            && $semester && ($data['start_time']->toDateString() < $semester->starts_on->toDateString()
            || $data['end_time']->toDateString() > $semester->ends_on->toDateString())) {
            throw ValidationException::withMessages(['start_time' => ['The voting period must fall within the semester you are working in ('.$semester->starts_on->format('M j, Y').' to '.$semester->ends_on->format('M j, Y').').']]);
        }

        $imageUrl = $request->hasFile('image') ? $this->storeElectionImage($request) : null;
        $letterPath = $request->hasFile('informative_letter')
            ? $request->file('informative_letter')->store('election-letters/'.$request->user()->organization_id, 'local')
            : null;

        try {
            $election = DB::transaction(function () use ($data, $request, $imageUrl, $letterPath, $semester, $draft, $filing) {
                $election = Election::create([
                    'title' => trim($data['title']),
                    'room' => $data['room'] ?? null,
                    'description' => $data['description'] ?? null,
                    'image_url' => $imageUrl,
                    'informative_letter_path' => $letterPath,
                    'academic_semester_id' => $semester?->id,
                    'start_time' => $data['start_time'] ?? self::DRAFT_START,
                    'end_time' => $data['end_time'] ?? self::DRAFT_END,
                    'filing_starts_at' => $data['filing_starts_at'] ?? null,
                    'filing_ends_at' => $data['filing_ends_at'] ?? null,
                    'screening_starts_at' => $data['screening_starts_at'] ?? null,
                    'screening_ends_at' => $data['screening_ends_at'] ?? null,
                    'campaign_starts_at' => $data['campaign_starts_at'] ?? null,
                    'campaign_ends_at' => $data['campaign_ends_at'] ?? null,
                    'results_publish_at' => $data['results_publish_at'] ?? null,
                    'rules' => isset($data['rules']) ? trim($data['rules']) : null,
                    'tie_break_rule' => isset($data['tie_break_rule']) ? trim($data['tie_break_rule']) : null,
                    'min_units' => $data['min_units'] ?? ($filing ? 10 : null),
                    'min_gpa' => $data['min_gpa'] ?? null,
                    'status' => 'pending_approval',
                    'submitted_at' => $draft ? null : now(),
                    'results_visible' => $filing ? false : ($data['results_visible'] ?? true),
                    'organization_id' => $request->user()->organization_id,
                ]);

                foreach ($data['positions'] ?? [] as $position) {
                    $election->positions()->create([
                        'title' => trim($position['title']),
                        'max_winners' => $position['max_winners'],
                        ...$this->positionAttributes($position),
                    ]);
                }

                if (! $draft) {
                    $this->requestApproval($election, $request);
                }

                return $election;
            });
        } catch (\Throwable $exception) {
            $this->deleteElectionImage($imageUrl);
            if ($letterPath) {
                Storage::disk('local')->delete($letterPath);
            }

            throw $exception;
        }

        $election->load('positions');
        $this->recordElectionAudit(
            $request,
            'created',
            Election::class,
            $election->id,
            null,
            $this->auditableElectionValues($election)
        );

        return response()->json($this->withApprovalFields($request, [$this->electionPayload($election)])[0], 201);
    }

    public function informativeLetter(Request $request, $id)
    {
        $election = Election::whereIn('organization_id', $request->user()->scopedOrganizationIds())->findOrFail($id);
        if (! in_array($request->user()->role, ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD'], true)) {
            abort(403);
        }
        if (! $election->informative_letter_path || ! Storage::disk('local')->exists($election->informative_letter_path)) {
            abort(404);
        }

        $response = response()->file(Storage::disk('local')->path($election->informative_letter_path), [
            'Content-Type' => 'application/pdf',
            'X-Content-Type-Options' => 'nosniff',
        ]);
        $response->setContentDisposition('inline', 'election-informative-letter.pdf');
        $response->setPrivate();
        $response->headers->addCacheControlDirective('no-store');

        return $response;
    }

    public function finalize(Request $request, $id)
    {
        $election = Election::where('organization_id', $request->user()->organization_id)->find($id);
        if (! $election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        if ($election->usesFiling()) {
            return response()->json(['message' => 'The ballot locks by itself when voting opens.'], 409);
        }

        if (! $election->approved_at || $election->status !== 'upcoming') {
            return response()->json(['message' => 'Only an approved election awaiting voting can be finalized.'], 422);
        }

        if ($election->finalized_at) {
            return response()->json(['message' => 'This ballot is already finalized.'], 409);
        }

        $positions = $election->positions()->withCount('candidates')->get();
        if ($positions->isEmpty() || $positions->contains(fn ($position) => $position->candidates_count === 0)) {
            return response()->json(['message' => 'Add at least one candidate to every ballot position before finalizing.'], 422);
        }

        $election->update(['finalized_at' => now()]);
        $this->recordElectionAudit($request, 'ballot_finalized', Election::class, $election->id, null, $this->auditableElectionValues($election));

        return response()->json($election->fresh());
    }

    public function update(Request $request, $id)
    {
        $election = Election::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        if ($election->status === 'closed' && $request->hasAny(['title', 'room', 'start_time', 'end_time', 'image', 'remove_image', ...self::MATERIAL_ELECTION_FIELDS, 'description', 'informative_letter'])) {
            return response()->json(['message' => 'Closed election details cannot be changed.'], 409);
        }

        $draft = $this->isDraft($election);
        $data = $request->validate([
            'title' => ['sometimes', 'required', 'string', 'max:255'],
            'room' => ['nullable', 'string', 'max:120'],
            'start_time' => ['sometimes', 'required', 'date'],
            'end_time' => ['sometimes', 'required', 'date'],
            'status' => ['sometimes', 'required', 'in:upcoming,active,closed,pending_approval'],
            'results_visible' => ['boolean'],
            'image' => ['nullable', 'image', 'mimes:jpeg,png,jpg,webp', 'max:5120'],
            'remove_image' => ['sometimes', 'boolean'],
            'informative_letter' => ['sometimes', 'file', 'mimes:pdf', 'max:10240'],
            'positions' => ['sometimes', 'array', 'max:30'],
            'positions.*.title' => ['required', 'string', 'max:100', 'distinct:ignore_case'],
            'positions.*.max_winners' => ['required', 'integer', 'min:1', 'max:20'],
            ...$this->positionRules('positions.*.'),
            ...array_map(fn (array $rules) => ['sometimes', ...$rules], $this->setupRules(false, false)),
        ]);
        $positions = $data['positions'] ?? null;
        unset($data['positions']);
        foreach ($positions ?? [] as $index => $position) {
            $this->assertVoteLimit(isset($position['vote_limit']) ? (int) $position['vote_limit'] : null, (int) $position['max_winners'], "positions.{$index}.vote_limit");
        }
        // The ballot of an approved election changes only through the positions list, where the ballot locks are checked.
        // A form that sends back the ballot it already has changes nothing and is accepted.
        if ($positions !== null && ($election->approved_at || $election->status !== 'pending_approval')) {
            $ballot = fn ($rows) => collect($rows)->map(fn ($row) => mb_strtolower(trim((string) (is_array($row) ? $row['title'] : $row->title))).'|'.(int) (is_array($row) ? $row['max_winners'] : $row->max_winners))->sort()->values()->all();
            if ($ballot($positions) !== $ballot($election->positions()->get(['title', 'max_winners']))) {
                return response()->json(['message' => 'The positions of an approved election are changed from its positions list.'], 409);
            }
            $positions = null;
        }
        $requestedFields = array_keys($data);
        $oldValues = $this->auditableElectionValues($election);
        $data = $this->localSchedule($data);

        if ($election->cancelled_at && ! empty($data['results_visible'])) {
            return response()->json(['message' => 'A cancelled election never publishes results.'], 409);
        }
        if ($election->usesFiling()) {
            // The phase engine alone publishes, closes and completes a filing election, so the schedule and the
            // audit trail stay true and nobody reads or changes a tally outside them.
            $publishes = array_key_exists('results_visible', $data) && (bool) $data['results_visible'] !== (bool) $election->results_visible;
            $closes = ($data['status'] ?? null) === 'closed' && $election->status !== 'closed';
            $reopens = ($data['status'] ?? null) === 'active' && $election->status === 'closed';
            if ($publishes || $closes || $reopens) {
                return response()->json(['message' => 'The schedule publishes, closes and completes this election, so that cannot be changed by hand.'], 409);
            }
        }
        if (($election->cancelled_at || $election->declined_at) && $this->materialChange($election, $data)) {
            return response()->json(['message' => $election->declined_at ? 'The Department Head rejected this election, so it cannot be changed.' : 'A cancelled election cannot be changed.'], 409);
        }
        if (array_key_exists('filing_starts_at', $data) && ! $draft && ($data['filing_starts_at'] !== null) !== $election->usesFiling()) {
            throw ValidationException::withMessages(['filing_starts_at' => ['The kind of election cannot change after it was submitted.']]);
        }
        if (isset($data['informative_letter']) && $election->status !== 'pending_approval') {
            return response()->json(['message' => 'The informative letter cannot be changed after approval.'], 409);
        }

        $wantsFiling = array_key_exists('filing_starts_at', $data) ? $data['filing_starts_at'] !== null : $election->usesFiling();
        $materialChanged = $this->materialChange($election, $data);
        if ($wantsFiling && $materialChanged && $election->usesFiling() && $this->votingHasOpened($election)) {
            return response()->json(['message' => 'The schedule, rules and qualifications cannot change after voting has opened.'], 409);
        }
        foreach (['rules', 'tie_break_rule'] as $field) {
            if (isset($data[$field])) {
                $data[$field] = trim($data[$field]);
            }
        }

        $endTime = $data['end_time'] ?? $election->end_time;
        $startTime = $data['start_time'] ?? $election->start_time;
        // A draft saved before its voting dates were chosen holds stand-in dates that are never compared.
        $datesAreSet = $startTime->format('Y-m-d H:i:s') !== self::DRAFT_START && $endTime->format('Y-m-d H:i:s') !== self::DRAFT_END;
        if ($wantsFiling) {
            // A draft's stand-in voting dates are not real dates, so they never take part in the checks.
            $standIn = $election->start_time?->format('Y-m-d H:i:s') === self::DRAFT_START;
            $merged = [];
            foreach ($this->scheduleFields() as $field) {
                $merged[$field] = array_key_exists($field, $data)
                    ? $data[$field]
                    : (($field === 'start_time' || $field === 'end_time') && $standIn ? null : $election->{$field});
            }
            if (! $draft) {
                foreach ($this->scheduleFields() as $field) {
                    if (array_key_exists($field, $data) && $data[$field] === null) {
                        throw ValidationException::withMessages([$field => ['This date is required.']]);
                    }
                }
                foreach (['rules', 'tie_break_rule'] as $field) {
                    if (array_key_exists($field, $data) && blank($data[$field])) {
                        throw ValidationException::withMessages([$field => ['This field is required.']]);
                    }
                }
            }
            if (array_intersect($this->scheduleFields(), $requestedFields) !== []) {
                $this->assertScheduleOrder($merged);
                $this->assertScheduleInsideSemester($merged, AcademicSemester::find($election->academic_semester_id));
            }
        } elseif ($datesAreSet && $endTime->lte($startTime)) {
            return response()->json(['message' => 'End time must be after start time.'], 422);
        }

        $semester = ! $wantsFiling && $datesAreSet && (isset($data['start_time']) || isset($data['end_time'])) ? AcademicSemester::find($election->academic_semester_id) : null;
        if ($semester && ($startTime->toDateString() < $semester->starts_on->toDateString()
            || $endTime->toDateString() > $semester->ends_on->toDateString())) {
            throw ValidationException::withMessages(['start_time' => ['The voting period must fall within the semester you are working in ('.$semester->starts_on->format('M j, Y').' to '.$semester->ends_on->format('M j, Y').').']]);
        }

        if ($election->status === 'closed' && ($data['status'] ?? null) === 'active' && $election->access_handed_over_at) {
            return response()->json(['message' => 'Access was already handed over to the winners, so this election cannot be reopened.'], 422);
        }

        if (($data['status'] ?? null) === 'active' && ! $election->approved_at) {
            return response()->json(['message' => 'Election must be approved before it can be opened.'], 422);
        }

        if (($data['status'] ?? null) === 'active' && ! $election->finalized_at) {
            return response()->json(['message' => 'Finalize the candidate and party list ballot before opening voting.'], 422);
        }

        if (($data['status'] ?? null) === 'closed' && ! $election->approved_at) {
            return response()->json(['message' => 'Only an approved election can be closed.'], 422);
        }

        if (($data['status'] ?? null) === 'closed' && ! $election->finalized_at) {
            return response()->json(['message' => 'Finalize the ballot before closing this election.'], 422);
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

        if ($election->votes()->exists() && (count(array_intersect(array_keys($data), ['title', 'room', 'start_time', 'end_time', 'image', 'remove_image'])) > 0)) {
            return response()->json(['message' => 'Election details cannot be changed after votes have been cast.'], 409);
        }

        // A filing election goes back for approval when a material term really changed; the short form only when
        // its voting window moved.
        $windowMoved = $election->approved_at && (
            (isset($data['start_time']) && $data['start_time']->ne($election->start_time))
            || (isset($data['end_time']) && $data['end_time']->ne($election->end_time))
        );
        $reopen = $election->approved_at && ($election->usesFiling() ? $materialChanged : $windowMoved);
        if ($reopen) {
            $data['status'] = 'pending_approval';
            $data['approved_at'] = null;
            $data['finalized_at'] = null;
        }

        $oldImageUrl = $election->image_url;
        $newImageUrl = null;
        if ($request->hasFile('image')) {
            $newImageUrl = $this->storeElectionImage($request);
            $data['image_url'] = $newImageUrl;
        } elseif ($request->boolean('remove_image')) {
            $data['image_url'] = null;
        }
        $oldLetterPath = $election->informative_letter_path;
        $newLetterPath = null;
        if ($request->hasFile('informative_letter')) {
            $newLetterPath = $request->file('informative_letter')->store('election-letters/'.$election->organization_id, 'local');
            $data['informative_letter_path'] = $newLetterPath;
        }
        unset($data['image'], $data['remove_image'], $data['informative_letter']);

        try {
            DB::transaction(function () use ($election, &$data, $reopen, $request, $positions) {
                $election->update($data);
                if ($positions !== null) {
                    $this->syncDraftPositions($election, $positions);
                }
                if ($reopen) {
                    $this->requestApproval($election, $request);
                }
            });
        } catch (\Throwable $exception) {
            $this->deleteElectionImage($newImageUrl);
            if ($newLetterPath) {
                Storage::disk('local')->delete($newLetterPath);
            }

            throw $exception;
        }

        if (array_key_exists('image_url', $data) && $oldImageUrl !== $data['image_url']) {
            $this->deleteElectionImage($oldImageUrl);
        }
        if ($newLetterPath && $oldLetterPath) {
            Storage::disk('local')->delete($oldLetterPath);
        }

        $freshElection = $election->fresh();
        // A returned election goes back to the reviewer once its edits are saved; a returned filing election
        // only when it is complete, and a rejected-for-good one never.
        if (! $freshElection->declined_at && ($freshElection->usesFiling() ? $this->submissionProblems($freshElection) === [] : true)) {
            ApprovalRequest::where('entity_type', 'election')
                ->where('entity_id', $election->id)
                ->where('status', 'rejected')
                ->where('organization_id', $election->organization_id)
                ->get()
                ->each(fn (ApprovalRequest $approval) => $approval->resubmit());
        }

        $this->recordElectionAudit(
            $request,
            $requestedFields === ['status'] ? 'status_changed' : 'updated',
            Election::class,
            $election->id,
            $oldValues,
            $this->auditableElectionValues($freshElection)
        );
        if ($reopen) {
            $this->recordElectionAudit($request, 'approval_reopened', Election::class, $election->id, $oldValues, $this->auditableElectionValues($freshElection));
        }

        if (app(ElectionHandoverService::class)->handOver($freshElection, $request->user()->school_id, $request->ip())) {
            $freshElection = $election->fresh();
        }

        return response()->json($this->withApprovalFields($request, [$this->electionPayload($freshElection)])[0]);
    }

    /**
     * Makes the ballot of an election that is not approved yet match the list the form sent: a title already on the
     * ballot is updated in place, a new title is added, and a title left out is removed unless it already has candidates.
     *
     * @param  array<int, array<string, mixed>>  $positions
     */
    private function syncDraftPositions(Election $election, array $positions): void
    {
        $existing = $election->positions()->get()->keyBy(fn (ElectionPosition $position) => mb_strtolower(trim($position->title)));
        $kept = [];

        foreach ($positions as $position) {
            $title = trim($position['title']);
            $key = mb_strtolower($title);
            $attributes = ['title' => $title, 'max_winners' => $position['max_winners'], ...$this->positionAttributes($position)];

            if ($current = $existing->get($key)) {
                $current->update($attributes);
                $kept[] = $current->id;
            } else {
                $kept[] = $election->positions()->create($attributes)->id;
            }
        }

        foreach ($existing->reject(fn (ElectionPosition $position) => in_array($position->id, $kept, true)) as $dropped) {
            if ($dropped->candidates()->exists()) {
                throw ValidationException::withMessages(['positions' => ['The position '.$dropped->title.' already has candidates, so it cannot be removed.']]);
            }
            $dropped->delete();
        }
    }

    /** Sends a finished draft, or a returned election, to the reviewer. */
    public function submit(Request $request, $id)
    {
        $election = Election::where('organization_id', $request->user()->organization_id)->find($id);
        if (! $election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        if ($election->declined_at) {
            return response()->json(['message' => 'The Department Head rejected this election. Create a new one.'], 409);
        }

        $latest = ApprovalRequest::where('entity_type', 'election')->where('entity_id', $election->id)->latest('id')->first();
        if ($election->status !== 'pending_approval' || ($latest && $latest->status !== 'rejected')) {
            return response()->json(['message' => $election->approved_at ? 'This election is already approved.' : 'This election is already waiting for approval.'], 409);
        }

        if ($problems = $this->submissionProblems($election)) {
            throw ValidationException::withMessages($problems);
        }

        DB::transaction(function () use ($election, $latest, $request) {
            $election->update(['submitted_at' => now()]);
            if ($latest) {
                $latest->resubmit();
            } else {
                $this->requestApproval($election, $request);
            }
        });
        $this->recordElectionAudit($request, $latest ? 'resubmitted' : 'submitted', Election::class, $election->id, null, $this->auditableElectionValues($election->fresh()));

        return response()->json($this->withApprovalFields($request, [$this->electionPayload($election->fresh())])[0]);
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

    /** A candidate is a student or an officer with an active profile in the organization, wherever their own account lives, and an account that is itself active. */
    private function isStudentOf(int $schoolId, int $organizationId): bool
    {
        return AccountProfile::where('user_school_id', $schoolId)
            ->where('organization_id', $organizationId)
            ->whereIn('role', ['STUDENT', 'SBO_OFFICER'])
            ->where('account_status', 'active')
            ->whereHas('user', fn ($q) => $q->where('account_status', 'active'))
            ->exists();
    }

    private function ballotIsLockedResponse(Election $election)
    {
        if ($election->status === 'closed') {
            return response()->json(['message' => 'Closed elections cannot be changed.'], 409);
        }

        if ($election->finalized_at) {
            return response()->json(['message' => 'The ballot has been finalized and cannot be changed.'], 409);
        }

        if ($election->usesFiling() && $this->votingHasOpened($election)) {
            return response()->json(['message' => 'Voting has opened, so the ballot cannot be changed.'], 409);
        }

        if (! $election->votes()->exists()) {
            return null;
        }

        return response()->json([
            'message' => 'Ballot setup cannot be changed after votes have been cast.',
        ], 409);
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

    /**
     * Latest approval row per election in one query, so the Admin can read why
     * an election was returned without a request per row.
     *
     * @param  array<int>  $electionIds
     * @return array<int, array{approval_status: string, approval_remarks: ?string, approval_id: int}>
     */
    private function approvalFields(array $electionIds): array
    {
        $latestIds = ApprovalRequest::where('entity_type', 'election')
            ->whereIn('entity_id', $electionIds)
            ->selectRaw('MAX(id) as id')
            ->groupBy('entity_id')
            ->pluck('id');

        return ApprovalRequest::whereIn('id', $latestIds)
            ->get(['id', 'entity_id', 'status', 'remarks', 'required_role'])
            ->mapWithKeys(fn (ApprovalRequest $approval) => [$approval->entity_id => [
                'approval_status' => $approval->status,
                'approval_remarks' => $approval->remarks,
                'approval_id' => $approval->id,
                'approval_required_role' => $approval->required_role,
            ]])
            ->all();
    }

    private function withApprovalFields(Request $request, array $payloads): array
    {
        if ($request->user()->role === 'STUDENT') {
            return $payloads;
        }

        $fields = $this->approvalFields(array_column($payloads, 'id'));
        $none = ['approval_status' => null, 'approval_remarks' => null, 'approval_id' => null, 'approval_required_role' => null];

        return array_map(fn (array $payload) => $payload + ($fields[$payload['id']] ?? $none), $payloads);
    }

    public function destroy(Request $request, $id)
    {
        $election = Election::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        // The checks run on the locked row. A vote, candidate or position takes a shared lock on its election through
        // the foreign key and opening or closing updates the row, so each either lands before the checks and blocks
        // the delete, or waits for it; the cascade can no longer take a vote cast in between.
        $electionId = $election->id;
        $imageUrl = $election->image_url;
        $letterPath = $election->informative_letter_path;
        $oldValues = null;
        // The approval rows are locked first because a review locks its approval row before the election row.
        $blocked = DB::transaction(function () use ($electionId, &$oldValues, $election) {
            ApprovalRequest::where('organization_id', $election->organization_id)
                ->where('entity_type', 'election')
                ->where('entity_id', $electionId)
                ->lockForUpdate()
                ->get();
            $locked = Election::whereKey($electionId)->lockForUpdate()->first();
            if (! $locked) {
                return self::ELECTION_GONE;
            }
            if ($locked->status === 'closed') {
                return 'Closed elections cannot be deleted.';
            }
            if ($locked->status === 'active') {
                return 'An open election cannot be deleted. Close it instead to keep the results.';
            }
            if ($locked->votes()->exists()) {
                return 'This election already has cast votes and cannot be deleted.';
            }

            $oldValues = $this->auditableElectionValues($locked);
            ApprovalRequest::where('organization_id', $locked->organization_id)
                ->where('entity_type', 'election')
                ->where('entity_id', $locked->id)
                ->delete();
            $locked->delete();

            return null;
        });
        if ($blocked === self::ELECTION_GONE) {
            return response()->json(['message' => 'Election not found'], 404);
        }
        if ($blocked) {
            return response()->json(['message' => $blocked], 409);
        }

        $this->deleteElectionImage($imageUrl);
        if ($letterPath) {
            Storage::disk('local')->delete($letterPath);
        }
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
            ...$this->positionRules(),
        ]);
        $this->assertVoteLimit(isset($data['vote_limit']) ? (int) $data['vote_limit'] : null, (int) ($data['max_winners'] ?? 1), 'vote_limit');

        try {
            $position = DB::transaction(function () use ($election, $data, $request) {
                $locked = Election::whereKey($election->id)->lockForUpdate()->first();
                if (! $locked) {
                    return self::ELECTION_GONE;
                }
                if ($response = $this->ballotIsLockedResponse($locked)) {
                    return $response;
                }

                $created = $locked->positions()->create([
                    'title' => trim($data['title']),
                    'max_winners' => $data['max_winners'] ?? 1,
                    ...$this->positionAttributes($data),
                ]);
                if ($locked->usesFiling() && $locked->approved_at) {
                    $this->reopenApproval($request, $locked);
                }

                return $created;
            });
        } catch (UniqueConstraintViolationException) {
            return response()->json(['message' => 'This position already exists in the election.'], 422);
        }
        if ($position === self::ELECTION_GONE) {
            return response()->json(['message' => 'Election not found'], 404);
        }
        if ($position instanceof JsonResponse) {
            return $position;
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
            ...$this->positionRules(),
        ]);

        if (isset($data['title'])) {
            $data['title'] = trim($data['title']);
        }
        $voteLimit = array_key_exists('vote_limit', $data) ? $data['vote_limit'] : $position->vote_limit;
        $this->assertVoteLimit($voteLimit === null ? null : (int) $voteLimit, (int) ($data['max_winners'] ?? $position->max_winners), 'vote_limit');

        $position->fill([...array_intersect_key($data, array_flip(['title', 'max_winners'])), ...$this->positionAttributes($data)]);
        $changed = $position->isDirty(self::MATERIAL_POSITION_FIELDS);
        $position->save();
        if ($changed && $election->usesFiling() && $election->approved_at) {
            $this->reopenApproval($request, $election);
        }

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
        if ($election->usesFiling() && $election->approved_at) {
            $this->reopenApproval($request, $election);
        }

        return response()->json(['message' => 'Position deleted successfully']);
    }

    public function candidatesIndex(Request $request, $id)
    {
        $election = Election::whereIn('organization_id', $request->user()->electionOrganizationIds())->find($id);

        if (! $election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        return response()->json(
            Candidate::with(['user:school_id,first_name,last_name,program,year_level', 'partylist', 'position'])
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

        if ($election->usesFiling()) {
            return response()->json(['message' => self::CANDIDATES_FROM_APPLICATIONS], 409);
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
        ], [], ['image' => 'candidate photo']);

        if (! $this->isStudentOf((int) $data['user_id'], $request->user()->organization_id)) {
            return response()->json(['message' => 'Only students and officers of this organization can be added as candidates.'], 422);
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

        $discardImage = function () use ($imageUrl) {
            if ($imageUrl && str_starts_with($imageUrl, '/storage/')) {
                Storage::delete('public/'.ltrim(str_replace('/storage/', '', $imageUrl), '/'));
            }
        };

        try {
            $candidate = DB::transaction(function () use ($election, $data, $imageUrl) {
                $locked = Election::whereKey($election->id)->lockForUpdate()->first();
                if (! $locked) {
                    return self::ELECTION_GONE;
                }
                if ($response = $this->ballotIsLockedResponse($locked)) {
                    return $response;
                }

                return Candidate::create([
                    'election_id' => $locked->id,
                    'user_id' => $data['user_id'],
                    'position_id' => $data['position_id'],
                    'partylist_id' => $data['partylist_id'] ?? null,
                    'platform' => $data['platform'] ?? null,
                    'image_url' => $imageUrl,
                ]);
            });
        } catch (UniqueConstraintViolationException) {
            $discardImage();

            return response()->json(['message' => 'This student is already assigned as a candidate in this election.'], 422);
        }
        if ($candidate === self::ELECTION_GONE || $candidate instanceof JsonResponse) {
            $discardImage();

            return $candidate === self::ELECTION_GONE ? response()->json(['message' => 'Election not found'], 404) : $candidate;
        }

        $candidate->load(['user:school_id,first_name,last_name,program,year_level', 'partylist', 'position']);
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

        if ($election->usesFiling()) {
            return response()->json(['message' => self::CANDIDATES_FROM_APPLICATIONS], 409);
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
        ], [], ['image' => 'candidate photo']);

        if (array_key_exists('position_id', $data)) {
            $position = ElectionPosition::where('election_id', $candidate->election_id)->find($data['position_id']);

            if (! $position) {
                return response()->json(['message' => 'Position does not belong to this election'], 422);
            }
        }

        if (array_key_exists('user_id', $data)) {
            if (! $this->isStudentOf((int) $data['user_id'], $request->user()->organization_id)) {
                return response()->json(['message' => 'Only students and officers of this organization can be assigned as candidates.'], 422);
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

        $freshCandidate = $candidate->fresh()->load(['user:school_id,first_name,last_name,program,year_level', 'partylist', 'position']);
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

        if ($election->usesFiling()) {
            return response()->json(['message' => self::CANDIDATES_FROM_APPLICATIONS], 409);
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
                ->whereIn('organization_id', $request->user()->scopedOrganizationIds())
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

        if ($partylist->candidates()->whereHas('election', fn ($query) => $query->whereNotNull('finalized_at'))->exists()) {
            return response()->json(['message' => 'A finalized ballot uses this party list and it cannot be changed.'], 409);
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

    private function onVoterRoll(Election $election, User $user): bool
    {
        return $election->listsVoter($user->school_id);
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
            'room' => $election->room,
            'image_url' => $election->image_url,
            'start_time' => $election->start_time?->toISOString(),
            'end_time' => $election->end_time?->toISOString(),
            'status' => $election->status,
            'results_visible' => (bool) $election->results_visible,
            'approved_at' => $election->approved_at?->toISOString(),
            'description' => $election->description,
            'filing_starts_at' => $election->filing_starts_at?->toISOString(),
            'filing_ends_at' => $election->filing_ends_at?->toISOString(),
            'screening_starts_at' => $election->screening_starts_at?->toISOString(),
            'screening_ends_at' => $election->screening_ends_at?->toISOString(),
            'campaign_starts_at' => $election->campaign_starts_at?->toISOString(),
            'campaign_ends_at' => $election->campaign_ends_at?->toISOString(),
            'results_publish_at' => $election->results_publish_at?->toISOString(),
            'rules' => $election->rules,
            'rules_version' => $election->rules_version,
            'tie_break_rule' => $election->tie_break_rule,
            'min_units' => $election->min_units,
            'min_gpa' => $election->min_gpa,
            'submitted_at' => $election->submitted_at?->toISOString(),
        ];
    }

    private function auditablePositionValues(ElectionPosition $position): array
    {
        return [
            'id' => $position->id,
            'election_id' => $position->election_id,
            'title' => $position->title,
            'max_winners' => $position->max_winners,
            'description' => $position->description,
            'is_executive' => (bool) $position->is_executive,
            'vote_limit' => $position->vote_limit,
            'eligible_year_levels' => $position->eligible_year_levels,
            'other_qualifications' => $position->other_qualifications,
            'is_active' => (bool) $position->is_active,
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
