<?php

namespace Tests\Feature;

use App\Models\ApprovalRequest;
use App\Models\Attendance;
use App\Models\Budget;
use App\Models\Election;
use App\Models\Event;
use App\Models\EventRequirement;
use App\Models\FinancialReport;
use App\Models\Organization;
use App\Models\Task;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

/**
 * An approval row's summary carries the fields the entity's own page uses, under the same names,
 * so one lifecycle function reads the same stage on every page. The single request endpoint
 * returns exactly the row the list returns, and hides what the list would hide.
 */
class ApprovalSummaryFieldsTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private Organization $organization;

    private User $admin;

    private User $head;

    private User $director;

    private Organization $foreignOrganization;

    private User $foreignAdmin;

    private User $foreignHead;

    protected function setUp(): void
    {
        parent::setUp();
        config(['performance.api_cache.enabled' => false]);
        Storage::fake('local');
        $college = $this->makeCollege('CCS');
        $this->organization = $this->makeCollegeStudentOrganization($college);
        $this->head = $this->makeCollegeHead($college);
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        $sao = Organization::where('slug', 'student-affairs-office')->firstOrFail();
        $this->director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);

        $other = $this->makeCollege('CBE');
        $this->foreignOrganization = $this->makeCollegeStudentOrganization($other);
        $this->foreignHead = $this->makeCollegeHead($other);
        $this->foreignAdmin = User::factory()->admin()->create(['organization_id' => $this->foreignOrganization->id]);
    }

    private function requirement(): EventRequirement
    {
        return EventRequirement::create([
            'name' => 'Event proposal', 'allowed_extensions' => ['pdf'], 'is_active' => true,
            'is_optional' => false, 'venue_type' => 'all', 'sort_order' => 1,
        ]);
    }

    private function propose(string $title): int
    {
        Sanctum::actingAs($this->admin);

        return $this->postJson('/api/events', [
            'title' => $title,
            'start_time' => now()->addWeek()->toDateTimeString(),
            'end_time' => now()->addWeek()->addHours(2)->toDateTimeString(),
        ])->assertCreated()->json('id');
    }

    private function upload(int $eventId, EventRequirement $requirement): void
    {
        Sanctum::actingAs($this->admin);
        $this->post('/api/events/'.$eventId.'/submission', [
            'documents' => [$requirement->id => UploadedFile::fake()->create('file.pdf', 20, 'application/pdf')],
        ])->assertOk();
    }

    private function decide(User $reviewer, int $eventId, string $role, string $status = 'approved'): void
    {
        $row = ApprovalRequest::where('entity_type', 'event')->where('entity_id', $eventId)->where('required_role', $role)->firstOrFail();
        Sanctum::actingAs($reviewer);
        $this->patchJson('/api/approval-requests/'.$row->id, array_filter(['status' => $status, 'remarks' => $status === 'rejected' ? 'No.' : null]))->assertOk();
    }

    private function approval(string $type, int $entityId, array $overrides = []): ApprovalRequest
    {
        return ApprovalRequest::create([
            'organization_id' => $this->organization->id, 'entity_type' => $type, 'entity_id' => $entityId,
            'requested_by' => $this->admin->school_id, 'required_role' => 'DEPARTMENT_HEAD', 'status' => 'pending',
            'requested_at' => now(), ...$overrides,
        ]);
    }

    /** Every approval row the Admin submitted, whatever its status. */
    private function submittedRows(?User $viewer = null, string $query = ''): array
    {
        Sanctum::actingAs($viewer ?? $this->admin);

        return $this->getJson('/api/approval-requests?scope=submitted&status=all&per_page=100'.$query)->assertOk()->json('data');
    }

    private function summariesFor(string $type, int $entityId): array
    {
        return collect($this->submittedRows())->where('entity_type', $type)->where('entity_id', $entityId)->pluck('summary')->all();
    }

    private function eventWithApproval(array $overrides = []): Event
    {
        $event = Event::factory()->create([
            'organization_id' => $this->organization->id, 'created_by' => $this->admin->school_id,
            'status' => 'planning', ...$overrides,
        ]);
        $this->approval('event', $event->id);

        return $event;
    }

    public function test_an_event_row_carries_the_same_approval_stage_as_the_events_endpoint_in_every_stage(): void
    {
        $requirement = $this->requirement();
        $stages = [];

        $stages['awaiting_department_head'] = $this->propose('Awaiting head');
        $stages['rejected'] = $this->propose('Rejected');
        $this->decide($this->head, $stages['rejected'], 'DEPARTMENT_HEAD', 'rejected');
        $stages['awaiting_requirements'] = $this->propose('Awaiting files');
        $this->decide($this->head, $stages['awaiting_requirements'], 'DEPARTMENT_HEAD');
        $stages['awaiting_sao'] = $this->propose('Awaiting SAO');
        $this->decide($this->head, $stages['awaiting_sao'], 'DEPARTMENT_HEAD');
        $this->upload($stages['awaiting_sao'], $requirement);
        $stages['requirements_returned'] = $this->propose('Returned');
        $this->decide($this->head, $stages['requirements_returned'], 'DEPARTMENT_HEAD');
        $this->upload($stages['requirements_returned'], $requirement);
        $this->decide($this->director, $stages['requirements_returned'], 'SUPER_ADMIN', 'rejected');
        $stages['approved'] = $this->propose('Approved');
        $this->decide($this->head, $stages['approved'], 'DEPARTMENT_HEAD');
        $this->upload($stages['approved'], $requirement);
        $this->decide($this->director, $stages['approved'], 'SUPER_ADMIN');

        $rows = collect($this->submittedRows())->where('entity_type', 'event');
        Sanctum::actingAs($this->admin);
        $events = collect($this->getJson('/api/events?per_page=50')->assertOk()->json('data'))->keyBy('id');

        foreach ($stages as $stage => $id) {
            $summaries = $rows->where('entity_id', $id)->pluck('summary');
            $this->assertNotEmpty($summaries, $stage);
            foreach ($summaries as $summary) {
                $this->assertSame($stage, $summary['approval_stage'], 'stage of '.$stage);
                $this->assertSame($events[$id]['approval_stage'], $summary['approval_stage']);
                $this->assertSame($events[$id]['requirements_required'], $summary['requirements_required']);
                $this->assertSame($events[$id]['requirements_submitted'], $summary['requirements_submitted']);
            }
        }
        $this->assertTrue($rows->where('entity_id', $stages['awaiting_sao'])->first()['summary']['requirements_submitted']);
        $this->assertFalse($rows->where('entity_id', $stages['awaiting_requirements'])->first()['summary']['requirements_submitted']);
    }

    public function test_a_head_approved_event_with_no_requirements_and_no_approval_date_reads_not_submitted_like_the_events_endpoint(): void
    {
        $event = Event::factory()->create(['organization_id' => $this->organization->id, 'created_by' => $this->admin->school_id, 'status' => 'planning']);
        $this->approval('event', $event->id, ['status' => 'approved', 'reviewed_by' => $this->head->school_id, 'reviewed_at' => now()]);

        Sanctum::actingAs($this->admin);
        $this->assertSame('not_submitted', $this->getJson('/api/events/'.$event->id)->assertOk()->json('approval_stage'));
        $this->assertSame('not_submitted', $this->summariesFor('event', $event->id)[0]['approval_stage']);
    }

    public function test_an_event_row_carries_requirements_budget_task_and_attendance_fields(): void
    {
        $event = $this->eventWithApproval(['requires_budget' => true]);
        foreach (['completed', 'completed', 'pending'] as $status) {
            Task::factory()->create(['event_id' => $event->id, 'created_by' => $this->admin->school_id, 'assigned_to' => $this->admin->school_id, 'status' => $status]);
        }
        foreach (['present', 'late', 'absent'] as $status) {
            $attendee = User::factory()->student()->create(['organization_id' => $this->organization->id]);
            Attendance::factory()->create(['event_id' => $event->id, 'user_id' => $attendee->school_id, 'method' => 'manual', 'status' => $status, 'check_in_time' => now()]);
        }
        $pending = Budget::create(['organization_id' => $this->organization->id, 'event_id' => $event->id, 'title' => 'A', 'allocated_amount' => 100, 'remaining_amount' => 100, 'warning_threshold' => 10, 'submission_status' => 'pending_department_head']);
        $approved = Budget::create(['organization_id' => $this->organization->id, 'event_id' => $event->id, 'title' => 'B', 'allocated_amount' => 100, 'remaining_amount' => 100, 'warning_threshold' => 10, 'submission_status' => 'approved']);
        $bare = $this->eventWithApproval(['requires_budget' => false]);

        $summary = $this->summariesFor('event', $event->id)[0];
        Sanctum::actingAs($this->admin);
        $payload = $this->getJson('/api/events/'.$event->id)->assertOk()->json();

        $this->assertSame('planning', $summary['status']);
        $this->assertTrue($summary['requires_budget']);
        $this->assertSame(3, $summary['tasks_count']);
        $this->assertSame(2, $summary['completed_tasks_count']);
        $this->assertSame(2, $summary['present_count']);
        $this->assertSame([
            ['id' => $pending->id, 'submission_status' => 'pending_department_head'],
            ['id' => $approved->id, 'submission_status' => 'approved'],
        ], $summary['budgets']);
        $this->assertSame($payload['tasks_count'], $summary['tasks_count']);
        $this->assertSame($payload['completed_tasks_count'], $summary['completed_tasks_count']);
        $this->assertSame($payload['requires_budget'], $summary['requires_budget']);
        $this->assertSame(collect($payload['budgets'])->map(fn ($budget) => $budget['id'].':'.$budget['submission_status'])->sort()->values()->all(), collect($summary['budgets'])->map(fn ($budget) => $budget['id'].':'.$budget['submission_status'])->sort()->values()->all());

        $empty = $this->summariesFor('event', $bare->id)[0];
        $this->assertFalse($empty['requires_budget']);
        $this->assertSame([], $empty['budgets']);
        $this->assertSame(0, $empty['tasks_count']);
        $this->assertSame(0, $empty['completed_tasks_count']);
        $this->assertSame(0, $empty['present_count']);
    }

    public function test_an_election_row_carries_status_finalized_at_results_visible_and_the_latest_approval_status(): void
    {
        $locked = Election::factory()->create([
            'organization_id' => $this->organization->id, 'status' => 'upcoming', 'approved_at' => now(),
            'finalized_at' => now()->subDay(), 'results_visible' => false,
        ]);
        $this->approval('election', $locked->id, ['status' => 'approved', 'reviewed_by' => $this->head->school_id, 'reviewed_at' => now()]);
        $building = Election::factory()->create([
            'organization_id' => $this->organization->id, 'status' => 'pending_approval', 'finalized_at' => null, 'results_visible' => true,
        ]);
        $this->approval('election', $building->id, ['status' => 'rejected', 'requested_at' => now()->subDays(2)]);
        $this->approval('election', $building->id, ['status' => 'pending']);

        $lockedSummary = $this->summariesFor('election', $locked->id)[0];
        $this->assertSame('upcoming', $lockedSummary['status']);
        $this->assertNotNull($lockedSummary['finalized_at']);
        $this->assertFalse($lockedSummary['results_visible']);
        $this->assertSame('approved', $lockedSummary['approval_status']);

        foreach ($this->summariesFor('election', $building->id) as $summary) {
            $this->assertSame('pending_approval', $summary['status']);
            $this->assertNull($summary['finalized_at']);
            $this->assertTrue($summary['results_visible']);
            $this->assertSame('pending', $summary['approval_status']);
        }
    }

    public function test_a_budget_row_carries_its_status_amounts_and_what_was_spent(): void
    {
        config(['approvals.budget_final' => 'SUPER_ADMIN']);
        $budget = Budget::create([
            'organization_id' => $this->organization->id, 'title' => 'Summit', 'allocated_amount' => '5000.00', 'remaining_amount' => '5100.00',
            'warning_threshold' => '500.00', 'submission_status' => 'pending_sao', 'department_head_approved_at' => now(),
        ]);
        foreach ([['expense', '300.00'], ['expense', '150.25'], ['income', '400.00']] as [$type, $amount]) {
            Transaction::create([
                'organization_id' => $this->organization->id, 'recorded_by' => $this->admin->school_id, 'budget_id' => $budget->id, 'type' => $type,
                'amount' => $amount, 'category' => 'Misc', 'description' => 'Entry', 'transaction_date' => '2026-10-05',
            ]);
        }
        $this->approval('budget', $budget->id, ['required_role' => 'SUPER_ADMIN']);

        $summary = $this->summariesFor('budget', $budget->id)[0];

        $this->assertSame('pending_sao', $summary['submission_status']);
        $this->assertSame('5000.00', $summary['allocated_amount']);
        $this->assertSame('5100.00', $summary['remaining_amount']);
        $this->assertSame('450.25', $summary['spent_amount']);
        $this->assertNotNull($summary['department_head_approved_at']);

        Sanctum::actingAs($this->director);
        $listed = collect($this->getJson('/api/approval-requests')->assertOk()->json('data'))->firstWhere('entity_id', $budget->id);
        $this->assertSame('pending_sao', $listed['summary']['submission_status']);
    }

    public function test_a_financial_report_row_carries_its_status_and_the_department_head_approval_date(): void
    {
        $signed = FinancialReport::create([
            'organization_id' => $this->organization->id, 'report_type' => 'monthly', 'title' => 'Signed', 'source_transaction_ids' => [],
            'signatories' => [], 'submission_status' => 'pending_sao', 'generated_by' => $this->admin->school_id, 'generated_at' => now(),
            'submitted_at' => now(), 'department_head_approved_at' => now(),
        ]);
        $unsigned = FinancialReport::create([
            'organization_id' => $this->organization->id, 'report_type' => 'monthly', 'title' => 'Unsigned', 'source_transaction_ids' => [],
            'signatories' => [], 'submission_status' => 'pending_department_head', 'generated_by' => $this->admin->school_id, 'generated_at' => now(),
            'submitted_at' => now(),
        ]);
        $this->approval('financial_report', $signed->id, ['required_role' => 'SUPER_ADMIN']);
        $this->approval('financial_report', $unsigned->id);

        $signedSummary = $this->summariesFor('financial_report', $signed->id)[0];
        $unsignedSummary = $this->summariesFor('financial_report', $unsigned->id)[0];

        $this->assertSame('pending_sao', $signedSummary['submission_status']);
        $this->assertNotNull($signedSummary['department_head_approved_at']);
        $this->assertSame('pending_department_head', $unsignedSummary['submission_status']);
        $this->assertNull($unsignedSummary['department_head_approved_at']);
    }

    public function test_the_show_endpoint_returns_the_same_row_the_list_returns(): void
    {
        $event = $this->eventWithApproval();
        $budget = Budget::create(['organization_id' => $this->organization->id, 'title' => 'B', 'allocated_amount' => 10, 'remaining_amount' => 10, 'warning_threshold' => 1, 'submission_status' => 'pending_department_head']);
        $this->approval('budget', $budget->id);

        $listed = collect($this->submittedRows())->keyBy('id');
        $this->assertCount(2, $listed);

        foreach ([$this->admin, $this->head] as $viewer) {
            Sanctum::actingAs($viewer);
            $awaiting = collect($this->getJson('/api/approval-requests?per_page=100')->assertOk()->json('data'));
            foreach ($awaiting as $row) {
                $this->getJson('/api/approval-requests/'.$row['id'])->assertOk()->assertExactJson($row);
            }
        }
        Sanctum::actingAs($this->admin);
        foreach ($listed as $id => $row) {
            $this->getJson('/api/approval-requests/'.$id)->assertOk()->assertExactJson($row);
        }
        $this->assertSame($event->id, $listed->firstWhere('entity_type', 'event')['entity_id']);
    }

    public function test_the_show_endpoint_hides_what_the_list_hides_with_the_same_body_as_an_unknown_id(): void
    {
        $event = $this->eventWithApproval();
        $row = ApprovalRequest::where('entity_type', 'event')->where('entity_id', $event->id)->firstOrFail();
        $officer = User::factory()->officer()->create(['organization_id' => $this->organization->id]);
        $foreignOfficer = User::factory()->officer()->create(['organization_id' => $this->foreignOrganization->id]);

        Sanctum::actingAs($this->admin);
        $missing = $this->getJson('/api/approval-requests/999999')->assertNotFound()->json();

        foreach ([$this->foreignAdmin, $this->foreignHead, $foreignOfficer, $this->director] as $viewer) {
            Sanctum::actingAs($viewer);
            $this->getJson('/api/approval-requests/'.$row->id)->assertNotFound()->assertExactJson($missing);
        }

        Sanctum::actingAs($officer);
        $this->getJson('/api/approval-requests/'.$row->id)->assertOk()->assertJsonPath('id', $row->id);
        $this->getJson('/api/approval-requests/abc')->assertNotFound()->assertExactJson($missing);

        Sanctum::actingAs(User::factory()->student()->create(['organization_id' => $this->organization->id]));
        $this->getJson('/api/approval-requests/'.$row->id)->assertForbidden();
    }

    public function test_approval_list_query_count_stays_constant_across_a_page(): void
    {
        $queryCount = function (): int {
            $count = 0;
            DB::listen(function () use (&$count) {
                $count++;
            });
            Sanctum::actingAs($this->admin);
            $this->getJson('/api/approval-requests?scope=submitted&status=all&per_page=100')->assertOk();

            return $count;
        };
        $seed = function (): void {
            $event = $this->eventWithApproval();
            Task::factory()->create(['event_id' => $event->id, 'created_by' => $this->admin->school_id, 'assigned_to' => $this->admin->school_id, 'status' => 'completed']);
            Budget::create(['organization_id' => $this->organization->id, 'event_id' => $event->id, 'title' => 'E', 'allocated_amount' => 10, 'remaining_amount' => 10, 'warning_threshold' => 1, 'submission_status' => 'approved']);
            $budget = Budget::create(['organization_id' => $this->organization->id, 'title' => 'B', 'allocated_amount' => 10, 'remaining_amount' => 10, 'warning_threshold' => 1, 'submission_status' => 'approved']);
            Transaction::create([
                'organization_id' => $this->organization->id, 'recorded_by' => $this->admin->school_id, 'budget_id' => $budget->id, 'type' => 'expense',
                'amount' => '3.00', 'category' => 'Misc', 'description' => 'Entry', 'transaction_date' => '2026-10-05',
            ]);
            $this->approval('budget', $budget->id);
            $election = Election::factory()->create(['organization_id' => $this->organization->id, 'status' => 'upcoming']);
            $this->approval('election', $election->id);
            $closed = Election::factory()->create(['organization_id' => $this->organization->id, 'status' => 'closed']);
            $this->approval('election', $closed->id, ['status' => 'approved']);
        };

        $seed();
        $before = $queryCount();
        foreach (range(1, 6) as $ignored) {
            $seed();
        }
        $after = $queryCount();

        $this->assertSame(28, collect($this->submittedRows())->count());
        $this->assertSame($before, $after);
    }
}
