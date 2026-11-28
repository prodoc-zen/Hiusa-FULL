<?php

namespace App\Services;

use App\Models\Announcement;
use App\Models\ApprovalRequest;
use App\Models\AuditLog;
use App\Models\Budget;
use App\Models\Election;
use App\Models\Event;
use App\Models\FinancialReport;
use App\Models\OrganizationApplication;
use App\Models\OrganizationComplianceSubmission;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/**
 * What an organization changed after a reviewer returned its work, or after a reviewer's own approval was taken
 * back by an edit, read from the audit log so no second record of it exists. Every method returns a list of {field, label, before?, after?}: before and after
 * only when both are short enough to read in a line, and never for files, which are named in the label.
 * A reviewer gets the list on the screen they decide from; the submitter never does.
 */
class ChangesSinceReturn
{
    private const SHORT = 80;

    /** Flows that open a new approval row, not the old one again, when work comes back to a reviewer, and which decisions on the earlier rows anchor the list. */
    private const NEW_ROW_FLOWS = ['financial_report' => ['rejected'], 'election' => ['approved', 'rejected'], 'budget' => ['approved']];

    /** Where each approval flow keeps the audit rows that say what its submitter edited. */
    private const SOURCES = [
        'event' => ['module' => 'events', 'class' => Event::class, 'actions' => ['event_updated', 'event_file_replaced', 'event_file_added']],
        'budget' => ['module' => 'budgets', 'class' => Budget::class, 'actions' => ['updated']],
        'announcement' => ['module' => 'announcements', 'class' => Announcement::class, 'actions' => ['updated']],
        'election' => ['module' => 'elections', 'class' => Election::class, 'actions' => ['updated']],
        'financial_report' => ['module' => 'financial_reports', 'class' => FinancialReport::class, 'actions' => ['submitted']],
    ];

    /** The audited fields worth naming to a reviewer. Anything not listed is bookkeeping and stays out. */
    private const LABELS = [
        'event' => [
            'title' => 'Title', 'description' => 'Description', 'start_time' => 'Start', 'end_time' => 'End', 'location' => 'Location',
            'requires_budget' => 'Budget requirement', 'image_url' => 'Poster',
            'planning_details.event_type' => 'Event type', 'planning_details.expected_participants' => 'Expected participants',
            'planning_details.venue_type' => 'Venue type', 'planning_details.venue_id' => 'Venue',
            'planning_details.proposed_budget_amount' => 'Proposed budget', 'planning_details.budget_warning_threshold' => 'Budget warning threshold',
            'planning_details.budget_notes' => 'Budget notes', 'planning_details.vendor_deadlines' => 'Vendor deadlines',
            'planning_details.logistics_checklist' => 'Logistics checklist', 'planning_details.requirements' => 'Requirements',
            'planning_details.resources' => 'Resources',
        ],
        'budget' => [
            'title' => 'Title', 'allocated_amount' => 'Allocated amount', 'warning_threshold' => 'Warning threshold',
            'event_id' => 'Linked event', 'financial_semester_id' => 'Financial semester',
        ],
        'announcement' => [
            'title' => 'Title', 'body' => 'Message', 'target_role' => 'Audience', 'category' => 'Category', 'image_url' => 'Image',
            'is_pinned' => 'Pinned', 'is_important' => 'Marked important',
        ],
        'election' => [
            'title' => 'Title', 'description' => 'Description', 'room' => 'Room', 'image_url' => 'Image',
            'start_time' => 'Voting opens', 'end_time' => 'Voting closes',
            'filing_starts_at' => 'Filing opens', 'filing_ends_at' => 'Filing closes',
            'screening_starts_at' => 'Screening opens', 'screening_ends_at' => 'Screening closes',
            'campaign_starts_at' => 'Campaign opens', 'campaign_ends_at' => 'Campaign closes',
            'results_publish_at' => 'Results published', 'rules' => 'Rules', 'tie_break_rule' => 'Tie break rule',
            'min_units' => 'Minimum units', 'min_gpa' => 'Minimum GPA',
        ],
    ];

    private const APPLICATION_LABELS = ['name' => 'Organization name', 'acronym' => 'Acronym', 'description' => 'Description', 'position_title' => 'Position title'];

