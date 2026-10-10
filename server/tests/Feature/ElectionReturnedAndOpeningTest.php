<?php

namespace Tests\Feature;

use App\Jobs\NotifyApproversJob;
use App\Models\ApprovalRequest;
use App\Models\AuditLog;
use App\Models\Election;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

class ElectionReturnedAndOpeningTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private function world(): array
    {
        $computing = $this->makeCollege('CCS');
        $business = $this->makeCollege('CBE');
        $organization = $this->makeCollegeStudentOrganization($computing);

        return [
            'organization' => $organization,
            'admin' => User::factory()->admin()->create(['organization_id' => $organization->id]),
            'officer' => User::factory()->officer()->create(['organization_id' => $organization->id]),
            'student' => User::factory()->student()->create(['organization_id' => $organization->id]),
            'head' => $this->makeCollegeHead($computing),
            'otherHead' => $this->makeCollegeHead($business),
            'otherAdmin' => User::factory()->admin()->create(['organization_id' => $this->makeCollegeStudentOrganization($business)->id]),
        ];
    }

    private function pendingElection(Organization $organization, User $admin, array $attributes = []): array
    {
        $election = Election::factory()->create([
            'organization_id' => $organization->id,
            'status' => 'pending_approval',
            'start_time' => now()->addDays(2),
            'end_time' => now()->addDays(3),
            ...$attributes,
        ]);
        $approval = ApprovalRequest::create([
            'organization_id' => $organization->id,
            'entity_type' => 'election',
            'entity_id' => $election->id,
            'requested_by' => $admin->school_id,
            'required_role' => config('approvals.routes.election'),
            'status' => 'pending',
        ]);

        return [$election, $approval];
    }

    private function openable(Organization $organization, array $attributes = []): Election
    {
        return Election::factory()->create([
            'organization_id' => $organization->id,
            'status' => 'upcoming',
            'approved_at' => now()->subDay(),
            'finalized_at' => now()->subHour(),
            'start_time' => now()->subHour(),
            'end_time' => now()->addHour(),
            ...$attributes,
        ]);
    }

    public function test_rejection_leaves_a_returned_election_with_the_reviewer_remarks_in_every_payload(): void
    {
        ['organization' => $organization, 'admin' => $admin, 'head' => $head] = $this->world();
        [$election, $approval] = $this->pendingElection($organization, $admin);

        Sanctum::actingAs($admin);
        $this->getJson('/api/elections')->assertOk()
            ->assertJsonPath('0.approval_status', 'pending')
            ->assertJsonPath('0.approval_remarks', null)
            ->assertJsonPath('0.approval_id', $approval->id);

        Sanctum::actingAs($head);
        $this->patchJson('/api/approval-requests/'.$approval->id, ['status' => 'rejected', 'remarks' => 'Move the date outside exam week.'])->assertOk();

        $this->assertSame('pending_approval', $election->fresh()->status);

        foreach ([$head, $admin] as $viewer) {
            Sanctum::actingAs($viewer);
            $this->getJson('/api/elections')->assertOk()
                ->assertJsonPath('0.status', 'pending_approval')
                ->assertJsonPath('0.approval_status', 'rejected')
                ->assertJsonPath('0.approval_remarks', 'Move the date outside exam week.')
                ->assertJsonPath('0.approval_id', $approval->id);
            $this->getJson('/api/elections/'.$election->id)->assertOk()
                ->assertJsonPath('approval_status', 'rejected')
                ->assertJsonPath('approval_remarks', 'Move the date outside exam week.')
                ->assertJsonPath('approval_id', $approval->id);
        }
    }

    public function test_payload_carries_lifecycle_fields_and_the_latest_approval_after_approval(): void
    {
        ['organization' => $organization, 'admin' => $admin, 'head' => $head] = $this->world();
        [$election, $approval] = $this->pendingElection($organization, $admin);

        Sanctum::actingAs($head);
        $this->patchJson('/api/approval-requests/'.$approval->id, ['status' => 'approved'])->assertOk();

        Sanctum::actingAs($admin);
        $payload = $this->getJson('/api/elections/'.$election->id)->assertOk()
            ->assertJsonPath('status', 'upcoming')
            ->assertJsonPath('approval_status', 'approved')
            ->assertJsonPath('approval_id', $approval->id)
            ->json();
        $this->assertArrayHasKey('finalized_at', $payload);
        $this->assertArrayHasKey('results_visible', $payload);
        $this->assertNotNull($payload['approved_at']);
    }

    public function test_students_do_not_receive_approval_fields(): void
    {
        ['organization' => $organization, 'admin' => $admin, 'student' => $student] = $this->world();
        $election = $this->openable($organization, ['status' => 'active']);
        ApprovalRequest::create([
            'organization_id' => $organization->id,
            'entity_type' => 'election',
            'entity_id' => $election->id,
            'requested_by' => $admin->school_id,
            'required_role' => 'DEPARTMENT_HEAD',
            'status' => 'approved',
            'remarks' => 'Internal note.',
        ]);

        Sanctum::actingAs($student);
        $list = $this->getJson('/api/elections')->assertOk()->json();
        $this->assertCount(1, $list);
        $this->assertArrayNotHasKey('approval_remarks', $list[0]);
        $this->assertArrayNotHasKey('approval_status', $list[0]);
        $this->assertArrayNotHasKey('approval_remarks', $this->getJson('/api/elections/'.$election->id)->assertOk()->json());
    }

    public function test_resubmitting_after_a_rejection_reopens_the_heads_approval(): void
    {
        ['organization' => $organization, 'admin' => $admin, 'head' => $head] = $this->world();
        [$election, $approval] = $this->pendingElection($organization, $admin);
        Sanctum::actingAs($head);
        $this->patchJson('/api/approval-requests/'.$approval->id, ['status' => 'rejected', 'remarks' => 'Fix the dates.'])->assertOk();

        Bus::fake([NotifyApproversJob::class]);
        Sanctum::actingAs($admin);
        $this->putJson('/api/elections/'.$election->id, ['start_time' => now()->addDays(10)->toDateTimeString(), 'end_time' => now()->addDays(11)->toDateTimeString()])
            ->assertOk()
            ->assertJsonPath('status', 'pending_approval')
            ->assertJsonPath('approval_status', 'pending')
            ->assertJsonPath('approval_remarks', null)
            ->assertJsonPath('approval_id', $approval->id);

        $approval->refresh();
        $this->assertSame('pending', $approval->status);
        $this->assertNull($approval->remarks);
        $this->assertNull($approval->reviewed_by);
        Bus::assertDispatched(NotifyApproversJob::class, fn (NotifyApproversJob $job) => $job->approval->is($approval));
        $this->assertTrue(AuditLog::where('module', 'approvals')->where('action', 'resubmitted')->where('record_id', $approval->id)->exists());

        $this->getJson('/api/elections')->assertOk()->assertJsonPath('0.approval_status', 'pending');

        Sanctum::actingAs($head);
        $this->patchJson('/api/approval-requests/'.$approval->id, ['status' => 'approved'])->assertOk();
        $this->assertSame('upcoming', $election->fresh()->status);
    }

    public function test_only_the_admin_of_the_organization_can_resubmit(): void
    {
        ['organization' => $organization, 'admin' => $admin, 'officer' => $officer, 'student' => $student, 'head' => $head, 'otherAdmin' => $otherAdmin] = $this->world();
        [$election, $approval] = $this->pendingElection($organization, $admin);
        Sanctum::actingAs($head);
        $this->patchJson('/api/approval-requests/'.$approval->id, ['status' => 'rejected', 'remarks' => 'No.'])->assertOk();

        $body = ['title' => 'Retitled'];
        Sanctum::actingAs($otherAdmin);
        $this->putJson('/api/elections/'.$election->id, $body)->assertNotFound();
        foreach ([$officer, $student, $head] as $user) {
            Sanctum::actingAs($user);
            $this->putJson('/api/elections/'.$election->id, $body)->assertForbidden();
        }

        $this->assertSame('rejected', $approval->fresh()->status);
        $this->assertNotSame('Retitled', $election->fresh()->title);
    }

    public function test_a_head_of_another_college_cannot_see_or_reject_the_election(): void
    {
        ['organization' => $organization, 'admin' => $admin, 'otherHead' => $otherHead] = $this->world();
        [$election, $approval] = $this->pendingElection($organization, $admin);

        Sanctum::actingAs($otherHead);
        $this->getJson('/api/elections')->assertOk()->assertExactJson([]);
        $this->getJson('/api/elections/'.$election->id)->assertNotFound();
        $this->patchJson('/api/approval-requests/'.$approval->id, ['status' => 'rejected', 'remarks' => 'Not mine.'])->assertNotFound();
        $this->assertSame('pending', $approval->fresh()->status);
    }

    public function test_election_page_query_count_does_not_grow_with_the_number_of_elections(): void
    {
        ['organization' => $organization, 'admin' => $admin] = $this->world();
        Sanctum::actingAs($admin);
        $count = function (): int {
            DB::flushQueryLog();
            DB::enableQueryLog();
            $this->getJson('/api/elections')->assertOk();
            $queries = count(DB::getQueryLog());
            DB::disableQueryLog();

            return $queries;
        };

        $this->pendingElection($organization, $admin);
        $count();
        $few = $count();
        foreach (range(1, 12) as $ignored) {
            $this->pendingElection($organization, $admin);
        }

        $this->assertSame($few, $count());
    }

    public function test_command_opens_exactly_the_approved_finalized_elections_whose_window_is_running(): void
    {
        ['organization' => $organization] = $this->world();
        $due = $this->openable($organization);
        $unfinalized = $this->openable($organization, ['finalized_at' => null]);
        $notStarted = $this->openable($organization, ['start_time' => now()->addHour(), 'end_time' => now()->addDay()]);
        $ended = $this->openable($organization, ['start_time' => now()->subDay(), 'end_time' => now()->subHour()]);
        $closed = $this->openable($organization, ['status' => 'closed']);
        $rejected = $this->openable($organization, ['status' => 'pending_approval', 'approved_at' => null, 'finalized_at' => null]);
        $active = $this->openable($organization, ['status' => 'active']);

        $this->artisan('elections:sync-statuses')->assertSuccessful();

        $this->assertSame('active', $due->fresh()->status);
        $this->assertSame('upcoming', $unfinalized->fresh()->status);
        $this->assertSame('upcoming', $notStarted->fresh()->status);
        $this->assertSame('closed', $ended->fresh()->status);
        $this->assertSame('closed', $closed->fresh()->status);
        $this->assertSame('pending_approval', $rejected->fresh()->status);
        $this->assertSame('active', $active->fresh()->status);

        $before = Election::orderBy('id')->pluck('status', 'id')->all();
        Artisan::call('elections:sync-statuses');
        $this->assertSame($before, Election::orderBy('id')->pluck('status', 'id')->all());
    }

    public function test_command_is_scheduled_every_minute_without_overlapping(): void
    {
        $event = collect(app(Schedule::class)->events())
            ->first(fn ($event) => str_contains($event->command, 'elections:sync-statuses'));

        $this->assertNotNull($event);
        $this->assertSame('* * * * *', $event->expression);
        $this->assertTrue($event->withoutOverlapping);
    }

    public function test_requests_open_and_close_elections_lazily_without_the_command(): void
    {
        ['organization' => $organization, 'admin' => $admin, 'student' => $student] = $this->world();
        $due = $this->openable($organization);
        $ended = $this->openable($organization, ['start_time' => now()->subDay(), 'end_time' => now()->subHour()]);
        $unfinalized = $this->openable($organization, ['finalized_at' => null]);
        $notStarted = $this->openable($organization, ['start_time' => now()->addHour(), 'end_time' => now()->addDay()]);

        Sanctum::actingAs($admin);
        $this->getJson('/api/elections')->assertOk();

        $this->assertSame('active', $due->fresh()->status);
        $this->assertSame('closed', $ended->fresh()->status);
        $this->assertSame('upcoming', $unfinalized->fresh()->status);
        $this->assertSame('upcoming', $notStarted->fresh()->status);

        $late = $this->openable($organization);
        Sanctum::actingAs($student);
        $this->getJson('/api/elections/'.$late->id)->assertOk()->assertJsonPath('status', 'active');
    }
}
