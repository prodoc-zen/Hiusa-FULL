<?php

namespace App\Http\Controllers;

use App\Models\AcademicSemester;
use App\Models\AccountProfile;
use App\Models\AuditLog;
use App\Models\Candidate;
use App\Models\Election;
use App\Models\ElectionApplication;
use App\Models\ElectionBallot;
use App\Models\Partylist;
use App\Models\User;
use App\Services\ElectionReportPdfService;
use App\Services\ElectionTallyService;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

/**
 * Seven reports of one election, each as {title, election, generated_at, columns, rows} in JSON (the Excel export reads
 * it) or as a PDF. Reports name people, positions and totals. They never carry a document path, a voter, or anything
 * that links a voter to a choice.
 */
class ElectionReportController extends Controller
{
    private const TYPES = ['candidates', 'screening', 'partylists', 'participation', 'canvassing', 'results', 'audit'];

    private const STATUS_LABELS = [
        'draft' => 'Draft',
        'pending_review' => 'Pending review',
        'for_revision' => 'For correction',
        'approved' => 'Approved',
        'rejected' => 'Rejected',
        'withdrawn' => 'Withdrawn',
    ];

    private const OUTCOME_LABELS = [
        'decided' => 'Elected',
        'unopposed' => 'Elected unopposed',
        'vacant' => 'Vacant: no candidates',
        'resolved' => 'Tie resolved',
        'tie' => 'Tie',
        'runoff_required' => 'Runoff required',
        'runoff_scheduled' => 'Runoff scheduled',
        'runoff_voting' => 'Runoff voting is open',
        'tie_pending' => 'Pending tie resolution',
    ];

    /** Audit detail reads only these fields of the stored values, so a stray voter or choice field can never surface. */
    private const AUDIT_DETAIL_KEYS = ['decision', 'notes', 'reason', 'status', 'phase', 'old_phase', 'new_phase', 'rules_version', 'type', 'format', 'title', 'rule_used', 'explanation'];

    /** @var array<int, string> position titles of the election being reported */
    private array $titles = [];

    public function __construct(
        private readonly ElectionTallyService $tally,
        private readonly ElectionReportPdfService $pdf,
    ) {}

