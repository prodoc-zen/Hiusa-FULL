<?php

namespace App\Services\Compliance;

use App\Models\AcademicSemester;
use App\Models\ApprovalRequest;
use App\Models\College;
use App\Models\Event;
use App\Models\EventRequirementFile;
use App\Models\FinancialReport;
use App\Models\Organization;
use App\Models\OrganizationComplianceSubmission;
use App\Models\User;
use App\Services\EventApprovalChain;
use App\Support\FilterValues;
use DateTimeInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * One normalized, read-only list of every document an organization has put
 * in front of the university: compliance submissions, event proposal files,
 * submitted financial reports and their supporting documents. Each source is
 * read with a fixed number of queries, newest first and no further than the
 * requested page reaches, so the cost follows the page and not the table; the
 * total comes from one grouped count per source. open_url values are relative
 * to the API base, like the paths the client already uses for the per-source
 * download routes.
 */
class ComplianceDocumentService
{
    /** Rows a page may reach into (page times page size); a deeper page is refused so one request cannot read a whole table. */
    public const MAX_WINDOW = 2000;

    public const SOURCES = ['compliance', 'event_requirement', 'financial_report', 'financial_supporting_document'];

    /** What the SAO sees in each group: registration, semestral and renewal files all come from the compliance source. */
    public const FAMILIES = ['registration', 'semestral_report', 'semester_renewal', 'event_requirement', 'financial_report', 'financial_supporting_document'];

    /** Organizations whose compliance files are registration documents, decided through the organization review. */
    public const REGISTRATION_LIFECYCLES = ['pending', 'returned'];

    private const FAMILY_SOURCE = [
        'registration' => 'compliance',
        'semestral_report' => 'compliance',
        'semester_renewal' => 'compliance',
        'event_requirement' => 'event_requirement',
        'financial_report' => 'financial_report',
        'financial_supporting_document' => 'financial_supporting_document',
    ];

    /** [status, stage] per EventApprovalChain stage; any other stage is a filed event nobody is reviewing yet. */
    private const EVENT_STATE = [
        'awaiting_department_head' => ['under_review', 'department_head'],
        'awaiting_sao' => ['under_review', 'sao'],
        'approved' => ['approved', null],
        'rejected' => ['returned', 'department_head'],
        'requirements_returned' => ['returned', 'sao'],
    ];

    private const REPORT_STATE = [
        'draft' => ['draft', null],
        'pending_department_head' => ['under_review', 'department_head'],
        'pending_sao' => ['under_review', 'sao'],
        'approved' => ['approved', null],
        'rejected' => ['returned', null],
    ];

    public function __construct(private readonly EventApprovalChain $approvalChain) {}

    private ?string $search = null;

    private function familySource(?string $family): ?string
    {
        $sources = array_unique(array_map(fn ($value) => self::FAMILY_SOURCE[$value], FilterValues::values($family)));

        return count($sources) === 1 ? reset($sources) : null;
    }

    private function matchesSearch(?string $text): bool
    {
        return $this->search === null || str_contains(mb_strtolower($text ?? ''), mb_strtolower($this->search));
    }

    private function searchLike(): string
    {
        return '%'.addcslashes($this->search ?? '', '\\%_').'%';
    }