    /**
     * What the event form writes for a field the person never filled in. A record that never had the field and
     * one holding its default are the same, so saving the form over an old record is not a change of these.
     */
    private const DEFAULTS = [
        'planning_details.venue_type' => 'off_campus',
        'planning_details.proposed_budget_amount' => 0,
        'planning_details.budget_warning_threshold' => 0,
    ];

    /** Fields that hold a fixed choice, shown as the label the screen uses. */
    private const CHOICES = [
        'planning_details.venue_type' => ['on_campus' => 'On campus', 'off_campus' => 'Off campus'],
    ];

    /** Fields whose value is an id, a link or a structure, so naming the field says more than showing it. */
    private const NO_VALUES = ['image_url', 'planning_details.venue_id', 'event_id', 'financial_semester_id', 'rules'];

    /**
     * For every approval still waiting on a reviewer whose last decision was a return or their own approval.
     *
     * @param  Collection<int, ApprovalRequest>  $approvals
     * @return array<int, list<array<string, string>>> keyed by approval id
     */
    public function forApprovals(Collection $approvals): array
    {
        return array_map(fn (array $described) => $described['changes'], $this->describeApprovals($approvals));
    }

    /**
     * The same lists with what they are measured from: 'returned' when the reviewer sent the work back,
     * 'approved' when the reviewer had approved it and an edit then put it in front of them again.
     *
     * @param  Collection<int, ApprovalRequest>  $approvals
     * @return array<int, array{since: string, changes: list<array<string, string>>}> keyed by approval id
     */
    public function describeApprovals(Collection $approvals): array
    {
        $pending = $approvals->filter(fn (ApprovalRequest $approval) => $approval->status === 'pending' && isset(self::SOURCES[$approval->entity_type]));
        $anchors = $pending->isEmpty() ? [] : $this->returns($pending);
        $changes = [];
        foreach ($pending->filter(fn (ApprovalRequest $approval) => isset($anchors[$approval->id]))->groupBy('entity_type') as $type => $group) {
            $source = self::SOURCES[$type];
            $rows = AuditLog::where('module', $source['module'])->where('record_type', $source['class'])
                ->whereIn('record_id', $group->pluck('entity_id')->unique()->all())->whereIn('action', $source['actions'])
                ->where('id', '>', $group->map(fn (ApprovalRequest $approval) => $anchors[$approval->id]->id)->min())
                ->orderBy('id')->get()->groupBy('record_id');
            foreach ($group as $approval) {
                $since = ($rows->get($approval->entity_id) ?? collect())->filter(fn (AuditLog $row) => $row->id > $anchors[$approval->id]->id)->values();
                $changes[$approval->id] = ['since' => $anchors[$approval->id]->action === 'reviewed_approved' ? 'approved' : 'returned', 'changes' => $type === 'financial_report'
                    ? $this->addedDocuments($since)
                    : [...$this->diff($since->reject(fn (AuditLog $row) => str_starts_with($row->action, 'event_file_')), self::LABELS[$type]),
                        ...$this->fileChanges($since->filter(fn (AuditLog $row) => str_starts_with($row->action, 'event_file_')), 'original_name', 'requirement')]];
            }
        }

        return $changes;
    }

    /**
     * An application sent again after a return, as its reviewers see it. Applications sent again before
     * the details were recorded show nothing rather than a guess.
     *
     * @return list<array<string, string>>
     */
    public function forApplication(OrganizationApplication $application): array
    {
        if ($application->round < 2 || ! in_array($application->status, ['pending_dean', 'pending_sao'], true)) {
            return [];
        }
        $log = AuditLog::where('module', 'organization_applications')->where('action', 'resubmitted')
            ->where('record_type', OrganizationApplication::class)->where('record_id', $application->id)->latest('id')->first();
        if (! $log) {
            return [];
        }

        return [
            ...$this->diff(collect([$log]), self::APPLICATION_LABELS),
            ...collect($log->new_values['documents'] ?? [])->map(fn (array $document) => $this->fileEntry($document['requirement'] ?? '', $document['name'] ?? null, $document['previous_name'] ?? null))->all(),
        ];
    }

