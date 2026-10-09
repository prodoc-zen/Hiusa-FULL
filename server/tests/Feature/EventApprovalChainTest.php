<?php

namespace Tests\Feature;

use App\Models\ApprovalRequest;
use App\Models\Budget;
use App\Models\Event;
use App\Models\EventRequirement;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

class EventApprovalChainTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private Organization $organization;

    private User $admin;

    private User $head;

    private User $director;

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
    }

    private function requirement(array $overrides = []): EventRequirement
    {
        return EventRequirement::create([
            'name' => 'Event proposal',
            'allowed_extensions' => ['pdf'],
            'is_active' => true,
            'is_optional' => false,
            'venue_type' => 'all',
            'sort_order' => 1,
            ...$overrides,
        ]);
    }

    private function propose(string $title = 'General Assembly'): int
    {
        Sanctum::actingAs($this->admin);

        return $this->postJson('/api/events', [
            'title' => $title,
            'start_time' => now()->addWeek()->toDateTimeString(),
            'end_time' => now()->addWeek()->addHours(2)->toDateTimeString(),
        ])->assertCreated()->json('id');
    }

    private function upload(int $eventId, EventRequirement ...$requirements)
    {
        Sanctum::actingAs($this->admin);

        return $this->post('/api/events/'.$eventId.'/submission', [
            'documents' => collect($requirements)->mapWithKeys(fn (EventRequirement $requirement) => [
                $requirement->id => UploadedFile::fake()->create('file-'.$requirement->id.'.pdf', 20, 'application/pdf'),
            ])->all(),
        ]);
    }

    private function decide(User $reviewer, ApprovalRequest $approval, string $status = 'approved', ?string $remarks = null)
    {
        Sanctum::actingAs($reviewer);

        return $this->patchJson('/api/approval-requests/'.$approval->id, array_filter(['status' => $status, 'remarks' => $remarks]));
    }

    private function headRow(int $eventId): ?ApprovalRequest
    {
        return ApprovalRequest::where('entity_type', 'event')->where('entity_id', $eventId)->where('required_role', 'DEPARTMENT_HEAD')->first();
    }

    private function saoRow(int $eventId): ?ApprovalRequest
    {
        return ApprovalRequest::where('entity_type', 'event')->where('entity_id', $eventId)->where('required_role', 'SUPER_ADMIN')->first();
    }

    private function payload(int $eventId, ?User $viewer = null): array
    {
        Sanctum::actingAs($viewer ?? $this->admin);

        return $this->getJson('/api/events/'.$eventId)->assertOk()->json();
    }

    public function test_creating_an_event_always_opens_the_department_head_approval_even_with_sao_requirements(): void
    {
        $this->requirement();
        $eventId = $this->propose();

        $row = $this->headRow($eventId);
        $this->assertSame('pending', $row->status);
        $this->assertSame($this->organization->id, $row->organization_id);
        $this->assertNull($this->saoRow($eventId));
        $this->assertDatabaseHas('notifications', ['user_id' => $this->head->school_id, 'message' => 'Event "General Assembly" requires your review.']);

        $payload = $this->payload($eventId);
        $this->assertSame('awaiting_department_head', $payload['approval_stage']);
        $this->assertSame($row->id, $payload['approval_id']);
        $this->assertSame('DEPARTMENT_HEAD', $payload['approval_required_role']);
        $this->assertTrue($payload['requirements_required']);
        $this->assertFalse($payload['requirements_submitted']);
    }

    public function test_creating_an_event_without_requirements_opens_the_same_head_approval(): void
    {
        $eventId = $this->propose();

        $this->assertSame('pending', $this->headRow($eventId)->status);
        $payload = $this->payload($eventId);
        $this->assertSame('awaiting_department_head', $payload['approval_stage']);
        $this->assertFalse($payload['requirements_required']);
        $this->assertFalse($payload['requirements_submitted']);
    }

    public function test_head_approval_without_requirements_approves_the_event(): void
    {
        $eventId = $this->propose();

        $this->decide($this->head, $this->headRow($eventId))->assertOk();

        $this->assertDatabaseHas('events', ['id' => $eventId, 'status' => 'approved']);
        $this->assertNull($this->saoRow($eventId));
        $this->assertSame('approved', $this->payload($eventId)['approval_stage']);
    }

    public function test_head_approval_with_requirements_keeps_the_event_planning_until_the_admin_uploads_the_files(): void
    {
        $requirement = $this->requirement();
        $eventId = $this->propose();

        $this->decide($this->head, $this->headRow($eventId))->assertOk();

        $this->assertDatabaseHas('events', ['id' => $eventId, 'status' => 'planning', 'approved_at' => null]);
        $this->assertNull($this->saoRow($eventId));
        $payload = $this->payload($eventId);
        $this->assertSame('awaiting_requirements', $payload['approval_stage']);
        $this->assertNull($payload['approval_required_role']);
        $this->assertTrue($payload['requirements_required']);
        $this->assertFalse($payload['requirements_submitted']);
        $this->assertDatabaseHas('notifications', [
            'user_id' => $this->admin->school_id,
            'title' => 'Approval Request Approved',
            'message' => 'Event "General Assembly" was approved by the Department Head. Upload the SAO event files to continue.',
        ]);

        $this->upload($eventId, $requirement)->assertOk();

        $sao = $this->saoRow($eventId);
        $this->assertSame('pending', $sao->status);
        $this->assertSame($this->organization->id, $sao->organization_id);
        $this->assertDatabaseHas('notifications', ['user_id' => $this->director->school_id, 'reference_type' => 'approval_request', 'reference_id' => $sao->id]);
        $payload = $this->payload($eventId);
        $this->assertSame('awaiting_sao', $payload['approval_stage']);
        $this->assertSame($sao->id, $payload['approval_id']);
        $this->assertSame('SUPER_ADMIN', $payload['approval_required_role']);
        $this->assertTrue($payload['requirements_submitted']);
    }

    public function test_files_uploaded_before_the_head_decides_open_the_sao_request_on_the_head_approval(): void
    {
        $requirement = $this->requirement();
        $eventId = $this->propose();

        $this->upload($eventId, $requirement)->assertOk();

        $this->assertNull($this->saoRow($eventId));
        $payload = $this->payload($eventId);
        $this->assertSame('awaiting_department_head', $payload['approval_stage']);
        $this->assertTrue($payload['requirements_submitted']);
        Sanctum::actingAs($this->director);
        $this->getJson('/api/events/'.$eventId.'/submission')->assertNotFound();

        $this->decide($this->head, $this->headRow($eventId))->assertOk();

        $this->assertDatabaseHas('events', ['id' => $eventId, 'status' => 'planning']);
        $this->assertSame('pending', $this->saoRow($eventId)->status);
        $this->getJson('/api/events/'.$eventId.'/submission')->assertOk()->assertJsonCount(1, 'files');
        $this->assertSame('awaiting_sao', $this->payload($eventId)['approval_stage']);
        $this->assertDatabaseHas('notifications', [
            'user_id' => $this->admin->school_id,
            'message' => 'Event "General Assembly" was approved by the Department Head. It is now with the Student Affairs Office.',
        ]);
    }

    public function test_sao_approval_approves_the_event(): void
    {
        $requirement = $this->requirement();
        $eventId = $this->propose();
        $this->decide($this->head, $this->headRow($eventId))->assertOk();
        $this->upload($eventId, $requirement)->assertOk();

        $this->decide($this->director, $this->saoRow($eventId))->assertOk();

        $this->assertDatabaseHas('events', ['id' => $eventId, 'status' => 'approved']);
        $payload = $this->payload($eventId);
        $this->assertSame('approved', $payload['approval_stage']);
        $this->assertNull($payload['approval_required_role']);
    }

    public function test_sao_decision_is_refused_with_409_while_the_head_approval_is_pending(): void
    {
        $this->requirement();
        $eventId = $this->propose();
        $sao = ApprovalRequest::create([
            'organization_id' => $this->organization->id,
            'entity_type' => 'event',
            'entity_id' => $eventId,
            'requested_by' => $this->admin->school_id,
            'required_role' => 'SUPER_ADMIN',
        ]);

        $this->decide($this->director, $sao)->assertStatus(409)
            ->assertJsonPath('message', 'The Department Head must approve this event before the SAO can decide it.');

        $this->assertSame('pending', $sao->fresh()->status);
        $this->assertDatabaseHas('events', ['id' => $eventId, 'status' => 'planning']);
    }

    public function test_a_legacy_event_with_only_an_sao_request_can_still_be_approved_by_the_sao(): void
    {
        $event = Event::factory()->create([
            'organization_id' => $this->organization->id,
            'created_by' => $this->admin->id,
            'status' => 'planning',
        ]);
        $sao = ApprovalRequest::create([
            'organization_id' => $this->organization->id,
            'entity_type' => 'event',
            'entity_id' => $event->id,
            'requested_by' => $this->admin->school_id,
            'required_role' => 'SUPER_ADMIN',
        ]);

        $this->assertSame('awaiting_sao', $this->payload($event->id)['approval_stage']);
        $this->decide($this->director, $sao)->assertOk();

        $this->assertDatabaseHas('events', ['id' => $event->id, 'status' => 'approved']);
    }

    public function test_head_rejection_returns_the_event_and_an_edit_resubmits_to_the_head(): void
    {
        $requirement = $this->requirement();
        $eventId = $this->propose();
        $row = $this->headRow($eventId);

        $this->decide($this->head, $row, 'rejected', 'Wrong venue.')->assertOk();

        $payload = $this->payload($eventId);
        $this->assertSame('rejected', $payload['approval_stage']);
        $this->assertSame('Wrong venue.', $payload['approval_remarks']);
        $this->assertNull($payload['approval_required_role']);

        Sanctum::actingAs($this->admin);
        $this->putJson('/api/events/'.$eventId, ['location' => 'Gymnasium'])->assertOk();

        $this->assertSame('pending', $row->fresh()->status);
        $this->assertSame('awaiting_department_head', $this->payload($eventId)['approval_stage']);
        $this->assertNull($this->saoRow($eventId));
        $this->decide($this->head, $row->fresh())->assertOk();
        $this->assertSame('awaiting_requirements', $this->payload($eventId)['approval_stage']);
        $this->upload($eventId, $requirement)->assertOk();
        $this->assertSame('awaiting_sao', $this->payload($eventId)['approval_stage']);
    }

    public function test_sao_rejection_returns_the_files_and_a_reupload_reopens_the_same_request(): void
    {
        $requirement = $this->requirement();
        $eventId = $this->propose();
        $this->decide($this->head, $this->headRow($eventId))->assertOk();
        $this->upload($eventId, $requirement)->assertOk();
        $sao = $this->saoRow($eventId);

        $this->decide($this->director, $sao, 'rejected', 'Signature missing.')->assertOk();

        $payload = $this->payload($eventId);
        $this->assertSame('requirements_returned', $payload['approval_stage']);
        $this->assertSame($sao->id, $payload['approval_id']);
        $this->assertSame('Signature missing.', $payload['approval_remarks']);
        $this->assertDatabaseHas('events', ['id' => $eventId, 'status' => 'planning']);

        $this->upload($eventId, $requirement)->assertOk();

        $this->assertSame('pending', $sao->fresh()->status);
        $this->assertSame(1, ApprovalRequest::where('entity_type', 'event')->where('entity_id', $eventId)->where('required_role', 'SUPER_ADMIN')->count());
        $this->assertSame('awaiting_sao', $this->payload($eventId)['approval_stage']);
    }

    public function test_files_cannot_be_replaced_while_the_sao_is_reviewing_them(): void
    {
        $requirement = $this->requirement();
        $eventId = $this->propose();
        $this->decide($this->head, $this->headRow($eventId))->assertOk();
        $this->upload($eventId, $requirement)->assertOk();

        $this->upload($eventId, $requirement)->assertStatus(409);
    }

    public function test_editing_an_approved_event_restarts_the_chain_at_the_head(): void
    {
        $requirement = $this->requirement();
        $eventId = $this->propose();
        $this->decide($this->head, $this->headRow($eventId))->assertOk();
        $this->upload($eventId, $requirement)->assertOk();
        $sao = $this->saoRow($eventId);
        $this->decide($this->director, $sao)->assertOk();

        Sanctum::actingAs($this->admin);
        $this->putJson('/api/events/'.$eventId, ['title' => 'General Assembly 2'])->assertOk()->assertJsonPath('status', 'planning');

        $this->assertSame('pending', $this->headRow($eventId)->status);
        $this->assertSame('awaiting_department_head', $this->payload($eventId)['approval_stage']);

        $this->decide($this->head, $this->headRow($eventId))->assertOk();

        $this->assertSame('pending', $sao->fresh()->status);
        $this->assertSame(1, ApprovalRequest::where('entity_type', 'event')->where('entity_id', $eventId)->where('required_role', 'SUPER_ADMIN')->count());
        $this->assertSame('awaiting_sao', $this->payload($eventId)['approval_stage']);
    }

    public function test_a_head_from_another_college_cannot_see_or_decide_the_event_approvals(): void
    {
        $eventId = $this->propose();
        $row = $this->headRow($eventId);
        $otherHead = $this->makeCollegeHead($this->makeCollege('CBE'));

        $this->decide($otherHead, $row)->assertNotFound();
        $this->assertSame('pending', $row->fresh()->status);
        $this->getJson('/api/events/'.$eventId)->assertNotFound();
        $this->getJson('/api/events/'.$eventId.'/submission')->assertNotFound();
    }

    public function test_only_the_required_role_decides_each_request_and_self_review_is_blocked(): void
    {
        $this->requirement();
        $eventId = $this->propose();
        $headRow = $this->headRow($eventId);

        $this->decide($this->admin, $headRow)->assertForbidden();
        $this->decide($this->director, $headRow)->assertForbidden();

        $this->decide($this->head, $headRow)->assertOk();
        $sao = ApprovalRequest::create([
            'organization_id' => $this->organization->id,
            'entity_type' => 'event',
            'entity_id' => $eventId,
            'requested_by' => $this->admin->school_id,
            'required_role' => 'SUPER_ADMIN',
        ]);
        $this->decide($this->head, $sao)->assertForbidden();
        $this->decide($this->admin, $sao)->assertForbidden();
    }

    public function test_approval_stage_covers_every_stage_and_event_lists_stay_at_a_constant_query_count(): void
    {
        $requirement = $this->requirement();
        $stages = [];

        $stages['not_submitted'] = Event::factory()->create(['organization_id' => $this->organization->id, 'created_by' => $this->admin->id, 'status' => 'planning'])->id;
        $stages['awaiting_department_head'] = $this->propose('Awaiting head');
        $stages['rejected'] = $this->propose('Rejected');
        $this->decide($this->head, $this->headRow($stages['rejected']), 'rejected', 'No.')->assertOk();
        $stages['awaiting_requirements'] = $this->propose('Awaiting files');
        $this->decide($this->head, $this->headRow($stages['awaiting_requirements']))->assertOk();
        $stages['awaiting_sao'] = $this->propose('Awaiting SAO');
        $this->decide($this->head, $this->headRow($stages['awaiting_sao']))->assertOk();
        $this->upload($stages['awaiting_sao'], $requirement)->assertOk();
        $stages['requirements_returned'] = $this->propose('Returned');
        $this->decide($this->head, $this->headRow($stages['requirements_returned']))->assertOk();
        $this->upload($stages['requirements_returned'], $requirement)->assertOk();
        $this->decide($this->director, $this->saoRow($stages['requirements_returned']), 'rejected', 'Redo.')->assertOk();
        $stages['approved'] = $this->propose('Approved');
        $this->decide($this->head, $this->headRow($stages['approved']))->assertOk();
        $this->upload($stages['approved'], $requirement)->assertOk();
        $this->decide($this->director, $this->saoRow($stages['approved']))->assertOk();

        Sanctum::actingAs($this->admin);
        $rows = collect($this->getJson('/api/events?per_page=50')->assertOk()->json('data'))->keyBy('id');
        foreach ($stages as $stage => $id) {
            $this->assertSame($stage, $rows[$id]['approval_stage'], 'stage of '.$stage);
        }
        $this->assertCount(7, $rows);

        $queryCount = function (): int {
            $count = 0;
            DB::listen(function () use (&$count) {
                $count++;
            });
            Sanctum::actingAs($this->admin);
            $this->getJson('/api/events?per_page=50')->assertOk();

            return $count;
        };
        $before = $queryCount();
        foreach (range(1, 6) as $number) {
            $id = $this->propose('Extra '.$number);
            if ($number % 2 === 0) {
                $this->decide($this->head, $this->headRow($id))->assertOk();
            }
        }
        $after = $queryCount();

        $this->assertSame($before, $after);
    }

    public function test_requirements_required_follows_the_venue_type_of_the_event(): void
    {
        $this->requirement(['venue_type' => 'off_campus']);

        $onCampusEventId = $this->propose('On campus');
        $this->assertFalse($this->payload($onCampusEventId)['requirements_required']);

        Sanctum::actingAs($this->admin);
        $offCampusEventId = $this->postJson('/api/events', [
            'title' => 'Field trip',
            'start_time' => now()->addWeek()->toDateTimeString(),
            'end_time' => now()->addWeek()->addHours(2)->toDateTimeString(),
            'location' => 'Tagaytay',
            'planning_details' => ['venue_type' => 'off_campus'],
        ])->assertCreated()->json('id');
        $this->assertTrue($this->payload($offCampusEventId)['requirements_required']);
    }

    public function test_submitted_scope_lists_what_the_organization_filed_across_entity_types(): void
    {
        $eventId = $this->propose('Mine');
        $event = Event::findOrFail($eventId);
        $budget = Budget::create([
            'organization_id' => $this->organization->id, 'event_id' => $eventId, 'title' => 'Mine Budget',
            'allocated_amount' => 100, 'remaining_amount' => 100, 'warning_threshold' => 0,
        ]);
        $budgetRow = ApprovalRequest::create([
            'organization_id' => $this->organization->id, 'entity_type' => 'budget', 'entity_id' => $budget->id,
            'requested_by' => $this->admin->school_id, 'required_role' => 'DEPARTMENT_HEAD', 'requested_at' => now()->addMinute(),
        ]);
        $foreign = $this->makeCollegeStudentOrganization($this->makeCollege('CBE'));
        $foreignAdmin = User::factory()->admin()->create(['organization_id' => $foreign->id]);
        $foreignEvent = Event::factory()->create(['organization_id' => $foreign->id, 'created_by' => $foreignAdmin->id, 'status' => 'planning']);
        ApprovalRequest::create([
            'organization_id' => $foreign->id, 'entity_type' => 'event', 'entity_id' => $foreignEvent->id,
            'requested_by' => $foreignAdmin->school_id, 'required_role' => 'DEPARTMENT_HEAD',
        ]);
        $this->decide($this->head, $this->headRow($eventId), 'rejected', 'Redo.')->assertOk();

        Sanctum::actingAs($this->admin);
        $response = $this->getJson('/api/approval-requests?scope=submitted')->assertOk();

        $this->assertSame([$budgetRow->id, $this->headRow($eventId)->id], $response->json('data.*.id'));
        $this->assertSame(['budget', 'event'], $response->json('data.*.entity_type'));
        $this->assertSame(['Mine Budget', $event->title], $response->json('data.*.title'));
        $this->assertSame(['pending', 'rejected'], $response->json('data.*.status'));
        $this->assertNotContains($foreignEvent->id, $response->json('data.*.entity_id'));

        $this->getJson('/api/approval-requests?scope=submitted&entity_type=event&status=rejected')->assertOk()->assertJsonCount(1, 'data');
        $this->assertSame([], $this->getJson('/api/approval-requests')->assertOk()->json('data'));
    }

    public function test_submitted_scope_is_open_to_officers_for_their_own_organization_only(): void
    {
        $eventId = $this->propose();
        $officer = User::factory()->officer()->create(['organization_id' => $this->organization->id]);
        $foreign = $this->makeCollegeStudentOrganization($this->makeCollege('CBE'));
        $foreignOfficer = User::factory()->officer()->create(['organization_id' => $foreign->id]);

        Sanctum::actingAs($officer);
        $this->getJson('/api/approval-requests?scope=submitted')->assertOk()->assertJsonPath('data.0.entity_id', $eventId);
        $this->getJson('/api/approval-requests')->assertForbidden();

        Sanctum::actingAs($foreignOfficer);
        $this->getJson('/api/approval-requests?scope=submitted')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/approval-requests?scope=submitted&organization_id='.$this->organization->id)->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_submitted_scope_is_empty_not_an_error_for_the_head_and_the_sao(): void
    {
        $this->propose();

        Sanctum::actingAs($this->head);
        $this->getJson('/api/approval-requests?scope=submitted')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/approval-requests?scope=submitted&organization_id='.$this->organization->id)->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/approval-requests')->assertOk()->assertJsonCount(1, 'data');

        Sanctum::actingAs($this->director);
        $this->getJson('/api/approval-requests?scope=submitted')->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_an_unknown_scope_is_rejected(): void
    {
        Sanctum::actingAs($this->admin);

        $this->getJson('/api/approval-requests?scope=everything')->assertUnprocessable();
    }

    public function test_notifications_to_the_admin_are_written_once_per_transition(): void
    {
        $requirement = $this->requirement();
        $eventId = $this->propose();
        $this->decide($this->head, $this->headRow($eventId))->assertOk();
        $this->upload($eventId, $requirement)->assertOk();
        $this->decide($this->director, $this->saoRow($eventId))->assertOk();

        $titles = Notification::where('user_id', $this->admin->school_id)->orderBy('id')->pluck('title')->all();

        $this->assertSame(['Approval Request Approved', 'Approval Request Approved'], $titles);
    }
}
