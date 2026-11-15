<?php

namespace App\Services\Ai;

use App\Models\ApprovalRequest;
use App\Models\AuditLog;
use App\Models\ClearanceSignature;
use App\Models\Election;
use App\Models\ElectionApplication;
use App\Models\Event;
use App\Models\EventRequirement;
use App\Models\FinancialReport;
use App\Models\Grievance;
use App\Models\Organization;
use App\Models\OrganizationApplication;
use App\Models\OrganizationComplianceSubmission;
use App\Models\User;
use App\Services\ApprovalEntityLabel;
use App\Services\ChangesSinceReturn;
use App\Services\ElectionApplicationService;
use App\Support\NotFound;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/**
 * Turns a database record into the facts ReviewNoteDrafter::draftFromFacts reads, one builder per flow. Each builder
 * applies the same scope and status rules as the route that records the decision, so a reviewer who may not decide
 * on a record gets the same refusal here and learns nothing from the draft. Nothing that names a person or a file is read:
 * no filer, applicant or student name, no student number, no uploaded file name.
 */
class ReviewNoteContext
{
    public const FLOWS = ['event', 'compliance_submission', 'financial_report', 'org_application', 'approval', 'election_application', 'grievance', 'clearance_hold'];

    /** The roles each decision route lets in; the rest of each route's rules run in the builder. */
    private const ROLES = [
        'event' => ['SUPER_ADMIN', 'DEPARTMENT_HEAD', 'ADMIN'],
        'financial_report' => ['SUPER_ADMIN', 'DEPARTMENT_HEAD', 'ADMIN'],
        'approval' => ['SUPER_ADMIN', 'DEPARTMENT_HEAD', 'ADMIN'],
        'compliance_submission' => ['SUPER_ADMIN'],
        'org_application' => ['SUPER_ADMIN', 'DEPARTMENT_HEAD'],
        'election_application' => ['ADMIN'],
        'grievance' => ['SUPER_ADMIN', 'ADMIN'],
        'clearance_hold' => ['SUPER_ADMIN', 'DEPARTMENT_HEAD', 'ADMIN', 'SBO_OFFICER'],
    ];

    public function __construct(
        private readonly ChangesSinceReturn $changes,
        private readonly ApprovalEntityLabel $labels,
        private readonly ElectionApplicationService $electionApplications,
    ) {}

    /**
     * @param  array<int, array<string, mixed>>  $marks  [{requirement (key or label), mark, note}]
     * @return array<string, mixed> the facts, ready for draftFromFacts
     */
    public function build(User $user, string $flow, int $recordId, string $decision, array $marks, string $reviewerNotes, ?string $currentText): array
    {
        abort_unless(in_array($user->role, self::ROLES[$flow] ?? [], true), 403, 'Forbidden.');

        $record = match ($flow) {
            'event' => $this->forApproval($user, $recordId, 'event'),
            'financial_report' => $this->forApproval($user, $recordId, 'financial_report'),
            'approval' => $this->forApproval($user, $recordId, null),
            'compliance_submission' => $this->forSubmission($recordId),
            'org_application' => $this->forApplication($user, $recordId),
            'election_application' => $this->forElectionApplication($user, $recordId),
            'grievance' => $this->forGrievance($user, $recordId),
            'clearance_hold' => $this->forClearance($user, $recordId),
        };

        [$resolved, $unmarked] = $this->resolveMarks($marks, $record['known'] ?? []);
        $facts = [
            'flow' => $flow,
            'decision' => $decision,
            'subject' => $record['subject'],
            'round' => $record['round'] ?? 1,
            'marks' => $resolved,
            'reviewer_notes' => $reviewerNotes,
            'prior_remarks' => $record['prior_remarks'] ?? '',
            'changes_since_return' => $record['changes'] ?? [],
        ];
        if ($unmarked !== []) {
            $facts['unmarked_requirements'] = $unmarked;
        }
        if (filled($currentText)) {
            $facts['current_text'] = trim($currentText);
        }

        return $facts;
    }