    /**
     * For every compliance file waiting on review whose last decision was a return.
     *
     * @param  Collection<int, OrganizationComplianceSubmission>  $submissions
     * @return array<int, list<array<string, string>>> keyed by submission id
     */
    public function forSubmissions(Collection $submissions): array
    {
        $pending = $submissions->where('status', 'submitted');
        if ($pending->isEmpty()) {
            return [];
        }
        $logs = AuditLog::where('module', 'compliance')->where('record_type', OrganizationComplianceSubmission::class)
            ->whereIn('record_id', $pending->pluck('id')->all())
            ->whereIn('action', ['submission_approved', 'submission_returned', 'submission_resubmitted', 'submission_document_replaced'])
            ->orderBy('id')->get()->groupBy('record_id');

        $changes = [];
        foreach ($pending as $submission) {
            $rows = $logs->get($submission->id) ?? collect();
            $decision = $rows->filter(fn (AuditLog $row) => in_array($row->action, ['submission_approved', 'submission_returned'], true))->last();
            if ($decision?->action !== 'submission_returned') {
                continue;
            }
            $changes[$submission->id] = $this->fileChanges(
                $rows->filter(fn (AuditLog $row) => $row->id > $decision->id && in_array($row->action, ['submission_resubmitted', 'submission_document_replaced'], true)),
                'file_original_name',
                null,
                true,
            );
        }

        return $changes;
    }

    /**
     * The latest decision of each pending approval when it was a return, or an approval that an edit has since taken back.
     * A financial report is submitted as a new row each time, and an approved election that changes gets a new row, so
     * the decision sits on an earlier row.
     */
    private function returns(Collection $pending): array
    {
        $earlier = collect();
        foreach (self::NEW_ROW_FLOWS as $type => $decisions) {
            $rows = $pending->where('entity_type', $type);
            if ($rows->isNotEmpty()) {
                $earlier = $earlier->concat(ApprovalRequest::where('entity_type', $type)->whereIn('status', $decisions)
                    ->whereIn('entity_id', $rows->pluck('entity_id')->unique()->all())->get(['id', 'entity_type', 'entity_id']));
            }
        }
        $candidates = $pending->mapWithKeys(fn (ApprovalRequest $approval) => [$approval->id => isset(self::NEW_ROW_FLOWS[$approval->entity_type])
            ? $earlier->where('entity_type', $approval->entity_type)->where('entity_id', $approval->entity_id)->where('id', '<', $approval->id)->pluck('id')->push($approval->id)->all()
            : [$approval->id]]);
        $logs = AuditLog::where('module', 'approvals')->where('record_type', ApprovalRequest::class)
            ->whereIn('action', ['reviewed_approved', 'reviewed_rejected'])->whereIn('record_id', $candidates->flatten()->all())
            ->orderBy('id')->get();

        $anchors = [];
        foreach ($candidates as $approvalId => $ids) {
            $latest = $this->ownDecisions($logs->whereIn('record_id', $ids), $pending->firstWhere('id', $approvalId))->last();
            if ($latest !== null) {
                $anchors[$approvalId] = $latest;
            }
        }

        return $anchors;
    }

    /**
     * A budget can pass through two reviewers, and the later one's decision sits on the same row the earlier one is sent
     * back to, so a decision counts for the reviewer in front of the budget only when a reviewer of that stage made it.
     */
    private function ownDecisions(Collection $decisions, ApprovalRequest $approval): Collection
    {
        $final = config('approvals.budget_final');
        if ($approval->entity_type !== 'budget' || ! $final) {
            return $decisions;
        }

        return $decisions->filter(fn (AuditLog $log) => ($log->actor_role === $final) === ($approval->required_role === $final));
    }

    /**
     * The fields that differ between the first old value and the last new value across the rows, in the
     * order they were first touched. A field put back to what it was is not a change.
     *
     * @param  Collection<int, AuditLog>  $rows
     * @param  array<string, string>  $labels
     * @return list<array<string, string>>
     */
    private function diff(Collection $rows, array $labels): array
    {
        $span = [];
        foreach ($rows as $row) {
            $old = $this->flatten($row->old_values ?? []);
            $new = $this->flatten($row->new_values ?? []);
            foreach ($new as $key => $after) {
                if (! isset($labels[$key])) {
                    continue;
                }
                $span[$key] = [array_key_exists($key, $span) ? $span[$key][0] : ($old[$key] ?? null), $after];
            }
        }

        $changes = [];
        foreach ($span as $key => [$before, $after]) {
            if (! $this->same($key, $before, $after)) {
                $changes[] = $this->entry($key, $labels[$key], $before, $after);
            }
        }

        return $changes;
    }

