<?php

namespace Tests\Feature;

use App\Http\Middleware\EnsureRole;
use App\Models\AcademicSemester;
use App\Models\AcademicYear;
use App\Models\AccountProfile;
use App\Models\Announcement;
use App\Models\ApprovalRequest;
use App\Models\Attendance;
use App\Models\Budget;
use App\Models\Candidate;
use App\Models\CashAdvance;
use App\Models\ClearancePeriod;
use App\Models\ClearanceSignature;
use App\Models\Collection;
use App\Models\ComplianceRequirementType;
use App\Models\DepartmentHeadInvitation;
use App\Models\Election;
use App\Models\ElectionPosition;
use App\Models\Event;
use App\Models\EventRegistration;
use App\Models\EventRequirement;
use App\Models\EventRequirementFile;
use App\Models\FinancialForecast;
use App\Models\FinancialReport;
use App\Models\Organization;
use App\Models\OrganizationApplicantGrant;
use App\Models\OrganizationApplication;
use App\Models\OrganizationApplicationDocument;
use App\Models\OrganizationApplicationReviewFile;
use App\Models\OrganizationComplianceSubmission;
use App\Models\Partylist;
use App\Models\StudentRegistryEntry;
use App\Models\Transaction;
use App\Models\User;
use App\Models\Vote;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

/**
 * Office staff carry role ADMIN with the dean's scope, so any check that reads the role and forgets the scope hands
 * them the wrong view. This walks every GET route the dean can reach on one seeded college and holds the staff
 * member to the dean's answer, then pins the four cases that were proven wrong one by one.
 */
class OfficeStaffParityTest extends TestCase
{
    use CreatesCollegeFixtures, RefreshDatabase;

    /** Routes the walk cannot fill from the fixture. Empty on purpose: a route that cannot be filled is listed here, not hidden. */
    private const UNFILLED = [];

    /**
     * Listings the fixture must keep filled for the dean. A listing that answers the dean 0 rows passes the row-count
     * half of the walk for any scope, so each named one has to hold at least this many rows for the dean.
     */
    private const FLOORS = [
        '/api/events' => 4,
        '/api/elections' => 2,
        '/api/announcements' => 2,
        '/api/transactions' => 4,
        '/api/financial-reports' => 1,
        '/api/approval-requests' => 1,
        '/api/budgets' => 2,
        '/api/collections' => 2,
        '/api/cash-advances' => 2,
        '/api/forecasts' => 2,
        '/api/partylists' => 2,
    ];

    /**
     * Writes the dean can reach that office staff may also make, on purpose: the dean's approval step, review of
     * applications, the college's announcements, and the account's own settings. Any other write the dean can reach
     * belongs on EnsureRole::DEAN_ONLY, so a new route has to be placed on one list or the other.
     */
    private const OPEN_TO_STAFF = [
        'DELETE api/ai/assistant/conversations',
        'DELETE api/ai/assistant/conversations/{conversation}',
        'DELETE api/ai/assistant/memories',
        'DELETE api/ai/assistant/memories/{memory}',
        'DELETE api/announcements/{id}',
        'DELETE api/announcements/{id}/reaction',
        'DELETE api/events/{id}/registrations/mine',
        'DELETE api/organization-applications/{application}/review-files/{file}',
        'PATCH api/ai/assistant/conversations/{conversation}',
        'PATCH api/announcements/{id}/publish',
        'PATCH api/approval-requests/{id}',
        'PATCH api/notifications/read-all',
        'PATCH api/notifications/{id}/read',
        'PATCH api/organization-applications/{application}/review',
        'POST api/ai/assistant/ask',
        'POST api/ai/assistant/chat',
        'POST api/ai/assistant/memories',
        'POST api/ai/assistant/messages/{message}/action/cancel',
        'POST api/ai/assistant/messages/{message}/action/confirm',
        'POST api/ai/assistant/messages/{message}/feedback',
        'POST api/announcements',
        'POST api/announcements/{id}/view',
        'POST api/department-head-invitations/{token}/claim',
        'POST api/elections/{id}/positions/{position}/tie-resolution',
        'POST api/events/{id}/registrations',
        'POST api/logout',
        'POST api/my/organization-applications',
        'POST api/my/organization-applications/{application}/resubmit',
        'POST api/organization-applications/{application}/comments',
        'POST api/organization-applications/{application}/review-files',
        'POST api/user/profiles/{profile}/switch',
        'PUT api/announcements/{id}',
        'PUT api/announcements/{id}/reaction',
        'PUT api/user/notification-preferences',
        'PUT api/user/password',
        'PUT api/user/profile',
    ];