    /**
     * One page of the list, newest submission first, and how many rows the whole list has. Each source reads
     * only as many rows as the page reaches (callers keep page times page size within MAX_WINDOW).
     *
     * @param  array<int, int>  $organizationIds
     * @return array{0: Collection<int, array<string, mixed>>, 1: int}
     */
    public function page(array $organizationIds, int|string|null $semesterId, ?string $source, ?string $viewerRole, ?string $family, int $page, int $perPage, ?string $search = null): array
    {
        $this->search = trim($search ?? '') ?: null;
        $source ??= $this->familySource($family);
        if ($family && $source !== null && ! in_array($source, array_map(fn ($value) => self::FAMILY_SOURCE[$value], FilterValues::values($family)), true)) {
            return [collect(), 0];
        }

        $total = (int) $this->counts($organizationIds, $semesterId, $source, $viewerRole, $family)->sum('total');
        $rows = $this->collect($organizationIds, $semesterId, $source, $viewerRole, $family, $page * $perPage)->forPage($page, $perPage)->values();
        $names = User::whereIn('school_id', $rows->pluck('submitted_by')->filter()->unique())->get(['school_id', 'first_name', 'last_name'])
            ->mapWithKeys(fn (User $user) => [$user->school_id => trim($user->first_name.' '.$user->last_name)]);

        return [$rows->map(fn (array $row) => [
            'id' => $row['id'],
            'requirement_type_id' => $row['requirement_type_id'] ?? null,
            'allowed_extensions' => $row['allowed_extensions'] ?? null,
            'source' => $row['source'],
            'family' => $row['family'],
            'organization' => $row['organization']?->only(['id', 'name', 'acronym']),
            'organization_lifecycle_status' => $row['organization']?->lifecycle_status,
            'item' => $row['item'],
            'parent_title' => $row['parent_title'],
            'status' => $row['status'],
            'stage' => $row['stage'],
            'submitted_at' => $row['submitted_at'],
            'submitted_by_name' => $names->get($row['submitted_by']),
            'reviewed_at' => $row['reviewed_at'],
            'file_name' => $row['file_name'],
            'open_url' => $row['open_url'],
            'academic_semester_id' => $row['academic_semester_id'],
        ]), $total];
    }

    /**
     * One entry per organization that has at least one file, most recently active first. Counted with one
     * grouped query per source instead of loading the rows, because this is the default landing view.
     *
     * @param  array<int, int>  $organizationIds
     * @return Collection<int, array<string, mixed>>
     */
    public function organizationSummaries(array $organizationIds, int|string|null $semesterId, ?string $source, ?string $viewerRole = null, ?string $family = null): Collection
    {
        $this->search = null;
        $counts = $this->counts($organizationIds, $semesterId, $source ?? ($this->familySource($family)), $viewerRole, $family);

        $organizations = Organization::whereIn('id', $counts->pluck('organization_id')->unique())->get(['id', 'name', 'acronym', 'college_id'])->keyBy('id');
        $colleges = College::whereIn('id', $organizations->pluck('college_id')->filter()->unique())->pluck('name', 'id');

        return $counts->filter(fn (array $count) => $organizations->has($count['organization_id']))
            ->groupBy('organization_id')
            ->map(function (Collection $parts) use ($organizations, $colleges) {
                $organization = $organizations->get($parts->first()['organization_id']);

                return [
                    'organization' => [...$organization->only(['id', 'name', 'acronym']), 'college' => $colleges->get($organization->college_id)],
                    'file_count' => $parts->sum('total'),
                    'latest_submitted_at' => $parts->max(fn (array $part) => $part['latest']?->getTimestamp()),
                ];
            })
            ->sort(fn (array $left, array $right) => strcasecmp($left['organization']['name'], $right['organization']['name']) ?: $left['organization']['id'] <=> $right['organization']['id'])
            ->values()
            ->map(fn (array $summary) => [...$summary, 'latest_submitted_at' => $summary['latest_submitted_at'] ? now()->setTimestamp($summary['latest_submitted_at']) : null]);
    }

    /**
     * Counts per organization and family, one grouped query per source.
     *
     * @return Collection<int, array<string, mixed>>
     */
    private function counts(array $organizationIds, int|string|null $semesterId, ?string $source, ?string $viewerRole, ?string $family): Collection
    {
        $counts = collect();
        if ($source === null || $source === 'compliance') {
            $counts = $counts->concat($this->complianceCounts($organizationIds, $semesterId));
        }
        if ($source === null || $source === 'event_requirement') {
            $counts = $counts->concat($this->eventCounts($organizationIds, $semesterId, $viewerRole));
        }
        if ($source === null || in_array($source, ['financial_report', 'financial_supporting_document'], true)) {
            $counts = $counts->concat($this->financialCounts($organizationIds, $semesterId, $source, $viewerRole));
        }

        return $counts->when($family, fn (Collection $kept) => $kept->whereIn('family', FilterValues::values($family)))->where('total', '>', 0);
    }

    /** SQL twin of settle(): the same registration, semestral and renewal split, so counts match the file list. */
    private const COMPLIANCE_FAMILY_SQL = "case when s.is_registration_document = 1 or o.lifecycle_status in ('pending', 'returned') or (o.submitted_at is not null and s.submitted_at <= o.reviewed_at) then 'registration' when t.category = ? then 'semestral_report' else 'semester_renewal' end";

