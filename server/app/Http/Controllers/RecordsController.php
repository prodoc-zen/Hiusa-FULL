<?php

namespace App\Http\Controllers;

use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\AccountProfile;
use App\Models\Candidate;
use App\Models\College;
use App\Models\Election;
use App\Models\Event;
use App\Models\Organization;
use App\Models\OrganizationApplication;
use App\Models\OrganizationSemesterRecord;
use App\Models\User;
use App\Services\Compliance\ComplianceDocumentService;
use App\Services\ElectionHandoverService;
use App\Services\Records\SemesterSnapshotService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;

/**
 * Read-only archive of a school year period: for each organization what its standing and officers were, and the
 * applications, files, events, elections and financial reports that belong to it. Past periods read from the
 * snapshot written when the semester closed; the current period reads live.
 */
class RecordsController extends Controller
{
    private const LIST_LIMIT = 200;

    public function __construct(
        private readonly ComplianceDocumentService $documents,
        private readonly SemesterSnapshotService $snapshots,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'academic_year_id' => ['nullable', 'integer', 'exists:academic_years,id'],
            'academic_semester_id' => ['nullable', 'integer', 'exists:academic_semesters,id'],
            'organization_id' => ['nullable', 'integer'],
            'search' => ['nullable', 'string', 'max:100'],
        ]);
        $user = $request->user();
        $periods = $this->periods();
        $semester = $this->resolveSemester($data, $periods);

        $payload = ['periods' => $periods, 'semester' => $semester ? $this->semesterPayload($semester) : null, 'organizations' => [], 'organization' => null];
        if (! $semester) {
            return response()->json($payload);
        }

        $scope = $this->scopeIds($request);
        if (in_array($user->role, ['SUPER_ADMIN', 'DEPARTMENT_HEAD'], true)) {
            $payload['organizations'] = $this->organizationList($scope, $semester, $user->role, trim($data['search'] ?? ''));
            $organizationId = $data['organization_id'] ?? null;
        } else {
            $organizationId = $user->organization_id;
        }

        if ($organizationId !== null) {
            abort_unless(in_array((int) $organizationId, $scope, true), 403, 'You cannot open records for that organization.');
            $payload['organization'] = $this->organizationDetail(Organization::findOrFail($organizationId), $semester, $user);
        }

        return response()->json($payload);
    }

    /** @return array<int, int> */
    private function scopeIds(Request $request): array
    {
        $user = $request->user();

        return $user->role === 'SUPER_ADMIN'
            ? Organization::student()->pluck('id')->map(fn ($id) => (int) $id)->all()
            : array_map('intval', $user->scopedOrganizationIds());
    }

    /** Every year that has started, with its semesters, newest year first. */
    private function periods(): Collection
    {
        return AcademicYear::with(['semesters' => fn ($query) => $query->where('status', '!=', 'upcoming')])
            ->orderByDesc('starts_on')->orderByDesc('id')->get()
            ->filter(fn (AcademicYear $year) => $year->semesters->isNotEmpty())
            ->map(fn (AcademicYear $year) => [
                'id' => $year->id,
                'label' => $year->label,
                'semesters' => $year->semesters->map(fn (AcademicSemester $semester) => [
                    'id' => $semester->id,
                    'number' => $semester->number,
                    'status' => $semester->status,
                    'starts_on' => $semester->starts_on?->toDateString(),
                    'ends_on' => $semester->ends_on?->toDateString(),
                ])->values(),
            ])->values();
    }

    private function resolveSemester(array $data, Collection $periods): ?AcademicSemester
    {
        $visible = $periods->flatMap(fn (array $year) => $year['semesters'])->pluck('id');
        $semesterId = $data['academic_semester_id'] ?? null;
        if ($semesterId !== null) {
            abort_unless($visible->contains((int) $semesterId), 404, 'That period has no records yet.');

            return AcademicSemester::with('academicYear')->findOrFail($semesterId);
        }

        if (! empty($data['academic_year_id'])) {
            $year = $periods->firstWhere('id', (int) $data['academic_year_id']);
            abort_unless($year, 404, 'That school year has no records yet.');
            $pick = collect($year['semesters'])->firstWhere('status', 'active') ?? collect($year['semesters'])->last();

            return AcademicSemester::with('academicYear')->findOrFail($pick['id']);
        }

        return AcademicSemester::active() ?? ($visible->isNotEmpty() ? AcademicSemester::with('academicYear')->find($visible->first()) : null);
    }

    private function semesterPayload(AcademicSemester $semester): array
    {
        return [
            'id' => $semester->id,
            'number' => $semester->number,
            'status' => $semester->status,
            'starts_on' => $semester->starts_on?->toDateString(),
            'ends_on' => $semester->ends_on?->toDateString(),
            'academic_year' => ['id' => $semester->academicYear->id, 'label' => $semester->academicYear->label],
            'read_only' => $semester->status === 'completed',
        ];
    }

    /** @param  array<int, int>  $scope */
    private function organizationList(array $scope, AcademicSemester $semester, string $role, string $search): array
    {
        $like = '%'.addcslashes($search, '\\%_').'%';
        $organizations = Organization::student()->whereIn('id', $scope)
            ->when($search !== '', fn ($query) => $query->where(fn ($match) => $match->where('name', 'like', $like)->orWhere('acronym', 'like', $like)))
            ->orderBy('name')->get(['id', 'name', 'acronym', 'college_id', 'lifecycle_status', 'created_at']);
        $ids = $organizations->pluck('id');
        $snapshots = OrganizationSemesterRecord::where('academic_semester_id', $semester->id)->whereIn('organization_id', $ids)->get()->keyBy('organization_id');
        $colleges = College::withTrashed()->whereIn('id', $organizations->pluck('college_id')->filter()->unique())->pluck('name', 'id');
        $live = $semester->status === 'active';
        $events = Event::where('academic_semester_id', $semester->id)->whereIn('organization_id', $ids)->selectRaw('organization_id, count(*) as total')->groupBy('organization_id')->pluck('total', 'organization_id');
        $elections = Election::where('academic_semester_id', $semester->id)->whereIn('organization_id', $ids)->selectRaw('organization_id, count(*) as total')->groupBy('organization_id')->pluck('total', 'organization_id');
        $files = $this->documents->organizationSummaries($ids->all(), $semester->id, null, $role)->mapWithKeys(fn (array $summary) => [$summary['organization']['id'] => $summary['file_count']]);

        return $organizations
            ->reject(fn (Organization $organization) => ! $live && ! $snapshots->has($organization->id) && $organization->created_at?->toDateString() > $semester->ends_on?->toDateString())
            ->map(fn (Organization $organization) => [
                'id' => $organization->id,
                'name' => $organization->name,
                'acronym' => $organization->acronym,
                'college' => $colleges->get($organization->college_id),
                'lifecycle_status' => ($live ? null : $snapshots->get($organization->id)?->lifecycle_status) ?? $organization->lifecycle_status,
                'counts' => [
                    'events' => (int) ($events[$organization->id] ?? 0),
                    'elections' => (int) ($elections[$organization->id] ?? 0),
                    'files' => (int) ($files[$organization->id] ?? 0),
                ],
            ])->values()->all();
    }

    /**
     * An officer limited to some organization areas sees only those areas here too: the org.module middleware
     * cannot map /records, so the sections are cut by hand. Everyone else, and an officer with every area, sees all.
     */
    private function sectionAllowed(User $user, string $module): bool
    {
        if ($user->role !== 'SBO_OFFICER') {
            return true;
        }

        return $user->activeProfile()?->allowsModule($module) ?? true;
    }

    private function organizationDetail(Organization $organization, AcademicSemester $semester, User $user): array
    {
        $role = $user->role;
        $showFinance = $this->sectionAllowed($user, 'finance');
        $showCompliance = $this->sectionAllowed($user, 'compliance');
        $showEvents = $this->sectionAllowed($user, 'events');
        $showElections = $this->sectionAllowed($user, 'elections');
        $snapshot = OrganizationSemesterRecord::where('organization_id', $organization->id)->where('academic_semester_id', $semester->id)->first();
        $live = $semester->status === 'active';
        $useSnapshot = ! $live && $snapshot !== null;
        $files = $this->documents->page([$organization->id], $semester->id, null, $role, null, 1, self::LIST_LIMIT)[0]
            ->map(fn (array $row) => [
                'id' => $row['id'],
                'item' => $row['item'],
                'parent_title' => $row['parent_title'],
                'status' => $row['status'],
                'submitted_at' => $row['submitted_at'],
                'file_name' => $row['file_name'],
                'open_url' => $row['open_url'],
                'family' => $row['family'],
                'source' => $row['source'],
            ]);
        $events = $showEvents
            ? Event::where('organization_id', $organization->id)->where('academic_semester_id', $semester->id)
                ->orderBy('start_time')->limit(self::LIST_LIMIT)->get(['id', 'title', 'status', 'start_time', 'end_time', 'location'])
            : collect();

        return [
            'id' => $organization->id,
            'name' => $organization->name,
            'acronym' => $organization->acronym,
            'college' => $organization->college_id ? College::withTrashed()->whereKey($organization->college_id)->value('name') : null,
            'status' => [
                'lifecycle_status' => $useSnapshot ? $snapshot->lifecycle_status : $organization->lifecycle_status,
                'recorded' => $live || $useSnapshot,
            ],
            'officers' => $useSnapshot ? $snapshot->officers : ($live ? $this->liveOfficers($organization) : []),
            'applications' => $showCompliance ? $this->applications($organization, $semester, $role) : [],
            'documents' => [
                'compliance' => $showCompliance ? $files->where('source', 'compliance')->values() : collect(),
                'event_files' => $showEvents ? $files->where('source', 'event_requirement')->values() : collect(),
                'financial_reports' => $showFinance ? $files->whereIn('source', ['financial_report', 'financial_supporting_document'])->values() : collect(),
            ],
            'events' => $events,
            'elections' => $showElections ? $this->elections($organization, $semester, $role) : [],
        ];
    }

    private function liveOfficers(Organization $organization): array
    {
        $profiles = AccountProfile::where('organization_id', $organization->id)->whereIn('role', ['ADMIN', 'SBO_OFFICER'])->where('account_status', 'active')
            ->with(['user' => fn ($query) => $query->without('organization')->select('school_id', 'first_name', 'last_name')])->get();

        return $this->snapshots->officerRows($profiles);
    }

    private function applications(Organization $organization, AcademicSemester $semester, string $role): array
    {
        $canOpen = in_array($role, ['SUPER_ADMIN', 'DEPARTMENT_HEAD'], true);

        return OrganizationApplication::where('organization_id', $organization->id)
            ->where(fn ($period) => $period
                ->whereHas('documents.requirementType', fn ($type) => $type->where('academic_semester_id', $semester->id))
                ->orWhere(fn ($created) => $created->whereDoesntHave('documents')
                    ->whereDate('created_at', '>=', $semester->starts_on->toDateString())->whereDate('created_at', '<=', $semester->ends_on->toDateString())))
            ->with('documents.requirementType:id,name')->orderBy('created_at')->limit(self::LIST_LIMIT)->get()
            ->map(fn (OrganizationApplication $application) => [
                'id' => $application->id,
                'name' => $application->name,
                'status' => $application->status,
                'submitted_at' => $application->created_at,
                'reviewed_at' => $application->reviewed_at,
                'documents' => $application->documents->map(fn ($document) => [
                    'id' => $document->id,
                    'item' => $document->requirementType?->name,
                    'file_name' => $document->file_original_name,
                    'open_url' => $canOpen ? '/organization-applications/'.$application->id.'/documents/'.$document->id : null,
                ])->values(),
            ])->all();
    }

    private function elections(Organization $organization, AcademicSemester $semester, string $role): array
    {
        $elections = Election::where('organization_id', $organization->id)->where('academic_semester_id', $semester->id)
            ->with('positions')->orderBy('start_time')->limit(self::LIST_LIMIT)->get();
        $showWinners = fn (Election $election) => $election->status === 'closed' && ($election->results_visible || $role !== 'SBO_OFFICER');
        $candidates = Candidate::with('user:school_id,first_name,last_name')->withCount('votes')
            ->whereIn('election_id', $elections->filter($showWinners)->pluck('id'))->get()->keyBy('id');
        $handover = app(ElectionHandoverService::class);

        return $elections->map(fn (Election $election) => [
            'id' => $election->id,
            'title' => $election->title,
            'status' => $election->status,
            'start_time' => $election->start_time,
            'end_time' => $election->end_time,
            'winners' => $showWinners($election) ? $handover->standings($election)->map(fn (array $row) => [
                'position' => $row['position']->title,
                'winners' => $row['winners']
                    ->map(fn (Candidate $winner) => $candidates->get($winner->id))
                    ->map(fn (Candidate $candidate) => ['name' => trim(($candidate->user->first_name ?? '').' '.($candidate->user->last_name ?? '')), 'votes' => $candidate->votes_count])->values(),
                'tie' => $row['tie'],
            ])->values() : null,
        ])->all();
    }
}