    /** An approval request the caller may decide on now: the rules of ApprovalRequestController::review. */
    private function forApproval(User $user, int $id, ?string $type): array
    {
        $query = ApprovalRequest::query();
        if ($user->role !== 'SUPER_ADMIN') {
            $query->whereIn('organization_id', $user->scopedOrganizationIds());
        }
        $approval = $query->find($id);
        NotFound::unless($approval !== null && ($type === null || $approval->entity_type === $type));

        $unified = in_array($approval->entity_type, ['budget', 'election'], true)
            && Organization::student()->whereKey($approval->organization_id)->where('is_university_wide', true)->exists();
        $superAdminTypes = ['financial_report', 'event', ...(config('approvals.budget_final') === 'SUPER_ADMIN' ? ['budget'] : [])];
        abort_if($user->role === 'SUPER_ADMIN' && ! $unified && ! in_array($approval->entity_type, $superAdminTypes, true), 403, 'Super Admin can only review financial reports and events.');
        abort_if($approval->status !== 'pending', 409, 'This request has already been reviewed.');
        abort_if($user->approvalRole() !== $approval->required_role || ($approval->assigned_approver && $approval->assigned_approver !== $user->school_id), 403, 'You are not authorized to review this request.');
        abort_if($approval->requested_by === $user->school_id, 403, 'You cannot review your own approval request.');

        // A financial report is sent as a new request each time, so its earlier returns sit on earlier rows.
        $ids = $approval->entity_type === 'financial_report'
            ? ApprovalRequest::where('entity_type', 'financial_report')->where('entity_id', $approval->entity_id)->where('id', '<=', $approval->id)->pluck('id')->all()
            : [$approval->id];
        $returns = AuditLog::where('module', 'approvals')->where('record_type', ApprovalRequest::class)
            ->where('action', 'reviewed_rejected')->whereIn('record_id', $ids)->orderBy('id')->get();

        $dates = '';
        $known = [];
        if ($approval->entity_type === 'event') {
            $event = Event::where('organization_id', $approval->organization_id)->find($approval->entity_id);
            $dates = $this->range($event?->start_time, $event?->end_time);
            $known = $event ? EventRequirement::activeForEvent($event)->pluck('name', 'id')->all() : [];
        } elseif ($approval->entity_type === 'election') {
            $election = Election::where('organization_id', $approval->organization_id)->find($approval->entity_id);
            $dates = $this->range($election?->start_time, $election?->end_time);
        } elseif ($approval->entity_type === 'financial_report') {
            $report = FinancialReport::where('organization_id', $approval->organization_id)->find($approval->entity_id);
            $dates = $this->range($report?->period_start, $report?->period_end);
        }

        return [
            'subject' => ['organization' => $this->organizationName($approval->organization_id), 'title' => $this->labels->for($approval), 'dates' => $dates],
            'round' => $returns->count() + 1,
            'prior_remarks' => (string) ($returns->last()?->new_values['remarks'] ?? ''),
            'changes' => $this->changeLines($this->changes->forApprovals(collect([$approval]))[$approval->id] ?? []),
            'known' => $known,
        ];
    }

    /** A pending compliance submission, which only the SAO reviews and which is not scoped to one organization. */
    private function forSubmission(int $id): array
    {
        $submission = OrganizationComplianceSubmission::with('requirementType')->find($id);
        NotFound::unless($submission !== null);
        abort_if($submission->status !== 'submitted', 409, 'Only a pending submission can be reviewed.');

        $returns = AuditLog::where('module', 'compliance')->where('record_type', OrganizationComplianceSubmission::class)
            ->where('record_id', $submission->id)->where('action', 'submission_returned')->orderBy('id')->get();
        $type = $submission->requirementType;

        return [
            'subject' => ['organization' => $this->organizationName($submission->organization_id), 'title' => (string) $type?->name, 'dates' => $type?->deadline_at ? 'Due '.Carbon::parse($type->deadline_at)->format('F j, Y') : ''],
            'round' => $returns->count() + 1,
            'prior_remarks' => (string) ($returns->last()?->new_values['remarks'] ?? ''),
            'changes' => $this->changeLines($this->changes->forSubmissions(collect([$submission]))[$submission->id] ?? []),
            'known' => $type ? [$type->id => $type->name] : [],
        ];
    }

    /** An application waiting at the caller's stage, in the caller's college: the rules of OrganizationApplicationReviewController. */
    private function forApplication(User $user, int $id): array
    {
        $query = OrganizationApplication::whereNotIn('status', OrganizationApplication::LEGACY_UNQUEUED);
        if ($user->role !== 'SUPER_ADMIN') {
            $home = $user->organization;
            if ($home?->organization_type === 'COLLEGE' && $home->college_id) {
                $query->where('college_id', $home->college_id);
            } else {
                $query->whereRaw('1 = 0');
            }
        }
        $application = $query->with('documents.requirementType')->find($id);
        NotFound::unless($application !== null);
        abort_if($application->status !== ($user->role === 'SUPER_ADMIN' ? 'pending_sao' : 'pending_dean'), 409, 'This application is not waiting for you. Refresh the list.');

        $returned = AuditLog::where('module', 'organization_applications')->where('record_type', OrganizationApplication::class)
            ->where('record_id', $application->id)->where('action', 'returned')->latest('id')->first();

        return [
            'subject' => ['organization' => (string) $application->name, 'title' => 'Application to register '.$application->name, 'dates' => $application->submitted_at ? 'Sent '.$application->submitted_at->format('F j, Y') : ''],
            'round' => max(1, (int) $application->round),
            'prior_remarks' => (string) ($returned?->new_values['note'] ?? ''),
            'changes' => $this->changeLines($this->changes->forApplication($application)),
            'known' => $application->documents->mapWithKeys(fn ($document) => [$document->requirement_type_id => (string) $document->requirementType?->name])->filter()->all(),
        ];
    }