    private function complianceCounts(array $organizationIds, int|string|null $semesterId): Collection
    {
        return DB::table('organization_compliance_submissions as s')
            ->join('compliance_requirement_types as t', 't.id', '=', 's.requirement_type_id')
            ->join('organizations as o', 'o.id', '=', 's.organization_id')
            ->whereIn('s.organization_id', $organizationIds)
            ->when($this->search !== null, fn ($query) => $query->where(fn ($match) => $match->where('s.file_original_name', 'like', $this->searchLike())->orWhere('t.name', 'like', $this->searchLike())))
            ->when($semesterId, fn ($query) => $query->whereIn('t.academic_semester_id', FilterValues::values($semesterId)))
            ->selectRaw(
                's.organization_id, '.self::COMPLIANCE_FAMILY_SQL.' as family, count(*) as total, max(s.submitted_at) as latest',
                ['semestral_report'],
            )
            ->groupBy('s.organization_id', 'family')
            ->get()
            ->map(fn (object $row) => $this->countPart($row->organization_id, $row->family, $row->total, $row->latest));
    }

    private function eventCounts(array $organizationIds, int|string|null $semesterId, ?string $viewerRole): Collection
    {
        return $this->eventFiles($organizationIds, $semesterId, $viewerRole)
            ->selectRaw('f.organization_id, count(*) as total, max(f.created_at) as latest')->groupBy('f.organization_id')->toBase()->get()
            ->map(fn (object $row) => $this->countPart($row->organization_id, 'event_requirement', $row->total, $row->latest));
    }

    /** Reports and their supporting documents, with the report's period resolved in SQL the way reportSemesterId() does. */
    private function financialCounts(array $organizationIds, int|string|null $semesterId, ?string $source, ?string $viewerRole): Collection
    {
        $query = $this->submittedReports($organizationIds, $semesterId, $viewerRole);
        if ($this->search !== null) {
            $parts = [];
            foreach ($query->select(['organization_id', 'title', 'supporting_documents', 'submitted_at'])->cursor() as $report) {
                $reportMatches = $this->matchesSearch($report->title.'.pdf');
                $documentCount = collect($report->supporting_documents ?? [])->filter(fn ($document) => $this->matchesSearch($document['name'] ?? '') || $this->matchesSearch($report->title))->count();
                if ($source !== 'financial_supporting_document' && $reportMatches) {
                    $parts[] = $this->countPart($report->organization_id, 'financial_report', 1, $report->submitted_at?->toDateTimeString());
                }
                if ($source !== 'financial_report' && $documentCount > 0) {
                    $parts[] = $this->countPart($report->organization_id, 'financial_supporting_document', $documentCount, $report->submitted_at?->toDateTimeString());
                }
            }

            return collect($parts);
        }
        $documents = $this->documentCountSql($query);

        $totals = $query
            ->selectRaw("organization_id, count(*) as reports, coalesce(sum({$documents}), 0) as documents, max(submitted_at) as latest, max(case when {$documents} > 0 then submitted_at end) as documents_latest")
            ->groupBy('organization_id')->toBase()->get();

        $counts = collect();
        foreach ($totals as $row) {
            if ($source !== 'financial_supporting_document') {
                $counts->push($this->countPart($row->organization_id, 'financial_report', $row->reports, $row->latest));
            }
            if ($source !== 'financial_report') {
                $counts->push($this->countPart($row->organization_id, 'financial_supporting_document', $row->documents, $row->documents_latest));
            }
        }

        return $counts;
    }

    /** Submitted reports in scope, including files still awaiting Department Head review. */
    private function submittedReports(array $organizationIds, int|string|null $semesterId, ?string $viewerRole): Builder
    {
        $fileName = DB::connection()->getDriverName() === 'sqlite' ? "(title || '.pdf')" : "concat(title, '.pdf')";
        $period = 'coalesce((select academic_semester_id from events where events.id = financial_reports.event_id), '
            .'(select id from academic_semesters where date(starts_on) <= date(financial_reports.submitted_at) and date(ends_on) >= date(financial_reports.submitted_at) order by id limit 1))';

        return FinancialReport::whereIn('organization_id', $organizationIds)->whereNotNull('submitted_at')
            ->when($this->search !== null, fn ($query) => $query->where(fn ($match) => $match->whereRaw($fileName.' like ?', [$this->searchLike()])->orWhere('supporting_documents', 'like', $this->searchLike())))
            ->when($semesterId, fn ($filtered) => $filtered->whereIn(DB::raw($period), array_map('intval', FilterValues::values($semesterId))));
    }