    public function show(Request $request, $id, $type)
    {
        if (! in_array($type, self::TYPES, true)) {
            return response()->json(['message' => 'Report not found'], 404);
        }

        $format = $request->query('format', 'json');
        if (! in_array($format, ['json', 'pdf'], true)) {
            return response()->json(['message' => 'The format must be json or pdf.', 'errors' => ['format' => ['The format must be json or pdf.']]], 422);
        }

        $user = $request->user();
        $organizationIds = $user->scopedOrganizationIds();
        Election::synchronizeScheduledStatuses($organizationIds, (int) $id);
        $election = Election::with('organization:id,name')->whereIn('organization_id', $organizationIds)->find($id);
        if (! $election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        // Totals and outcomes follow the results endpoint: nothing before voting closes, and the Admin first.
        if (in_array($type, ['canvassing', 'results'], true)) {
            if ($election->status !== 'closed') {
                return response()->json(['message' => 'Results are available after voting closes.'], 403);
            }
            $reviewer = in_array($user->role, ['DEPARTMENT_HEAD', 'SUPER_ADMIN'], true);
            if (! $election->results_visible && $user->role !== 'ADMIN' && ! ($reviewer && $election->phase === 'tie_resolution')) {
                return response()->json(['message' => 'Election results have not been released yet.'], 403);
            }
        }

        $this->titles = $election->positions()->pluck('title', 'id')->all();
        $report = match ($type) {
            'candidates' => $this->candidates($election),
            'screening' => $this->screening($election),
            'partylists' => $this->partylists($election),
            'participation' => $this->participation($election),
            'canvassing' => $this->canvassing($election, $user),
            'results' => $this->results($election, $user),
            'audit' => $this->audit($election),
        };
        $report['election'] = [
            'title' => $election->title,
            'organization' => $election->organization?->name,
            'academic_year' => $this->academicYear($election),
        ];
        $report['generated_at'] = now()->format('Y-m-d H:i');

        AuditLog::create([
            'organization_id' => $election->organization_id,
            'user_id' => $user->school_id,
            'actor_role' => $user->role,
            'module' => 'elections',
            'action' => 'report_exported',
            'description' => 'Election report exported.',
            'record_type' => Election::class,
            'record_id' => $election->id,
            'old_values' => null,
            'new_values' => ['type' => $type, 'format' => $format],
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);

        // No-store keeps the response out of the API cache, so every export reaches this method and writes its audit row.
        $headers = ['Cache-Control' => 'private, no-store, max-age=0', 'X-Content-Type-Options' => 'nosniff'];

        if ($format === 'pdf') {
            $file = $this->pdf->render($report, Str::slug($election->title.' '.$type) ?: 'election-report');

            return response($file['content'], 200, $headers + [
                'Content-Type' => 'application/pdf',
                'Content-Disposition' => 'inline; filename="'.$file['filename'].'"',
            ]);
        }

        return response()->json($report, 200, $headers);
    }

    private function candidates(Election $election): array
    {
        $rows = $this->candidateModels($election)
            ->sortBy(fn (Candidate $candidate) => [$candidate->position_id, $candidate->id])
            ->map(fn (Candidate $candidate) => [
                $this->titles[$candidate->position_id] ?? '',
                $this->nameOf($candidate->user),
                $candidate->partylist?->name ?? 'Independent',
            ])
            ->values()
            ->all();

        return ['title' => 'Official candidates', 'columns' => ['Position', 'Candidate', 'Party list'], 'rows' => $rows];
    }

    private function screening(Election $election): array
    {
        $applications = ElectionApplication::with(['user:school_id,first_name,last_name', 'partylist:id,name'])
            ->where('election_id', $election->id)
            ->orderBy('id')
            ->get();
        $reviewers = $this->usersBySchoolId($applications->pluck('reviewed_by'));

        return [
            'title' => 'Candidacy screening',
            'columns' => ['Candidate', 'Position', 'Party list', 'Status', 'Decision notes', 'Reviewed by', 'Submitted', 'Reviewed'],
            'rows' => $applications->map(fn (ElectionApplication $application) => [
                $this->nameOf($application->user),
                $this->titles[$application->position_id] ?? '',
                $application->partylist?->name ?? 'Independent',
                self::STATUS_LABELS[$application->status] ?? $application->status,
                (string) $application->review_notes,
                $this->nameOf($reviewers->get($application->reviewed_by)),
                $application->submitted_at?->format('Y-m-d H:i') ?? '',
                $application->reviewed_at?->format('Y-m-d H:i') ?? '',
            ])->all(),
        ];
    }

    private function partylists(Election $election): array
    {
        $candidates = $this->candidateModels($election);
        $applications = ElectionApplication::with('user:school_id,first_name,last_name')
            ->where('election_id', $election->id)
            ->whereNotNull('partylist_id')
            ->where('status', '!=', 'withdrawn')
            ->orderBy('id')
            ->get();
        $slates = Partylist::where('election_id', $election->id)
            ->orWhereIn('id', $candidates->pluck('partylist_id')->filter()->unique())
            ->orderBy('name')
            ->get();
        $representatives = $this->usersBySchoolId($slates->pluck('representative_school_id'));
        $listed = $applications->pluck('candidate_id')->filter();

        $rows = [];
        foreach ($slates as $slate) {
            // Members come from the slate's applications; a candidate added directly under it joins them as Approved.
            $members = $applications->where('partylist_id', $slate->id)->map(fn (ElectionApplication $application) => [
                $application->position_id,
                $this->nameOf($application->user),
                self::STATUS_LABELS[$application->status] ?? $application->status,
            ])->concat(
                $candidates->where('partylist_id', $slate->id)->reject(fn (Candidate $candidate) => $listed->contains($candidate->id))->map(fn (Candidate $candidate) => [
                    $candidate->position_id,
                    $this->nameOf($candidate->user),
                    'Approved',
                ]),
            )->sortBy(fn (array $member) => $member[0])->values();

            $lead = [$slate->name, (string) $slate->motto, $this->nameOf($representatives->get($slate->representative_school_id))];
            if ($members->isEmpty()) {
                $rows[] = [...$lead, '', '', ''];
            }
            foreach ($members as [$positionId, $name, $status]) {
                $rows[] = [...$lead, $this->titles[$positionId] ?? '', $name, $status];
            }
        }

        return ['title' => 'Party lists', 'columns' => ['Party list', 'Motto', 'Representative', 'Position', 'Member', 'Status'], 'rows' => $rows];
    }

    private function participation(Election $election): array
    {
        $rounds = [1 => 'First round'];
        if ($election->runoff_starts_at !== null || ElectionBallot::where('election_id', $election->id)->where('round', 2)->exists()) {
            $rounds[2] = 'Runoff';
        }

        $rows = [];
        foreach ($rounds as $round => $label) {
            $voterIds = ElectionBallot::where('election_id', $election->id)->where('round', $round)->pluck('voter_id');
            // The roll as the voter list reads it: the frozen roll plus anyone who voted and lost access since.
            $onRoll = AccountProfile::onVoterRoll($election->finalized_at)->where('account_profiles.organization_id', $election->organization_id)->select('account_profiles.id');
            $eligible = AccountProfile::where('account_profiles.organization_id', $election->organization_id)
                ->where(fn ($profiles) => $profiles->whereIn('account_profiles.id', $onRoll)->orWhereIn('account_profiles.user_school_id', $voterIds))
                ->count();
            $rows[] = [$label, $eligible, $voterIds->count(), $eligible > 0 ? round($voterIds->count() / $eligible * 100, 1) : 0.0];
        }

        return ['title' => 'Voter participation', 'columns' => ['Round', 'Eligible voters', 'Ballots submitted', 'Turnout (%)'], 'rows' => $rows];
    }

    private function canvassing(Election $election, User $user): array
    {
        $standings = $this->tally->standings($election);
        $totals = $this->tally->totals($election);
        $candidates = $this->candidateModels($election)->groupBy('position_id');
        $masked = $this->runoffMasked($election, $user);
        $runoffEnded = $election->runoff_ends_at !== null && $election->runoff_ends_at->lt(now());

        $rows = [];
        foreach ($standings as $standing) {
            $runoffIds = $standing['runoff']['candidate_ids'] ?? [];
            $own = $candidates->get($standing['position']->id, collect())
                ->sortByDesc(fn (Candidate $candidate) => $totals[$candidate->id]['votes'] ?? 0);
            foreach ($own as $candidate) {
                $count = $totals[$candidate->id] ?? ['votes' => 0, 'runoff_votes' => 0];
                $rows[] = [
                    $standing['position']->title,
                    $this->nameOf($candidate->user),
                    $candidate->partylist?->name ?? 'Independent',
                    $count['votes'],
                    ! $masked && $runoffEnded && in_array((int) $candidate->id, $runoffIds, true) ? $count['runoff_votes'] : null,
                ];
            }
        }

        return ['title' => 'Canvassing of votes', 'columns' => ['Position', 'Candidate', 'Party list', 'Round 1 votes', 'Runoff votes'], 'rows' => $rows];
    }

    private function results(Election $election, User $user): array
    {
        $standings = $this->tally->standings($election);
        $names = $this->candidateModels($election)->keyBy('id');
        $resolvers = $this->usersBySchoolId($standings->pluck('position.tie_resolved_by'));
        $masked = $this->runoffMasked($election, $user);

        $rows = $standings->map(function (array $standing) use ($masked, $names, $resolvers) {
            $position = $standing['position'];
            $runoff = $standing['runoff'];
            $status = $standing['status'];
            $winners = $standing['winners'];

            // Until the runoff is published, only the Admin and the reviewer read its outcome.
            if ($masked && $runoff !== null) {
                $winners = $winners->reject(fn (Candidate $candidate) => in_array((int) $candidate->id, $runoff['candidate_ids'], true));
                if (in_array($status, ['decided', 'resolved', 'tie_pending'], true)) {
                    $status = 'runoff_voting';
                }
            }
            $pending = in_array($status, ElectionTallyService::UNRESOLVED, true);

            $resolution = '';
            if ($status === 'resolved') {
                $by = $resolvers->get($position->tie_resolved_by);
                $resolution = trim('Rule used: '.$position->tie_rule_used.'. Explanation: '.$position->tie_explanation.($by ? ' Decided by '.$this->nameOf($by).'.' : ''));
            }

            return [
                $position->title,
                $standing['seats'],
                self::OUTCOME_LABELS[$status] ?? $status,
                $winners->map(fn (Candidate $candidate) => $this->nameOf($names->get($candidate->id)?->user))->implode(', '),
                $pending ? null : max(0, $standing['seats'] - $winners->count()),
                $resolution,
            ];
        })->values()->all();

        return ['title' => 'Election results', 'columns' => ['Position', 'Seats', 'Outcome', 'Winners', 'Vacant seats', 'Resolution'], 'rows' => $rows];
    }

    private function audit(Election $election): array
    {
        $logs = AuditLog::with('user:school_id,first_name,last_name')
            ->where('record_type', Election::class)
            ->where('record_id', $election->id)
            ->orderBy('id')
            ->limit(2000)
            ->get();

        return [
            'title' => 'Audit trail',
            'columns' => ['Action', 'Actor', 'Time', 'Detail'],
            'rows' => $logs->map(fn (AuditLog $log) => [
                $log->action,
                $log->user ? $this->nameOf($log->user) : 'System',
                $log->created_at?->format('Y-m-d H:i') ?? '',
                $this->auditDetail($log),
            ])->all(),
        ];
    }

    private function auditDetail(AuditLog $log): string
    {
        $parts = [];
        if (filled($log->description)) {
            $parts[] = rtrim((string) $log->description, '.');
        }
        foreach (self::AUDIT_DETAIL_KEYS as $key) {
            $value = $log->new_values[$key] ?? null;
            if (is_scalar($value) && $value !== '') {
                $parts[] = $key.': '.$value;
            }
        }

        return Str::limit(implode('; ', $parts), 240);
    }

    /** Runoff votes and winners are hidden from everyone but the Admin and the reviewer until the runoff is published. */
    private function runoffMasked(Election $election, User $user): bool
    {
        return ! in_array($user->role, ['DEPARTMENT_HEAD', 'SUPER_ADMIN', 'ADMIN'], true)
            && $election->runoff_publish_at !== null
            && now()->lt($election->runoff_publish_at);
    }

    /** @return Collection<int, Candidate> */
    private function candidateModels(Election $election): Collection
    {
        return Candidate::with(['user:school_id,first_name,last_name', 'partylist:id,name'])
            ->where('election_id', $election->id)
            ->orderBy('id')
            ->get();
    }

    private function usersBySchoolId(Collection $ids): Collection
    {
        return User::whereIn('school_id', $ids->filter()->unique())->get(['school_id', 'first_name', 'last_name'])->keyBy('school_id');
    }

    private function nameOf(?User $user): string
    {
        return $user ? trim($user->first_name.' '.$user->last_name) : '';
    }

    private function academicYear(Election $election): ?string
    {
        if (! $election->academic_semester_id) {
            return null;
        }

        return AcademicSemester::with('academicYear:id,label')->find($election->academic_semester_id)?->academicYear?->label;
    }
}