    private AcademicSemester $semester;

    private User $dean;

    private User $staff;

    private Organization $home;

    private Organization $psits;

    private Organization $compsoc;

    private Organization $artsClub;

    /** @var array<string, mixed> */
    private array $ids = [];

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        // The walk makes a few hundred requests a minute as two users; the limiters are not what it measures.
        config(['performance.rate_limits.read_per_minute' => 100000, 'performance.rate_limits.write_per_minute' => 100000, 'performance.rate_limits.people_search_per_minute' => 100000]);

        $year = AcademicYear::create(['label' => '2026-2027', 'starts_on' => now()->subMonths(3)->toDateString(), 'ends_on' => now()->addMonths(6)->toDateString(), 'is_current' => true]);
        $this->semester = AcademicSemester::create(['academic_year_id' => $year->id, 'number' => 1, 'starts_on' => now()->subMonths(3)->toDateString(), 'ends_on' => now()->addMonths(6)->toDateString(), 'status' => 'active']);

        $computing = $this->makeCollege('COC');
        $arts = $this->makeCollege('CAS');
        $this->home = $this->makeCollegeHome($computing);
        $this->makeCollegeHome($arts);
        $this->psits = $this->makeCollegeStudentOrganization($computing, ['name' => 'PSITS']);
        $this->compsoc = $this->makeCollegeStudentOrganization($computing, ['name' => 'CompSoc']);
        $this->artsClub = $this->makeCollegeStudentOrganization($arts, ['name' => 'Arts Club']);
        $this->dean = $this->makeCollegeHead($computing);
        $this->staff = User::factory()->admin()->create(['organization_id' => $this->home->id, 'position_title' => 'College Secretary']);