    private function documentCountSql(Builder $query): string
    {
        return $query->getConnection()->getDriverName() === 'sqlite'
            ? 'json_array_length(supporting_documents)'
            : 'json_length(supporting_documents)';
    }

    private function countPart(mixed $organizationId, string $family, mixed $total, ?string $latest): array
    {
        return ['organization_id' => (int) $organizationId, 'family' => $family, 'total' => (int) $total, 'latest' => $latest ? Carbon::parse($latest) : null];
    }

    /** The newest `$limit` rows of the list, which is every row a page of up to that depth can show. */
    private function collect(array $organizationIds, int|string|null $semesterId, ?string $source, ?string $viewerRole, ?string $family, int $limit, bool $withEventState = true): Collection
    {
        $source ??= $this->familySource($family);
        $semesters = AcademicSemester::all()->keyBy('id');
        $rows = collect();

        if ($source === null || $source === 'compliance') {
            $rows = $rows->concat($this->complianceRows($organizationIds, $semesterId, $family, $limit, $semesters));
        }
        if ($source === null || $source === 'event_requirement') {
            $rows = $rows->concat($this->eventRows($organizationIds, $semesterId, $viewerRole, $withEventState, $limit));
        }
        if ($source === null || in_array($source, ['financial_report', 'financial_supporting_document'], true)) {
            $financialFamilies = array_values(array_intersect(FilterValues::values($family), ['financial_report', 'financial_supporting_document']));
            $financialSource = count($financialFamilies) === 1 ? $financialFamilies[0] : $source;
            $rows = $rows->concat($this->financialRows($organizationIds, $semesterId, $semesters, $financialSource, $viewerRole, $limit));
        }

        $organizations = Organization::whereIn('id', $rows->pluck('organization_id')->unique())->get(['id', 'name', 'acronym', 'college_id', 'lifecycle_status', 'submitted_at', 'reviewed_at'])->keyBy('id');

        return $rows
            ->map(fn (array $row) => $this->settle($row, $organizations->get($row['organization_id'])))
            ->when($family, fn (Collection $settled) => $settled->whereIn('family', FilterValues::values($family)))
            ->sortByDesc(fn (array $row) => $row['submitted_at']?->getTimestamp() ?? 0)
            ->values();
    }

    /**
     * The one rule for what counts as a registration document, shared by Track documents and the review queue.
     * A file filed before the SAO approved the registration stays a registration document after the organization turns active.
     */
    public function isRegistrationFile(?Organization $organization, ?DateTimeInterface $submittedAt, bool $marked = false): bool
    {
        if ($marked) {
            return true;
        }
        if (in_array($organization?->lifecycle_status, self::REGISTRATION_LIFECYCLES, true)) {
            return true;
        }

        return (bool) ($organization?->submitted_at && $organization->reviewed_at && $submittedAt && Carbon::instance($submittedAt)->lessThanOrEqualTo($organization->reviewed_at));
    }

    /** Compliance rows split into registration, semestral and renewal once the organization is known. */
    private function settle(array $row, ?Organization $organization): array
    {
        $row['organization'] = $organization;
        if ($row['source'] !== 'compliance') {
            return $row;
        }

        $row['family'] = match (true) {
            $this->isRegistrationFile($organization, $row['submitted_at'], $row['is_registration_document'] ?? false) => 'registration',
            $row['is_semestral'] => 'semestral_report',
            default => 'semester_renewal',
        };
        if ($row['status'] === 'submitted') {
            [$row['status'], $row['stage']] = [$organization?->lifecycle_status === 'returned' ? 'returned' : 'under_review', 'sao'];
        }

        return $row;
    }

