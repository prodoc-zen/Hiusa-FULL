<?php

namespace Tests\Feature;

use App\Models\ApprovalRequest;
use App\Models\Budget;
use App\Models\EventRequirement;
use App\Models\EventRequirementFile;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

class EventFileReviewTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private Organization $organization;

    private User $admin;

    private User $head;

    private User $director;

    private EventRequirement $proposal;

    private EventRequirement $permit;

    protected function setUp(): void
    {
        parent::setUp();
        config(['performance.api_cache.enabled' => false]);
        Storage::fake('local');
        $college = $this->makeCollege('CCS');
        $this->organization = $this->makeCollegeStudentOrganization($college);
        $this->head = $this->makeCollegeHead($college);
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        $this->director = User::factory()->superAdmin()->create([
            'organization_id' => Organization::where('slug', 'student-affairs-office')->firstOrFail()->id,
        ]);
        $this->proposal = EventRequirement::create(['name' => 'Event proposal', 'allowed_extensions' => ['pdf'], 'is_active' => true, 'is_optional' => false, 'venue_type' => 'all', 'sort_order' => 1]);
        $this->permit = EventRequirement::create(['name' => 'Venue permit', 'allowed_extensions' => ['pdf'], 'is_active' => true, 'is_optional' => false, 'venue_type' => 'all', 'sort_order' => 2]);
    }

    /** An event with both files uploaded and the Department Head row waiting. */
    private function eventWithFiles(): int
    {
        Sanctum::actingAs($this->admin);
        $eventId = $this->postJson('/api/events', [
            'title' => 'General Assembly',
            'start_time' => now()->addWeek()->toDateTimeString(),
            'end_time' => now()->addWeek()->addHours(2)->toDateTimeString(),
        ])->assertCreated()->json('id');
        $this->upload($eventId, $this->proposal, $this->permit)->assertOk();

        return $eventId;
    }

    private function upload(int $eventId, EventRequirement ...$requirements)
    {
        Sanctum::actingAs($this->admin);

        return $this->post('/api/events/'.$eventId.'/submission', [
            'documents' => collect($requirements)->mapWithKeys(fn (EventRequirement $requirement) => [
                $requirement->id => UploadedFile::fake()->create('new-'.$requirement->id.'.pdf', 20, 'application/pdf'),
            ])->all(),
        ], ['Accept' => 'application/json']);
    }

    private function row(int $eventId, string $role): ApprovalRequest
    {
        return ApprovalRequest::where('entity_type', 'event')->where('entity_id', $eventId)->where('required_role', $role)->firstOrFail();
    }

    private function fileId(int $eventId, EventRequirement $requirement): int
    {
        return EventRequirementFile::where('event_id', $eventId)->where('requirement_id', $requirement->id)->value('id');
    }

    private function decide(User $reviewer, ApprovalRequest $approval, string $status, array $files = [], ?string $remarks = null)
    {
        Sanctum::actingAs($reviewer);

        return $this->patchJson('/api/approval-requests/'.$approval->id, array_filter([
            'status' => $status,
            'remarks' => $remarks,
            'files' => $files,
        ]));
    }

    public function test_the_head_returns_an_event_with_a_note_on_one_file_and_the_organization_sees_it(): void
    {
        $eventId = $this->eventWithFiles();
        $proposalId = $this->fileId($eventId, $this->proposal);
        $permitId = $this->fileId($eventId, $this->permit);

        $this->decide($this->head, $this->row($eventId, 'DEPARTMENT_HEAD'), 'rejected', [
            ['id' => $proposalId, 'status' => 'ok'],
            ['id' => $permitId, 'status' => 'needs_changes', 'note' => 'The permit is expired.'],
        ], 'Fix the permit.')->assertOk();

        $this->assertDatabaseHas('event_requirement_file_reviews', ['event_requirement_file_id' => $permitId, 'stage' => 'dean', 'status' => 'needs_changes', 'note' => 'The permit is expired.', 'reviewed_by' => $this->head->school_id]);
        $this->assertDatabaseHas('event_requirement_file_reviews', ['event_requirement_file_id' => $proposalId, 'stage' => 'dean', 'status' => 'ok']);

        Sanctum::actingAs($this->admin);
        $files = collect($this->getJson('/api/events/'.$eventId.'/submission')->assertOk()->json('files'))->keyBy('id');
        $this->assertSame('needs_changes', $files[$permitId]['reviews'][0]['status']);
        $this->assertSame('The permit is expired.', $files[$permitId]['reviews'][0]['note']);
        $this->assertSame('dean', $files[$permitId]['reviews'][0]['stage']);
        $this->assertSame('ok', $files[$proposalId]['reviews'][0]['status']);
    }

    public function test_the_approvals_summary_lists_each_file_with_an_open_url_and_its_marks(): void
    {
        $eventId = $this->eventWithFiles();
        $permitId = $this->fileId($eventId, $this->permit);
        $this->decide($this->head, $this->row($eventId, 'DEPARTMENT_HEAD'), 'rejected', [
            ['id' => $permitId, 'status' => 'needs_changes', 'note' => 'Expired.'],
        ], 'Fix the permit.')->assertOk();

        Sanctum::actingAs($this->head);
        $approval = collect($this->getJson('/api/approval-requests?status=all&per_page=50')->assertOk()->json('data'))->firstWhere('entity_id', $eventId);
        $file = collect($approval['summary']['requirement_files'])->firstWhere('id', $permitId);
        $this->assertSame('/events/'.$eventId.'/submission/files/'.$permitId, $file['open_url']);
        $this->assertSame('Expired.', $file['reviews'][0]['note']);
        $this->getJson('/api/events/'.$eventId.'/submission/files/'.$permitId)->assertOk();
    }

    public function test_approving_is_refused_while_a_file_in_the_request_needs_changes(): void
    {
        $eventId = $this->eventWithFiles();
        $permitId = $this->fileId($eventId, $this->permit);

        $this->decide($this->head, $this->row($eventId, 'DEPARTMENT_HEAD'), 'approved', [
            ['id' => $permitId, 'status' => 'needs_changes', 'note' => 'Expired.'],
        ])->assertUnprocessable();

        $this->assertSame('pending', $this->row($eventId, 'DEPARTMENT_HEAD')->status);
        $this->assertDatabaseCount('event_requirement_file_reviews', 0);
    }

    public function test_approving_is_refused_while_an_earlier_mark_of_this_step_still_says_needs_changes(): void
    {
        $eventId = $this->eventWithFiles();
        $permitId = $this->fileId($eventId, $this->permit);
        $this->decide($this->head, $this->row($eventId, 'DEPARTMENT_HEAD'), 'rejected', [
            ['id' => $permitId, 'status' => 'needs_changes', 'note' => 'Expired.'],
        ], 'Fix the permit.')->assertOk();

        $this->upload($eventId, $this->proposal)->assertOk();
        $this->assertSame('pending', $this->row($eventId, 'DEPARTMENT_HEAD')->fresh()->status);

        $this->decide($this->head, $this->row($eventId, 'DEPARTMENT_HEAD'), 'approved')->assertUnprocessable();
        $this->assertSame('pending', $this->row($eventId, 'DEPARTMENT_HEAD')->fresh()->status);

        $this->decide($this->head, $this->row($eventId, 'DEPARTMENT_HEAD'), 'approved', [
            ['id' => $permitId, 'status' => 'ok'],
        ])->assertOk();
        $this->assertSame('approved', $this->row($eventId, 'DEPARTMENT_HEAD')->fresh()->status);
    }

    public function test_a_needs_changes_mark_needs_a_note(): void
    {
        $eventId = $this->eventWithFiles();

        $this->decide($this->head, $this->row($eventId, 'DEPARTMENT_HEAD'), 'rejected', [
            ['id' => $this->fileId($eventId, $this->permit), 'status' => 'needs_changes'],
        ], 'Fix it.')->assertUnprocessable()->assertJsonValidationErrors('files.0.note');
    }

    public function test_a_file_of_another_event_cannot_be_marked(): void
    {
        $eventId = $this->eventWithFiles();
        $otherEventId = $this->eventWithFiles();
        $foreign = $this->fileId($otherEventId, $this->permit);

        $this->decide($this->head, $this->row($eventId, 'DEPARTMENT_HEAD'), 'rejected', [
            ['id' => $foreign, 'status' => 'needs_changes', 'note' => 'No.'],
        ], 'Fix it.')->assertUnprocessable();

        $this->assertDatabaseCount('event_requirement_file_reviews', 0);
        $this->assertSame('pending', $this->row($eventId, 'DEPARTMENT_HEAD')->status);
    }

    public function test_a_head_of_another_college_cannot_mark_the_files(): void
    {
        $eventId = $this->eventWithFiles();
        $outsider = $this->makeCollegeHead($this->makeCollege('CBA'));

        $this->decide($outsider, $this->row($eventId, 'DEPARTMENT_HEAD'), 'rejected', [
            ['id' => $this->fileId($eventId, $this->permit), 'status' => 'needs_changes', 'note' => 'No.'],
        ], 'No.')->assertNotFound();

        $this->assertDatabaseCount('event_requirement_file_reviews', 0);
    }

    public function test_file_marks_are_only_accepted_on_event_requests(): void
    {
        Sanctum::actingAs($this->admin);
        $budget = Budget::factory()->create(['organization_id' => $this->organization->id]);
        $approval = ApprovalRequest::create([
            'organization_id' => $this->organization->id,
            'entity_type' => 'budget',
            'entity_id' => $budget->id,
            'requested_by' => $this->admin->school_id,
            'required_role' => 'DEPARTMENT_HEAD',
        ]);

        $this->decide($this->head, $approval, 'rejected', [['id' => 1, 'status' => 'ok']], 'No.')->assertUnprocessable();
        $this->assertSame('pending', $approval->fresh()->status);
    }

    public function test_the_organization_replaces_only_the_marked_file_and_the_accepted_one_carries_forward(): void
    {
        $eventId = $this->eventWithFiles();
        $proposalId = $this->fileId($eventId, $this->proposal);
        $permitId = $this->fileId($eventId, $this->permit);
        $this->decide($this->head, $this->row($eventId, 'DEPARTMENT_HEAD'), 'rejected', [
            ['id' => $proposalId, 'status' => 'ok'],
            ['id' => $permitId, 'status' => 'needs_changes', 'note' => 'Expired.'],
        ], 'Fix the permit.')->assertOk();

        $this->upload($eventId, $this->permit)->assertOk();

        $this->assertSame($proposalId, $this->fileId($eventId, $this->proposal));
        $this->assertNotSame($permitId, $this->fileId($eventId, $this->permit));
        $this->assertDatabaseHas('event_requirement_file_reviews', ['event_requirement_file_id' => $proposalId, 'status' => 'ok']);
        $this->assertDatabaseMissing('event_requirement_file_reviews', ['event_requirement_file_id' => $permitId]);
        $this->assertSame('pending', $this->row($eventId, 'DEPARTMENT_HEAD')->fresh()->status);

        $this->decide($this->head, $this->row($eventId, 'DEPARTMENT_HEAD'), 'approved')->assertOk();
        $this->assertSame('pending', $this->row($eventId, 'SUPER_ADMIN')->status);
    }

    public function test_the_sao_marks_files_at_its_own_step_and_the_head_marks_stay_separate(): void
    {
        $eventId = $this->eventWithFiles();
        $proposalId = $this->fileId($eventId, $this->proposal);
        $permitId = $this->fileId($eventId, $this->permit);
        $this->decide($this->head, $this->row($eventId, 'DEPARTMENT_HEAD'), 'approved', [
            ['id' => $proposalId, 'status' => 'ok'],
            ['id' => $permitId, 'status' => 'ok'],
        ])->assertOk();

        $this->decide($this->director, $this->row($eventId, 'SUPER_ADMIN'), 'rejected', [
            ['id' => $permitId, 'status' => 'needs_changes', 'note' => 'Wrong venue.'],
        ], 'Fix the venue permit.')->assertOk();

        $this->assertDatabaseHas('event_requirement_file_reviews', ['event_requirement_file_id' => $permitId, 'stage' => 'sao', 'status' => 'needs_changes']);
        $this->assertDatabaseHas('event_requirement_file_reviews', ['event_requirement_file_id' => $permitId, 'stage' => 'dean', 'status' => 'ok']);

        $this->decide($this->director, $this->row($eventId, 'SUPER_ADMIN'), 'approved')->assertConflict();

        $this->upload($eventId, $this->permit)->assertOk();
        $this->assertSame('pending', $this->row($eventId, 'SUPER_ADMIN')->fresh()->status);
        $this->decide($this->director, $this->row($eventId, 'SUPER_ADMIN'), 'approved', [
            ['id' => $this->fileId($eventId, $this->permit), 'status' => 'ok'],
        ])->assertOk();
        $this->assertDatabaseHas('events', ['id' => $eventId, 'status' => 'approved']);
    }
}
