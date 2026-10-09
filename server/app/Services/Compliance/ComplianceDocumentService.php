<?php

namespace App\Services\Compliance;

use App\Models\AcademicSemester;
use App\Models\ApprovalRequest;
use App\Models\Event;
use App\Models\EventRequirementFile;
use App\Models\FinancialReport;
use App\Models\Organization;
use App\Models\OrganizationComplianceSubmission;
use App\Models\User;
use Illuminate\Support\Collection;

/**
 * One normalized, read-only list of every document an organization has put
 * in front of the university: compliance submissions, event proposal files,
 * submitted financial reports and their supporting documents. Each source is
 * loaded with a fixed number of queries, so the cost does not grow with the
 * row count. open_url values are relative to the API base, like the paths the
 * client already uses for the per-source download routes.
 */
class ComplianceDocumentService
{
    public const SOURCES = ['compliance', 'event_requirement', 'financial_report', 'financial_supporting_document'];

    private const APPROVAL_STATUS = ['approved' => 'approved', 'rejected' => 'returned'];

    private const REPORT_STATUS = [
        'draft' => 'draft',
        'approved' => 'approved',
        'rejected' => 'returned',
    ];

    /**
     * @param  array<int, int>  $organizationIds
     * @return Collection<int, array<string, mixed>> newest submission first
     */
    public function rows(array $organizationIds, ?int $semesterId, ?string $source): Collection
    {
        $semesters = AcademicSemester::all()->keyBy('id');
        $rows = collect();

        if ($source === null || $source === 'compliance') {
            $rows = $rows->concat($this->complianceRows($organizationIds, $semesterId, $semesters));
        }
        if ($source === null || $source === 'event_requirement') {
            $rows = $rows->concat($this->eventRows($organizationIds, $semesterId));
        }
        if ($source === null || in_array($source, ['financial_report', 'financial_supporting_document'], true)) {
            $rows = $rows->concat($this->financialRows($organizationIds, $semesterId, $semesters, $source));
        }

        $organizations = Organization::whereIn('id', $rows->pluck('organization_id')->unique())->get(['id', 'name', 'acronym'])->keyBy('id');
        $names = User::whereIn('school_id', $rows->pluck('submitted_by')->filter()->unique())->get(['school_id', 'first_name', 'last_name'])
            ->mapWithKeys(fn (User $user) => [$user->school_id => trim($user->first_name.' '.$user->last_name)]);

        return $rows->sortByDesc(fn (array $row) => $row['submitted_at']?->getTimestamp() ?? 0)->values()->map(fn (array $row) => [
            'source' => $row['source'],
            'organization' => $organizations->get($row['organization_id'])?->only(['id', 'name', 'acronym']),
            'item' => $row['item'],
            'parent_title' => $row['parent_title'],
            'status' => $row['status'],
            'submitted_at' => $row['submitted_at'],
            'submitted_by_name' => $names->get($row['submitted_by']),
            'reviewed_at' => $row['reviewed_at'],
            'file_name' => $row['file_name'],
            'open_url' => $row['open_url'],
            'academic_semester_id' => $row['academic_semester_id'],
        ]);
    }

    private function complianceRows(array $organizationIds, ?int $semesterId, Collection $semesters): Collection
    {
        return OrganizationComplianceSubmission::whereIn('organization_id', $organizationIds)
            ->when($semesterId, fn ($query) => $query->whereIn('requirement_type_id', fn ($types) => $types->from('compliance_requirement_types')->select('id')->where('academic_semester_id', $semesterId)))
            ->with('requirementType:id,academic_year,academic_semester_id,name')
            ->get(['id', 'organization_id', 'requirement_type_id', 'status', 'file_original_name', 'submitted_by', 'submitted_at', 'reviewed_at'])
            ->map(function (OrganizationComplianceSubmission $submission) use ($semesters) {
                $type = $submission->requirementType;
                $semester = $semesters->get($type->academic_semester_id);

                return [
                    'source' => 'compliance',
                    'organization_id' => $submission->organization_id,
                    'item' => $type->name,
                    'parent_title' => $type->academic_year.($semester ? ', Semester '.$semester->number : ''),
                    'status' => $submission->status,
                    'submitted_at' => $submission->submitted_at,
                    'submitted_by' => $submission->submitted_by,
                    'reviewed_at' => $submission->reviewed_at,
                    'file_name' => $submission->file_original_name,
                    'open_url' => '/compliance/submissions/'.$submission->id.'/document',
                    'academic_semester_id' => $type->academic_semester_id,
                ];
            });
    }