    private function complianceRows(array $organizationIds, int|string|null $semesterId, ?string $family, int $limit, Collection $semesters): Collection
    {
        return OrganizationComplianceSubmission::from('organization_compliance_submissions as s')
            ->join('compliance_requirement_types as t', 't.id', '=', 's.requirement_type_id')
            ->join('organizations as o', 'o.id', '=', 's.organization_id')
            ->whereIn('s.organization_id', $organizationIds)
            ->when($this->search !== null, fn ($query) => $query->where(fn ($match) => $match->where('s.file_original_name', 'like', $this->searchLike())->orWhere('t.name', 'like', $this->searchLike())))
            ->when($semesterId, fn ($query) => $query->whereIn('t.academic_semester_id', FilterValues::values($semesterId)))
            ->when($family, fn ($query) => $query->whereIn(DB::raw(str_replace('?', "'semestral_report'", self::COMPLIANCE_FAMILY_SQL)), FilterValues::values($family)))
            ->with('requirementType:id,academic_year,academic_semester_id,name,category')
            ->orderByDesc('s.submitted_at')->orderByDesc('s.id')->limit($limit)
            ->get(['s.id', 's.organization_id', 's.requirement_type_id', 's.status', 's.file_original_name', 's.is_registration_document', 's.submitted_by', 's.submitted_at', 's.reviewed_at'])
            ->map(function (OrganizationComplianceSubmission $submission) use ($semesters) {
                $type = $submission->requirementType;
                $semester = $semesters->get($type->academic_semester_id);

                return [
                    'id' => $submission->id,
                    'requirement_type_id' => $submission->requirement_type_id,
                    'allowed_extensions' => $type->acceptedExtensions(),
                    'source' => 'compliance',
                    'family' => 'semester_renewal',
                    'is_semestral' => $type->category === 'semestral_report',
                    'is_registration_document' => $submission->is_registration_document,
                    'organization_id' => $submission->organization_id,
                    'item' => $type->name,
                    'parent_title' => $type->academic_year.($semester ? ', Semester '.$semester->number : ''),
                    'status' => $submission->status,
                    'stage' => null,
                    'submitted_at' => $submission->submitted_at,
                    'submitted_by' => $submission->submitted_by,
                    'reviewed_at' => $submission->reviewed_at,
                    'file_name' => $submission->file_original_name,
                    'open_url' => '/compliance/submissions/'.$submission->id.'/document',
                    'academic_semester_id' => $type->academic_semester_id,
                ];
            });
    }

    private function eventFiles(array $organizationIds, int|string|null $semesterId, ?string $viewerRole): Builder
    {
        // Joins, not IN subselects: with every organization in scope the optimizer turned the two subselects into a
        // loose scan joined to events through a block nested loop, which is quadratic. Each join below is on an indexed
        // key, so the cost follows the rows read. The distinct derived table keeps an event with several SAO reviews to one row.
        return EventRequirementFile::from('event_requirement_files as f')
            ->whereIn('f.organization_id', $organizationIds)
            ->when($semesterId, fn ($query) => $query->join('events as e', 'e.id', '=', 'f.event_id')->whereIn('e.academic_semester_id', FilterValues::values($semesterId)))
            ->when($this->search !== null, function ($query) use ($semesterId) {
                if (! $semesterId) {
                    $query->join('events as e', 'e.id', '=', 'f.event_id');
                }
                $query->join('event_requirements as r', 'r.id', '=', 'f.requirement_id')
                    ->where(fn ($match) => $match->where('f.original_name', 'like', $this->searchLike())->orWhere('r.name', 'like', $this->searchLike())->orWhere('e.title', 'like', $this->searchLike()));
            })
            // The SAO repository includes files sent to the Department Head, before SAO review starts.
            ->when($viewerRole === 'SUPER_ADMIN', fn ($query) => $query->joinSub(
                DB::table('approval_requests')->select('entity_id')->distinct()->where('entity_type', 'event'),
                'sao_review',
                'sao_review.entity_id',
                '=',
                'f.event_id',
            ));
    }