    /** Planning details are one structure in the record; each of its parts is a field here. */
    private function flatten(array $values): array
    {
        foreach (is_array($values['planning_details'] ?? null) ? $values['planning_details'] : [] as $key => $value) {
            $values['planning_details.'.$key] = $value;
        }
        unset($values['planning_details']);

        return $values;
    }

    /** One entry per replaced or added file: the first name it had since the return and the last it was given. */
    private function fileChanges(Collection $rows, string $nameKey, ?string $groupKey, bool $replacing = false): array
    {
        return $rows->groupBy(fn (AuditLog $row) => $groupKey ? ($row->new_values[$groupKey] ?? '') : '')->map(function (Collection $group, string $key) use ($nameKey, $replacing) {
            $previous = $group->first()->old_values[$nameKey] ?? null;
            $current = $group->last()->new_values[$nameKey] ?? null;

            return $this->fileEntry($key, $current, $previous ?? ($replacing ? '' : null));
        })->values()->all();
    }

    private function fileEntry(string $key, ?string $new, ?string $old): array
    {
        $label = match (true) {
            $new !== null && $old === '' => "{$new} replaced the returned file",
            $new !== null && $old !== null => "{$new} replaced {$old}",
            $new !== null => "{$new} added",
            default => "{$old} removed",
        };

        return ['field' => 'file:'.($key !== '' ? $key : ($new ?? $old)), 'label' => $label];
    }

    /** @param  Collection<int, AuditLog>  $rows */
    private function addedDocuments(Collection $rows): array
    {
        if ($rows->isEmpty()) {
            return [];
        }
        $before = $rows->first()->old_values['document_names'] ?? [];

        return collect(array_diff($rows->last()->new_values['document_names'] ?? [], $before))
            ->map(fn (string $name) => $this->fileEntry('', $name, null))->values()->all();
    }

    private function entry(string $key, string $label, mixed $before, mixed $after): array
    {
        $entry = ['field' => $key, 'label' => $label];
        $shownBefore = in_array($key, self::NO_VALUES, true) ? null : $this->display($key, $before);
        $shownAfter = in_array($key, self::NO_VALUES, true) ? null : $this->display($key, $after);
        if ($shownBefore !== null && $shownAfter !== null && mb_strlen($shownBefore) <= self::SHORT && mb_strlen($shownAfter) <= self::SHORT) {
            $entry['before'] = $shownBefore;
            $entry['after'] = $shownAfter;
        }

        return $entry;
    }

    private function same(string $key, mixed $before, mixed $after): bool
    {
        if (array_key_exists($key, self::DEFAULTS)) {
            $before = $this->plain($before) === '' ? self::DEFAULTS[$key] : $before;
            $after = $this->plain($after) === '' ? self::DEFAULTS[$key] : $after;
        }
        if (is_numeric($before) && is_numeric($after)) {
            return (float) $before === (float) $after;
        }

        return $this->plain($before) === $this->plain($after);
    }

    private function plain(mixed $value): string
    {
        return is_array($value) ? (string) json_encode($value) : trim((string) ($value ?? ''));
    }

    /** The value as a person would read it, or null when it is a structure with no one-line form. */
    private function display(string $key, mixed $value): ?string
    {
        if (is_array($value)) {
            return null;
        }
        if (is_bool($value)) {
            return $value ? 'Yes' : 'No';
        }
        $text = trim((string) ($value ?? ''));
        if (isset(self::CHOICES[$key][$text])) {
            return self::CHOICES[$key][$text];
        }
        if ($text !== '' && (str_ends_with($key, '_time') || str_ends_with($key, '_at'))) {
            try {
                return Carbon::parse($text)->timezone(config('app.timezone'))->format('M j, Y g:i A');
            } catch (\Throwable) {
                return $text;
            }
        }

        return $text;
    }
}