    private function eventRows(array $organizationIds, ?int $semesterId): Collection
    {
        $files = EventRequirementFile::whereIn('organization_id', $organizationIds)
            ->when($semesterId, fn ($query) => $query->whereIn('event_id', fn ($events) => $events->from('events')->select('id')->where('academic_semester_id', $semesterId)))
            ->with('requirement:id,name')
            ->get(['id', 'event_id', 'requirement_id', 'organization_id', 'original_name', 'uploaded_by', 'created_at']);
        $eventIds = $files->pluck('event_id')->unique();
        $events = Event::whereIn('id', $eventIds)->get(['id', 'title', 'academic_semester_id'])->keyBy('id');
        $approvals = $this->latestApprovals('event', $eventIds);

        return $files->map(function (EventRequirementFile $file) use ($events, $approvals) {
            $event = $events->get($file->event_id);
            $approval = $approvals->get($file->event_id);

            return [
                'source' => 'event_requirement',
                'organization_id' => $file->organization_id,
                'item' => $file->requirement->name,
                'parent_title' => $event->title,
                'status' => self::APPROVAL_STATUS[$approval?->status] ?? 'submitted',
                'submitted_at' => $file->created_at,
                'submitted_by' => $file->uploaded_by,
                'reviewed_at' => $approval?->reviewed_at,
                'file_name' => $file->original_name,
                'open_url' => '/events/'.$file->event_id.'/submission/files/'.$file->id,
                'academic_semester_id' => $event->academic_semester_id,
            ];
        });
    }

    private function financialRows(array $organizationIds, ?int $semesterId, Collection $semesters, ?string $source): Collection
    {
        $reports = FinancialReport::whereIn('organization_id', $organizationIds)->whereNotNull('submitted_at')
            ->get(['id', 'organization_id', 'event_id', 'report_type', 'title', 'period_start', 'period_end', 'supporting_documents', 'submission_status', 'submitted_at', 'generated_by', 'department_head_approved_at', 'sao_approved_at']);
        $eventSemesters = Event::whereIn('id', $reports->pluck('event_id')->filter()->unique())->pluck('academic_semester_id', 'id');
        $approvals = $this->latestApprovals('financial_report', $reports->pluck('id'));

        $rows = collect();
        foreach ($reports as $report) {
            $reportSemesterId = $this->reportSemesterId($report, $eventSemesters, $semesters);
            if ($semesterId && $reportSemesterId !== $semesterId) {
                continue;
            }

            $approval = $approvals->get($report->id);
            $row = [
                'organization_id' => $report->organization_id,
                'parent_title' => $report->title,
                'status' => self::REPORT_STATUS[$report->submission_status] ?? 'submitted',
                'submitted_at' => $report->submitted_at,
                'submitted_by' => $approval?->requested_by ?? $report->generated_by,
                'reviewed_at' => $approval?->reviewed_at ?? $report->sao_approved_at ?? $report->department_head_approved_at,
                'academic_semester_id' => $reportSemesterId,
            ];

            if ($source !== 'financial_supporting_document') {
                $period = $report->period_start && $report->period_end
                    ? ', '.$report->period_start->format('M j, Y').' to '.$report->period_end->format('M j, Y')
                    : '';
                $rows->push([
                    ...$row,
                    'source' => 'financial_report',
                    'item' => $report->title,
                    'parent_title' => ucfirst(str_replace('_', ' ', $report->report_type)).$period,
                    'file_name' => $report->title.'.pdf',
                    'open_url' => '/financial-reports/'.$report->id.'/pdf',
                ]);
            }
            if ($source !== 'financial_report') {
                foreach ($report->supporting_documents ?? [] as $index => $document) {
                    $rows->push([
                        ...$row,
                        'source' => 'financial_supporting_document',
                        'item' => $document['name'],
                        'file_name' => $document['name'],
                        'open_url' => '/financial-reports/'.$report->id.'/documents/'.$index,
                    ]);
                }
            }
        }

        return $rows;
    }

    /** Reports carry no academic period, so it comes from their event, else from the semester they were submitted in. */
    private function reportSemesterId(FinancialReport $report, Collection $eventSemesters, Collection $semesters): ?int
    {
        if ($report->event_id && $eventSemesters->get($report->event_id)) {
            return $eventSemesters->get($report->event_id);
        }

        $day = $report->submitted_at->toDateString();

        return $semesters->first(fn (AcademicSemester $semester) => $day >= $semester->starts_on->toDateString() && $day <= $semester->ends_on->toDateString())?->id;
    }

    /** @return Collection<int, ApprovalRequest> keyed by entity id */
    private function latestApprovals(string $entityType, Collection $entityIds): Collection
    {
        return ApprovalRequest::where('entity_type', $entityType)
            ->whereIn('id', fn ($latest) => $latest->from('approval_requests')->selectRaw('max(id)')
                ->where('entity_type', $entityType)->whereIn('entity_id', $entityIds)->groupBy('entity_id'))
            ->get(['id', 'entity_id', 'status', 'requested_by', 'reviewed_at'])
            ->keyBy('entity_id');
    }
}