    private function eventRows(array $organizationIds, int|string|null $semesterId, ?string $viewerRole, bool $withState, int $limit): Collection
    {
        $files = $this->eventFiles($organizationIds, $semesterId, $viewerRole)
            ->with('requirement:id,name')
            ->orderByDesc('f.created_at')->orderByDesc('f.id')->limit($limit)
            ->get(['f.id', 'f.event_id', 'f.requirement_id', 'f.organization_id', 'f.original_name', 'f.uploaded_by', 'f.created_at']);
        $eventIds = $files->pluck('event_id')->unique();
        $events = Event::whereIn('id', $eventIds)->get(['id', 'title', 'academic_semester_id', 'planning_details', 'approved_at'])->keyBy('id');
        $stages = $withState ? $this->approvalChain->describe($events) : [];
        $approvals = $withState ? $this->latestApprovals('event', $eventIds) : collect();

        return $files->map(function (EventRequirementFile $file) use ($events, $stages, $approvals) {
            $event = $events->get($file->event_id);
            [$status, $stage] = self::EVENT_STATE[$stages[$file->event_id]['approval_stage'] ?? null] ?? ['submitted', null];

            return [
                'id' => $file->id,
                'source' => 'event_requirement',
                'family' => 'event_requirement',
                'organization_id' => $file->organization_id,
                'item' => $file->requirement?->name,
                'parent_title' => $event?->title,
                'status' => $status,
                'stage' => $stage,
                'submitted_at' => $file->created_at,
                'submitted_by' => $file->uploaded_by,
                'reviewed_at' => $approvals->get($file->event_id)?->reviewed_at,
                'file_name' => $file->original_name,
                'open_url' => '/events/'.$file->event_id.'/submission/files/'.$file->id,
                'academic_semester_id' => $event?->academic_semester_id,
            ];
        });
    }

    /** A report yields at least one row of the kind asked for, so `$limit` reports are enough for `$limit` rows. */
    private function financialRows(array $organizationIds, int|string|null $semesterId, Collection $semesters, ?string $source, ?string $viewerRole, int $limit): Collection
    {
        $query = $this->submittedReports($organizationIds, $semesterId, $viewerRole);
        $reports = $query
            ->when($source === 'financial_supporting_document', fn ($withDocuments) => $withDocuments->whereRaw($this->documentCountSql($query).' > 0'))
            ->orderByDesc('submitted_at')->orderByDesc('id')
            ->when($this->search === null, fn ($bounded) => $bounded->limit($limit))
            ->get(['id', 'organization_id', 'event_id', 'report_type', 'title', 'period_start', 'period_end', 'supporting_documents', 'submission_status', 'submitted_at', 'generated_by', 'department_head_approved_at', 'sao_approved_at']);
        $eventSemesters = Event::whereIn('id', $reports->pluck('event_id')->filter()->unique())->pluck('academic_semester_id', 'id');
        $approvals = $this->latestApprovals('financial_report', $reports->pluck('id'));

        $rows = collect();
        foreach ($reports as $report) {
            $reportSemesterId = $this->reportSemesterId($report, $eventSemesters, $semesters);

            $approval = $approvals->get($report->id);
            [$status, $stage] = self::REPORT_STATE[$report->submission_status] ?? ['submitted', null];
            $row = [
                'organization_id' => $report->organization_id,
                'parent_title' => $report->title,
                'status' => $status,
                'stage' => $stage,
                'submitted_at' => $report->submitted_at,
                'submitted_by' => $approval?->requested_by ?? $report->generated_by,
                'reviewed_at' => $approval?->reviewed_at ?? $report->sao_approved_at ?? $report->department_head_approved_at,
                'academic_semester_id' => $reportSemesterId,
            ];

            if ($source !== 'financial_supporting_document' && $this->matchesSearch($report->title.'.pdf')) {
                $period = $report->period_start && $report->period_end
                    ? ', '.$report->period_start->format('M j, Y').' to '.$report->period_end->format('M j, Y')
                    : '';
                $rows->push([
                    ...$row,
                    'id' => $report->id,
                    'source' => 'financial_report',
                    'family' => 'financial_report',
                    'item' => $report->title,
                    'parent_title' => ucfirst(str_replace('_', ' ', $report->report_type)).$period,
                    'file_name' => $report->title.'.pdf',
                    'open_url' => '/financial-reports/'.$report->id.'/pdf?inline=1',
                ]);
            }
            if ($source !== 'financial_report') {
                foreach ($report->supporting_documents ?? [] as $index => $document) {
                    if (! $this->matchesSearch($document['name'] ?? '') && ! $this->matchesSearch($report->title)) {
                        continue;
                    }
                    $rows->push([
                        ...$row,
                        'id' => $report->id.'-'.$index,
                        'source' => 'financial_supporting_document',
                        'family' => 'financial_supporting_document',
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