        $this->seedCollege($computing->id, $arts->id);
    }

    private function seedCollege(int $computingId, int $artsId): void
    {
        $adviser = User::factory()->admin()->create(['organization_id' => $this->psits->id]);
        $compsocAdviser = User::factory()->admin()->create(['organization_id' => $this->compsoc->id]);
        $artsAdviser = User::factory()->admin()->create(['organization_id' => $this->artsClub->id]);
        $students = User::factory()->student()->count(3)->create(['organization_id' => $this->psits->id, 'last_name' => 'Findable']);

        // Events: planning with no approval row, planning that waits on the dean, approved, completed, ongoing, and another college's.
        // Every one belongs to the active semester, because the listing only shows the selected semester's rows.
        $event = fn (Organization $organization, User $author, array $attributes) => Event::factory()->create([
            'organization_id' => $organization->id, 'created_by' => $author->school_id, 'academic_semester_id' => $this->semester->id,
            'start_time' => now()->addWeek(), 'end_time' => now()->addWeek()->addHours(2), ...$attributes,
        ]);
        $planning = $event($this->psits, $adviser, ['status' => 'planning', 'title' => 'Planning only']);
        $waiting = $event($this->psits, $adviser, ['status' => 'planning', 'title' => 'Waiting on the dean']);
        $approved = $event($this->psits, $adviser, ['status' => 'approved', 'approved_at' => now(), 'title' => 'Approved']);
        $completed = $event($this->compsoc, $compsocAdviser, ['status' => 'completed', 'start_time' => now()->subWeek(), 'end_time' => now()->subWeek()->addHours(2), 'title' => 'Completed']);
        $foreignEvent = $event($this->artsClub, $artsAdviser, ['status' => 'approved', 'approved_at' => now(), 'title' => 'Foreign']);
        $ongoing = $event($this->psits, $adviser, ['status' => 'ongoing', 'approved_at' => now(), 'start_time' => now()->subHour(), 'end_time' => now()->addHour(), 'title' => 'Ongoing']);
        $this->ids['events'] = [$planning->id, $waiting->id, $approved->id, $completed->id, $foreignEvent->id, $ongoing->id];
        $this->ids['planning'] = $planning->id;
        $this->ids['waiting'] = $waiting->id;
        $this->ids['approved'] = $approved->id;

        $approval = fn (Organization $organization, int $entityId, User $requester, string $role, string $type = 'event') => ApprovalRequest::create([
            'organization_id' => $organization->id, 'entity_type' => $type, 'entity_id' => $entityId,
            'requested_by' => $requester->school_id, 'required_role' => $role, 'status' => 'pending', 'requested_at' => now()->subHour(),
        ]);
        $deanStep = $approval($this->psits, $waiting->id, $adviser, 'DEPARTMENT_HEAD');
        $adviserStep = $approval($this->psits, $planning->id + 1000, $adviser, 'ADMIN');
        $foreignStep = $approval($this->artsClub, $foreignEvent->id, $artsAdviser, 'DEPARTMENT_HEAD');
        $this->ids['approvals'] = [$deanStep->id, $adviserStep->id, $foreignStep->id];

        // Attendance on the approved event, registrations, and the requirement file a dean may open once it is submitted.
        foreach ($students as $student) {
            Attendance::factory()->create(['event_id' => $approved->id, 'user_id' => $student->school_id, 'method' => 'manual', 'status' => 'present', 'check_in_time' => now()]);
            EventRegistration::create(['event_id' => $approved->id, 'organization_id' => $this->psits->id, 'user_id' => $student->school_id, 'status' => 'registered', 'registered_at' => now()]);
        }
        $requirement = EventRequirement::create(['name' => 'Letter', 'venue_type' => 'all', 'allowed_extensions' => ['pdf'], 'is_active' => true, 'is_optional' => false, 'sort_order' => 1]);
        $path = "event-requirements/{$this->psits->id}/{$waiting->id}/letter.pdf";
        Storage::disk('local')->put($path, '%PDF-1.4 test');
        $file = EventRequirementFile::create([
            'event_id' => $waiting->id, 'requirement_id' => $requirement->id, 'organization_id' => $this->psits->id,
            'path' => $path, 'original_name' => 'letter.pdf', 'uploaded_by' => $adviser->school_id,
        ]);
        $this->ids['requirements'] = [$requirement->id];
        $this->ids['requirementFiles'] = [$file->id];

        // Elections: one whose results are still hidden, one released, one in another college, all in the active semester.
        $election = fn (Organization $organization, array $attributes) => Election::factory()->create([
            'organization_id' => $organization->id, 'academic_semester_id' => $this->semester->id, 'start_time' => now()->subDay(), 'end_time' => now()->addDay(),
            'approved_at' => now()->subDays(2), 'finalized_at' => now()->subDay(), ...$attributes,
        ]);
        $hidden = $election($this->psits, ['status' => 'active', 'results_visible' => false, 'title' => 'Hidden results']);
        $released = $election($this->compsoc, ['status' => 'closed', 'results_visible' => true, 'end_time' => now()->subHour(), 'title' => 'Released results']);
        $foreignElection = $election($this->artsClub, ['status' => 'active', 'results_visible' => true, 'title' => 'Foreign election']);
        foreach ([$hidden, $released, $foreignElection] as $each) {
            $position = ElectionPosition::create(['election_id' => $each->id, 'title' => 'President', 'max_winners' => 1]);
            $candidate = Candidate::create(['election_id' => $each->id, 'position_id' => $position->id, 'user_id' => $students->first()->school_id]);
            Vote::create(['election_id' => $each->id, 'position_id' => $position->id, 'candidate_id' => $candidate->id, 'voter_id' => $students->last()->school_id, 'vote_hash' => 'hash-'.$each->id]);
        }
        $this->ids['elections'] = [$hidden->id, $released->id, $foreignElection->id];
        $this->ids['hiddenElection'] = $hidden->id;

        // Announcements, budgets with transactions, financial reports.
        foreach ([[$this->psits, $adviser], [$this->compsoc, $compsocAdviser], [$this->artsClub, $artsAdviser]] as [$organization, $author]) {
            Announcement::factory()->create([
                'organization_id' => $organization->id, 'created_by' => $author->id, 'target_role' => 'all', 'is_published' => true,
                'approval_status' => 'approved', 'published_at' => now(), 'academic_semester_id' => $this->semester->id,
            ]);
            $budget = Budget::factory()->create([
                'organization_id' => $organization->id, 'allocated_amount' => 1000, 'remaining_amount' => 900,
                'warning_threshold' => 100, 'submission_status' => 'pending_department_head',
            ]);
            Transaction::factory()->create(['organization_id' => $organization->id, 'budget_id' => $budget->id, 'recorded_by' => $author->school_id, 'type' => 'expense', 'amount' => 100, 'transaction_date' => now()->subDay()]);
            Transaction::factory()->create(['organization_id' => $organization->id, 'budget_id' => null, 'recorded_by' => $author->school_id, 'type' => 'income', 'amount' => 250, 'transaction_date' => now()->subDay()]);
            Collection::create(['organization_id' => $organization->id, 'reference' => 'COL-'.$organization->id, 'amount_collected' => 500, 'source' => 'Ticket sales', 'collected_by' => $author->school_id, 'collected_at' => now()]);
            CashAdvance::create(['organization_id' => $organization->id, 'reference' => 'ADV-'.$organization->id, 'borrower_id' => $author->school_id, 'amount' => 300, 'purpose' => 'Venue deposit']);
            FinancialForecast::factory()->create(['organization_id' => $organization->id, 'generated_by' => $author->school_id]);
            Partylist::create(['organization_id' => $organization->id, 'name' => 'Partylist '.$organization->name, 'acronym' => strtoupper(substr($organization->name, 0, 3))]);
        }
        $report = fn (Organization $organization, User $author, bool $submitted) => FinancialReport::create([
            'organization_id' => $organization->id, 'report_type' => 'monthly', 'title' => 'Report '.$organization->name,
            'source_transaction_ids' => [], 'signatories' => [], 'submission_status' => $submitted ? 'pending_department_head' : 'draft',
            'generated_by' => $author->school_id, 'generated_at' => now(), 'submitted_at' => $submitted ? now() : null,
        ]);
        $submitted = $report($this->psits, $adviser, true);
        Storage::disk('local')->put("financial-reports/{$submitted->id}/receipt.pdf", 'receipt');
        $submitted->update(['supporting_documents' => [['name' => 'Receipt', 'mime_type' => 'application/pdf', 'size' => 7, 'path' => "financial-reports/{$submitted->id}/receipt.pdf"]]]);
        $this->ids['reports'] = [$submitted->id, $report($this->psits, $adviser, false)->id, $report($this->artsClub, $artsAdviser, true)->id];

        // Records, clearances, compliance files, applications.
        $period = ClearancePeriod::create(['academic_year' => '2026-2027', 'title' => 'Clearance', 'required_roles' => ['organization', 'department_head'], 'created_by' => $adviser->school_id]);
        foreach ($students as $student) {
            foreach (['organization', 'department_head'] as $role) {
                ClearanceSignature::create(['clearance_period_id' => $period->id, 'student_id' => $student->school_id, 'organization_id' => $this->psits->id, 'required_role' => $role, 'status' => 'pending']);
            }
        }
        $this->ids['periods'] = [$period->id];
        $this->ids['signature'] = ClearanceSignature::where('clearance_period_id', $period->id)->where('required_role', 'department_head')->value('id');

        $type = ComplianceRequirementType::create(['academic_year' => '2026-2027', 'name' => 'Constitution', 'deadline_at' => now()->addMonth(), 'is_active' => true, 'created_by' => $this->dean->school_id]);
        $docPath = 'compliance-submissions/'.$this->psits->id.'/doc.pdf';
        Storage::disk('local')->put($docPath, '%PDF-1.4 original');
        $submission = OrganizationComplianceSubmission::create([
            'organization_id' => $this->psits->id, 'requirement_type_id' => $type->id, 'status' => 'submitted', 'file_path' => $docPath,
            'file_original_name' => 'doc.pdf', 'mime_type' => 'application/pdf', 'file_size' => 17,
            'submitted_by' => $adviser->school_id, 'submitted_at' => now()->subDay(),
        ]);
        $this->ids['types'] = [$type->id];
        $this->ids['submissions'] = [$submission->id];

        $application = fn (int $collegeId, string $name, User $student) => OrganizationApplication::create([
            'college_id' => $collegeId, 'name' => $name, 'acronym' => strtoupper(substr($name, 0, 3)), 'school_id' => $student->school_id,
            'first_name' => $student->first_name, 'last_name' => $student->last_name, 'email' => $student->email,
            'position_title' => 'President', 'status' => 'pending_dean',
        ]);
        $computingApplication = $application($computingId, 'Computing Council', $students->first());
        $this->ids['applications'] = [$computingApplication->id, $application($artsId, 'Arts Council', $students->last())->id];

        // A submitted requirement document and a reviewer's attached file on the private disk, for the four routes that open them.
        $documentPath = "organization-applications/{$computingApplication->id}/constitution.pdf";
        Storage::disk('local')->put($documentPath, '%PDF-1.4 submitted');
        $document = OrganizationApplicationDocument::create([
            'organization_application_id' => $computingApplication->id, 'requirement_type_id' => $type->id,
            'file_path' => $documentPath, 'file_original_name' => 'constitution.pdf', 'mime_type' => 'application/pdf', 'file_size' => 18,
        ]);
        $reviewPath = "organization-application-reviews/{$computingApplication->id}/marked-up.pdf";
        Storage::disk('local')->put($reviewPath, '%PDF-1.4 marked up');
        $reviewFile = OrganizationApplicationReviewFile::create([
            'organization_application_id' => $computingApplication->id, 'requirement_type_id' => $type->id, 'round' => 1, 'stage' => 'dean',
            'uploaded_by' => $this->dean->school_id, 'file_path' => $reviewPath, 'file_original_name' => 'marked-up.pdf', 'mime_type' => 'application/pdf', 'file_size' => 18,
        ]);
        $this->ids['applicationDocuments'] = [$document->id];
        $this->ids['applicationReviewFiles'] = [$reviewFile->id];

        $this->ids['organizations'] = [$this->psits->id, $this->compsoc->id, $this->artsClub->id];
        $this->ids['adviser'] = $adviser;
        $this->ids['student'] = $students->first();
    }

    private function actingAsFresh(User $user): void
    {
        $this->app['auth']->forgetGuards();
        Sanctum::actingAs($user);
    }

    /** One answer: its status, and how many rows it carries when it is a list. */
    private function ask(User $user, string $url): array
    {
        $this->actingAsFresh($user);
        $response = $this->getJson($url);
        $json = str_contains((string) $response->headers->get('Content-Type'), 'json') ? $response->json() : null;

        return [$response->getStatusCode(), $this->rowCount($json)];
    }

    private function rowCount(mixed $json): ?int
    {
        if (! is_array($json)) {
            return null;
        }
        if (array_is_list($json)) {
            return count($json);
        }
        foreach ([$json, $json['pagination'] ?? [], $json['meta'] ?? []] as $page) {
            if (is_array($page) && isset($page['current_page']) && isset($page['total']) && is_int($page['total'])) {
                return $page['total'];
            }
        }
        if (isset($json['data']) && is_array($json['data']) && array_is_list($json['data'])) {
            return count($json['data']);
        }
        $lists = array_filter($json, fn ($value) => is_array($value) && array_is_list($value));

        return $lists === [] ? null : array_sum(array_map('count', $lists));
    }

    /** @return array<int, array{uri: string, roles: ?array<int, string>}> */
    private function deanGetRoutes(): array
    {
        $routes = [];
        foreach (Route::getRoutes()->getRoutes() as $route) {
            if (! in_array('GET', $route->methods(), true) || ! str_starts_with($route->uri(), 'api/')) {
                continue;
            }
            $middleware = array_filter($route->gatherMiddleware(), 'is_string');
            if (! array_filter($middleware, fn (string $name) => str_starts_with($name, 'auth:'))) {
                continue;
            }
            $roleList = array_values(array_filter($middleware, fn (string $name) => str_starts_with($name, 'role:')))[0] ?? null;
            $roles = $roleList === null ? null : explode(',', substr($roleList, 5));
            if ($roles !== null && ! array_intersect($roles, ['DEPARTMENT_HEAD', 'COLLEGE_OFFICE'])) {
                continue;
            }
            $routes[] = ['uri' => $route->uri(), 'roles' => $roles];
        }

        return $routes;
    }

    /** @return array<string, array<int, int|string>> */
    private function parameterCandidates(): array
    {
        return [
            'api/ai/assistant/conversations/{conversation}' => [1],
            'api/events/{id}' => $this->ids['events'],
            'api/events/{event}' => $this->ids['events'],
            'api/events/{event}/submission/files/{file}' => $this->ids['requirementFiles'],
            'api/event-requirements/{requirement}' => $this->ids['requirements'],
            'api/elections/{id}' => $this->ids['elections'],
            'api/elections/{id}/reports/{type}' => ['results'],
            'api/officer-transition/handover/{handover}' => [1],
            'api/organization-applications/{application}' => $this->ids['applications'],
            'api/organization-applications/{application}/documents/{document}' => $this->ids['applicationDocuments'],
            'api/organization-applications/{application}/review-files/{file}' => $this->ids['applicationReviewFiles'],
            'api/my/organization-applications/{application}' => $this->ids['applications'],
            'api/my/organization-applications/{application}/documents/{document}' => $this->ids['applicationDocuments'],
            'api/my/organization-applications/{application}/review-files/{file}' => $this->ids['applicationReviewFiles'],
            'api/my/organization-applications/requirements/{requirementType}' => $this->ids['types'],
            'api/college/organizations/{organization}' => $this->ids['organizations'],
            'api/approval-requests/{approvalRequest}' => $this->ids['approvals'],
            'api/financial-reports/{financialReport}' => $this->ids['reports'],
            'api/financial-reports/{financialReport}/documents/{index}' => [0, 1],
            'api/compliance/requirement-types/{requirementType}' => $this->ids['types'],
            'api/compliance/submissions/{submission}' => $this->ids['submissions'],
            'api/clearance-periods/{clearancePeriod}' => $this->ids['periods'],
        ];
    }

    /** @return array<int, string>|null every URL the route stands for, or null when a parameter cannot be filled */
    private function urlsFor(string $uri): ?array
    {
        $urls = ['/'.$uri];
        $candidates = $this->parameterCandidates();
        preg_match_all('/\{(\w+)\??\}/', $uri, $names);
        foreach ($names[1] as $name) {
            $key = substr($uri, 0, strpos($uri, '{'.$name.'}') + strlen($name) + 2);
            if (! isset($candidates[$key])) {
                return null;
            }
            $urls = collect($urls)->flatMap(fn (string $url) => collect($candidates[$key])->map(fn ($value) => str_replace('{'.$name.'}', (string) $value, $url)))->all();
        }

        return $urls;
    }

    /**
     * Every URL the walk asks for one route. Most routes are asked bare and with the organization filter; the four
     * that answer 422 without a query parameter are asked with what they need, so each is measured at 200.
     *
     * @return array<int, string>
     */
    private function targetsFor(string $uri, string $url): array
    {
        $queries = match ($uri) {
            'api/people/search' => ['?q=Findable', '?q=Findable&scope=all', '?q=Findable&organization_id='.$this->psits->id],
            'api/college/people' => ['?tab=students', '?tab=staff', '?tab=leaders'],
            'api/account-profiles/candidates', 'api/account-profiles/positions' => ['?organization_id='.$this->psits->id, '?organization_id='.$this->artsClub->id],
            default => ['', '?organization_id='.$this->psits->id],
        };

        return array_map(fn (string $query) => $url.$query, $queries);
    }

    public function test_every_get_route_the_dean_can_reach_answers_office_staff_the_same_and_never_with_more_rows(): void
    {
        $deanOnly = array_filter(EnsureRole::DEAN_ONLY, fn (string $entry) => str_starts_with($entry, 'GET '));
        $deanOnly = array_map(fn (string $entry) => substr($entry, 4), $deanOnly);
        $covered = [];
        $skipped = [];
        $requests = 0;
        $failures = [];
        $deanRowsByUrl = [];
        $deanStatusByUrl = [];

        foreach ($this->deanGetRoutes() as ['uri' => $uri]) {
            $urls = $this->urlsFor($uri);
            if ($urls === null) {
                $skipped[] = $uri;

                continue;
            }
            $covered[] = $uri;
            foreach ($urls as $url) {
                foreach ($this->targetsFor($uri, $url) as $target) {
                    [$deanStatus, $deanRows] = $this->ask($this->dean, $target);
                    [$staffStatus, $staffRows] = $this->ask($this->staff, $target);
                    $requests += 2;
                    $deanRowsByUrl[$target] = $deanRows;
                    $deanStatusByUrl[$target] = $deanStatus;

                    if ($deanStatus === 422) {
                        $failures[] = "{$target}: the dean's request was rejected as incomplete, so it measures nothing; add the query it needs to targetsFor()";
                    }
                    if (in_array($uri, $deanOnly, true)) {
                        if ($staffStatus !== 403 || $deanStatus === 403) {
                            $failures[] = "{$target}: dean-only route answered dean {$deanStatus}, staff {$staffStatus}, expected a refusal for staff only";
                        }

                        continue;
                    }
                    // 501 is a full election route that is registered on its stub controller and not built yet; staff and dean must still agree on it.
                    if (($deanStatus >= 500 && $deanStatus !== 501) || ($staffStatus >= 500 && $staffStatus !== 501)) {
                        $failures[] = "{$target}: server error, dean {$deanStatus}, staff {$staffStatus}";
                    } elseif ($staffStatus !== $deanStatus) {
                        $failures[] = "{$target}: dean {$deanStatus}, staff {$staffStatus}";
                    } elseif ($deanStatus === 200 && $staffRows !== null && $deanRows !== null && $staffRows > $deanRows) {
                        $failures[] = "{$target}: dean sees {$deanRows} rows, staff see {$staffRows}";
                    }
                }
            }
        }

        fwrite(STDERR, sprintf(
            "\n[office staff parity] %d GET routes covered, %d requests, %d routes skipped:\n  %s\n",
            count($covered), $requests, count($skipped), $skipped === [] ? '(none)' : implode("\n  ", $skipped),
        ));

        foreach (self::FLOORS as $target => $floor) {
            if (($deanRowsByUrl[$target] ?? 0) < $floor) {
                $failures[] = "{$target}: the fixture gives the dean ".($deanRowsByUrl[$target] ?? 0)." rows, expected at least {$floor}; an empty listing proves nothing about scope";
            }
        }

        // The two file routes are walked with the seeded document and reviewer file; if the fixture breaks both roles fall to 404 and parity alone would still pass.
        $applicationUrl = '/api/organization-applications/'.$this->ids['applications'][0];
        foreach (['/documents/'.$this->ids['applicationDocuments'][0], '/review-files/'.$this->ids['applicationReviewFiles'][0]] as $fileRoute) {
            $this->assertSame(200, $deanStatusByUrl[$applicationUrl.$fileRoute] ?? null, "the dean must open {$applicationUrl}{$fileRoute}; the walk proves nothing about it otherwise");
        }

        $this->assertSame([], array_values(array_diff($skipped, self::UNFILLED)), 'A GET route the dean can reach has a parameter this walk cannot fill; add it to parameterCandidates().');
        $this->assertGreaterThan(60, count($covered));
        $this->assertSame([], $failures, implode("\n", $failures));
    }

    public function test_a_planning_event_is_hidden_from_staff_exactly_as_from_the_dean(): void
    {
        foreach ([$this->dean, $this->staff] as $viewer) {
            $this->actingAsFresh($viewer);
            $this->getJson('/api/events/'.$this->ids['planning'])->assertForbidden();
            $this->getJson('/api/events/'.$this->ids['approved'])->assertOk();
            // Once a request waits on the dean's step the planning event opens for the dean and for staff alike.
            $this->getJson('/api/events/'.$this->ids['waiting'])->assertOk();
        }
    }

    public function test_event_attendance_gives_staff_the_deans_own_rows_and_no_management(): void
    {
        foreach ([$this->dean, $this->staff] as $viewer) {
            $this->actingAsFresh($viewer);
            $this->getJson('/api/events/'.$this->ids['approved'].'/attendance')->assertOk()
                ->assertJsonPath('can_manage_attendance', false)
                ->assertJsonPath('count', 0)
                ->assertJsonCount(0, 'records');
        }
    }

    public function test_hidden_election_results_stay_hidden_from_staff_as_from_the_dean(): void
    {
        foreach ([$this->dean, $this->staff] as $viewer) {
            $this->actingAsFresh($viewer);
            $this->getJson('/api/elections/'.$this->ids['hiddenElection'].'/results')->assertForbidden();
        }
        $this->ids['adviser']->refresh();
        $this->actingAsFresh($this->ids['adviser']);
        $this->getJson('/api/elections/'.$this->ids['hiddenElection'].'/results')->assertOk();
    }

    public function test_staff_cannot_register_for_an_event_the_dean_cannot_see(): void
    {
        foreach ([$this->dean, $this->staff] as $viewer) {
            $this->actingAsFresh($viewer);
            $this->postJson('/api/events/'.$this->ids['planning'].'/registrations')->assertForbidden()
                ->assertJsonPath('message', 'Event not available.');
        }
    }

    public function test_the_stored_role_and_what_the_client_is_shown_do_not_change(): void
    {
        $this->actingAsFresh($this->staff);
        $this->getJson('/api/user')->assertOk()->assertJsonPath('role', 'ADMIN')->assertJsonPath('organization.organization_type', 'COLLEGE');
        $this->assertSame('ADMIN', $this->staff->fresh()->getRawOriginal('role'));
        $this->assertSame('ADMIN', AccountProfile::where('user_school_id', $this->staff->school_id)->value('role'));

        $this->actingAsFresh($this->dean);
        $this->getJson('/api/user')->assertOk()->assertJsonPath('role', 'DEPARTMENT_HEAD');
    }

    public function test_a_staff_member_signed_in_with_a_real_token_is_the_dean_for_checks_and_staff_for_display(): void
    {
        $login = $this->postJson('/api/login', ['school_id' => $this->staff->school_id, 'password' => 'password'])->assertOk();
        $login->assertJsonPath('user.role', 'ADMIN');
        $token = $login->json('access_token');
        $this->app['auth']->forgetGuards();

        $this->withToken($token)->getJson('/api/user')->assertOk()->assertJsonPath('role', 'ADMIN');
        $this->withToken($token)->getJson('/api/events/'.$this->ids['planning'])->assertForbidden();
        $this->withToken($token)->getJson('/api/college/overview')->assertOk();
        $this->withToken($token)->getJson('/api/college/staff/invitations')->assertForbidden()->assertJsonPath('message', EnsureRole::DEAN_ONLY_MESSAGE);
        $this->withToken($token)->getJson('/api/user/profiles')->assertOk()->assertJsonPath('profiles.0.role', 'ADMIN');
    }

    public function test_every_write_the_dean_can_reach_is_either_dean_only_or_deliberately_open_to_staff(): void
    {
        $writes = [];
        foreach (Route::getRoutes()->getRoutes() as $route) {
            $middleware = array_filter($route->gatherMiddleware(), 'is_string');
            if (! array_filter($middleware, fn (string $name) => str_starts_with($name, 'auth:'))) {
                continue;
            }
            $roleList = array_values(array_filter($middleware, fn (string $name) => str_starts_with($name, 'role:')))[0] ?? null;
            if ($roleList !== null && ! in_array('DEPARTMENT_HEAD', explode(',', substr($roleList, 5)), true)) {
                continue;
            }
            foreach (array_diff($route->methods(), ['HEAD', 'GET']) as $method) {
                $writes[] = $method.' '.$route->uri();
            }
        }

        $unplaced = array_values(array_diff($writes, EnsureRole::DEAN_ONLY, self::OPEN_TO_STAFF));
        $this->assertSame([], $unplaced, 'A write the dean can reach is on neither list; decide whether staff may make it.');
        $this->assertSame([], array_values(array_diff(self::OPEN_TO_STAFF, $writes)), 'An open-to-staff entry is not a route the dean can reach.');
        $this->assertSame([], array_values(array_intersect(EnsureRole::DEAN_ONLY, self::OPEN_TO_STAFF)), 'A write is on both lists.');
    }

    public function test_the_dean_only_list_denies_staff_and_every_entry_is_a_real_route_the_dean_passes(): void
    {
        $routes = [];
        foreach (Route::getRoutes()->getRoutes() as $route) {
            $roleList = array_values(array_filter(array_filter($route->gatherMiddleware(), 'is_string'), fn (string $name) => str_starts_with($name, 'role:')))[0] ?? null;
            foreach (array_diff($route->methods(), ['HEAD']) as $method) {
                $routes[$method.' '.$route->uri()] = $roleList === null ? null : explode(',', substr($roleList, 5));
            }
        }

        $other = User::factory()->admin()->create(['organization_id' => $this->home->id]);
        $invitation = DepartmentHeadInvitation::create([
            'college_id' => $this->dean->organization->college_id, 'role' => 'ADMIN', 'position_title' => 'Clerk', 'first_name' => 'Ana', 'last_name' => 'Cruz',
            'email' => 'ana.cruz@example.edu', 'token_hash' => hash('sha256', 'token'), 'invited_by' => $this->dean->school_id, 'expires_at' => now()->addWeek(),
        ]);
        $grant = OrganizationApplicantGrant::create(['college_id' => $this->dean->organization->college_id, 'user_school_id' => $this->ids['student']->school_id, 'granted_by' => $this->dean->school_id]);
        $profile = AccountProfile::where('user_school_id', $this->ids['student']->school_id)->firstOrFail();
        $entry = StudentRegistryEntry::create(['school_id' => 2600777, 'first_name' => 'Ana', 'last_name' => 'Cruz', 'birth_date' => '2007-01-02', 'college_id' => $this->dean->organization->college_id, 'program' => 'BS IT', 'year_level' => '1st Year']);
        $filled = ['{grant}' => $grant->id, '{invitation}' => $invitation->id, '{user}' => $other->school_id, '{profile}' => $profile->id, '{entry}' => $entry->id, '{submission}' => $this->ids['submissions'][0],
            '{organization}' => $this->psits->id, '{clearanceSignature}' => $this->ids['signature']];

        foreach (EnsureRole::DEAN_ONLY as $entry) {
            $this->assertArrayHasKey($entry, $routes, "{$entry} is on the dean-only list but is not a route");
            $this->assertNotNull($routes[$entry], "{$entry} has no role middleware, so the list cannot reach it");
            $this->assertContains('DEPARTMENT_HEAD', $routes[$entry], "{$entry} is not open to the dean, so listing it hides nothing");

            [$method, $uri] = explode(' ', $entry, 2);
            $url = '/'.strtr($uri, $filled);
            $this->actingAsFresh($this->staff);
            $this->json($method, $url, [])->assertForbidden()->assertJsonPath('message', EnsureRole::DEAN_ONLY_MESSAGE);
            if ($method === 'GET') {
                $this->actingAsFresh($this->dean);
                $this->assertNotSame(403, $this->getJson($url)->getStatusCode(), "the dean is refused {$entry}");
            }
        }
    }
}