    /** One candidacy of the Admin's own filing election, waiting in screening: the rules of ElectionApplicationController::review. */
    private function forElectionApplication(User $user, int $id): array
    {
        $application = ElectionApplication::find($id);
        NotFound::unless($application !== null);
        $election = $this->electionApplications->adminElection($user, $application->election_id);
        $this->electionApplications->assertRunning($election);
        $this->electionApplications->assertPhase($election, 'screening', 'Applications are decided while screening is open.');
        abort_if($application->status !== 'pending_review', 409, 'This application is not waiting for a decision.');

        return [
            'subject' => [
                'organization' => $this->organizationName($election->organization_id),
                'title' => 'Candidacy for '.$this->electionApplications->positionTitle($application).' in '.$election->title,
                'dates' => $this->range($election->screening_starts_at, $election->screening_ends_at),
            ],
            'round' => $application->reviewed_at ? 2 : 1,
            'prior_remarks' => (string) ($application->reviewed_at ? $application->review_notes : ''),
        ];
    }

    /** A grievance the caller may move on. Only its title and category are read: never the filer, the story or an attachment. */
    private function forGrievance(User $user, int $id): array
    {
        $grievance = Grievance::find($id);
        NotFound::unless($grievance !== null);
        abort_unless($user->role === 'SUPER_ADMIN' || ($grievance->organization_id !== null && $grievance->organization_id === $user->organization_id), 403, 'Forbidden.');

        return [
            'subject' => [
                'organization' => $grievance->organization_id ? $this->organizationName($grievance->organization_id) : 'Student Affairs Office',
                // A student can type a student number into a title, so long digit runs are not sent.
                'title' => (string) preg_replace('/\d{6,}/', '[number]', (string) $grievance->title),
                'dates' => 'Filed '.$grievance->created_at?->format('F j, Y'),
            ],
            'prior_remarks' => (string) $grievance->remarks,
        ];
    }

    /** A clearance line the caller may sign or hold: the rules of ClearanceController::canSign. Never the student. */
    private function forClearance(User $user, int $id): array
    {
        $signature = ClearanceSignature::with('clearancePeriod')->find($id);
        NotFound::unless($signature !== null);
        $allowed = match ($signature->required_role) {
            'sao' => $user->role === 'SUPER_ADMIN',
            'department_head' => $user->role === 'DEPARTMENT_HEAD' && in_array($signature->organization_id, $user->scopedOrganizationIds(), true),
            'organization' => in_array($user->role, ['ADMIN', 'SBO_OFFICER'], true) && $user->organization_id === $signature->organization_id,
            default => false,
        };
        abort_unless($allowed, 403, 'Forbidden.');
        abort_if($signature->status === 'cleared', 409, 'This clearance line has already been cleared.');

        $period = $signature->clearancePeriod;
        $line = ['sao' => 'SAO', 'department_head' => 'Department Head', 'organization' => 'Organization'][$signature->required_role] ?? 'Clearance';

        return [
            'subject' => ['organization' => $this->organizationName($signature->organization_id), 'title' => trim(($period?->title ?? 'Clearance').', '.$line.' signature'), 'dates' => (string) ($period?->academic_year ? 'Academic year '.$period->academic_year : '')],
            'prior_remarks' => (string) $signature->remarks,
        ];
    }

    /**
     * Matches each supplied mark to a known requirement by key or by label so the drafter sees the stored name, and lists
     * the known requirements the reviewer did not mark so the drafter can refuse a text that names one.
     *
     * @param  array<int|string, string>  $known  key => label
     * @return array{0: list<array<string, mixed>>, 1: list<string>}
     */
    private function resolveMarks(array $marks, array $known): array
    {
        $resolved = [];
        $named = [];
        foreach ($marks as $mark) {
            $given = trim((string) ($mark['requirement'] ?? ''));
            if ($given === '') {
                continue;
            }
            $label = collect($known)->first(fn ($candidate, $key) => (string) $key === $given || mb_strtolower((string) $candidate) === mb_strtolower($given)) ?? $given;
            $named[mb_strtolower((string) $label)] = true;
            $resolved[] = ['requirement' => (string) $label, 'description' => '', 'mark' => (string) ($mark['mark'] ?? ''), 'note' => trim((string) ($mark['note'] ?? ''))];
        }

        return [$resolved, collect($known)->map(fn ($label) => (string) $label)->reject(fn (string $label) => isset($named[mb_strtolower($label)]))->values()->all()];
    }

    /**
     * What changed since the return, in words and with no file names: the audit rows name the files a submitter replaced.
     *
     * @param  array<int, array<string, string>>  $entries
     * @return list<string>
     */
    private function changeLines(array $entries): array
    {
        return Collection::make($entries)
            ->map(fn (array $entry) => str_starts_with((string) ($entry['field'] ?? ''), 'file:') ? 'A file was replaced or added' : ($entry['label'] ?? '').' changed')
            ->unique()->values()->all();
    }

    private function organizationName(?int $organizationId): string
    {
        return (string) ($organizationId ? Organization::whereKey($organizationId)->value('name') : '');
    }

    private function range(mixed $from, mixed $to): string
    {
        $format = fn (mixed $value) => $value ? Carbon::parse($value)->format('F j, Y') : null;
        $start = $format($from);
        $end = $format($to);

        return match (true) {
            $start === null => (string) $end,
            $end === null || $end === $start => $start,
            default => "{$start} to {$end}",
        };
    }
}
