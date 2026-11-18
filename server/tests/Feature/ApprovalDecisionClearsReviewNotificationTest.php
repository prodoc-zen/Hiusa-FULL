<?php

namespace Tests\Feature;

use App\Models\ApprovalRequest;
use App\Models\EventRequirement;
use App\Models\EventRequirementFile;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

class ApprovalDecisionClearsReviewNotificationTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private User $admin;

    private User $head;

    private User $director;

    private User $secondDirector;

    private EventRequirement $requirement;

    protected function setUp(): void
    {
        parent::setUp();
        config(['performance.api_cache.enabled' => false]);
        Storage::fake('local');
        $college = $this->makeCollege('CCS');
        $organization = $this->makeCollegeStudentOrganization($college);
        $this->head = $this->makeCollegeHead($college);
        $this->admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $sao = Organization::where('slug', 'student-affairs-office')->firstOrFail();
        $this->director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        $this->secondDirector = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        $this->requirement = EventRequirement::create([
            'name' => 'Event proposal',
            'allowed_extensions' => ['pdf'],
            'is_active' => true,
            'is_optional' => false,
            'venue_type' => 'all',
            'sort_order' => 1,
        ]);
    }

    private function decide(User $reviewer, ApprovalRequest $approval, string $status, ?string $remarks = null): void
    {
        Sanctum::actingAs($reviewer);
        $files = $status === 'approved'
            ? EventRequirementFile::where('event_id', $approval->entity_id)->pluck('id')->map(fn ($id) => ['id' => $id, 'status' => 'ok'])->all()
            : [];

        $this->patchJson('/api/approval-requests/'.$approval->id, array_filter(['status' => $status, 'remarks' => $remarks, 'files' => $files]))->assertOk();
    }

    private function upload(int $eventId)
    {
        Sanctum::actingAs($this->admin);

        return $this->post('/api/events/'.$eventId.'/submission', [
            'documents' => [$this->requirement->id => UploadedFile::fake()->create('proposal.pdf', 20, 'application/pdf')],
        ])->assertOk();
    }

    /** The event is with the SAO for review, as when the Admin has sent it on after the dean approved. */
    private function eventWithTheSao(string $title): ApprovalRequest
    {
        Sanctum::actingAs($this->admin);
        $eventId = $this->postJson('/api/events', [
            'title' => $title,
            'start_time' => now()->addWeek()->toDateTimeString(),
            'end_time' => now()->addWeek()->addHours(2)->toDateTimeString(),
        ])->assertCreated()->json('id');
        $this->decide($this->head, $this->approvalFor($eventId, 'DEPARTMENT_HEAD'), 'approved');
        $this->upload($eventId);
        $this->decide($this->head, $this->approvalFor($eventId, 'DEPARTMENT_HEAD'), 'approved');
        Sanctum::actingAs($this->admin);
        $this->postJson('/api/events/'.$eventId.'/submission')->assertOk()->assertJsonPath('approval_stage', 'awaiting_sao');

        return $this->approvalFor($eventId, 'SUPER_ADMIN');
    }

    private function approvalFor(int $eventId, string $role): ApprovalRequest
    {
        return ApprovalRequest::where('entity_type', 'event')->where('entity_id', $eventId)->where('required_role', $role)->firstOrFail();
    }

    private function reviewNotifications(ApprovalRequest $approval)
    {
        return Notification::where('reference_type', 'approval_request')->where('reference_id', $approval->id)->where('title', 'New SAO Approval Request')->get();
    }

    public function test_an_approved_request_no_longer_asks_every_sao_recipient_for_review(): void
    {
        $approval = $this->eventWithTheSao('Acquaintance Party');
        $other = $this->eventWithTheSao('Foundation Day');

        $notifications = $this->reviewNotifications($approval);
        $this->assertCount(2, $notifications);
        $this->assertTrue($notifications->every(fn (Notification $notification) => $notification->is_read === false));

        $this->decide($this->director, $approval, 'approved');

        $this->assertTrue($this->reviewNotifications($approval)->every(fn (Notification $notification) => $notification->is_read === true));
        $this->assertSame(2, $this->reviewNotifications($approval)->count());
        $this->assertTrue($this->reviewNotifications($other)->every(fn (Notification $notification) => $notification->is_read === false), 'a request still waiting keeps asking');
    }

    public function test_a_returned_request_is_read_and_asks_again_when_the_organization_sends_it_back(): void
    {
        $approval = $this->eventWithTheSao('Acquaintance Party');

        $this->decide($this->director, $approval, 'rejected', 'Signature missing.');

        $this->assertTrue($this->reviewNotifications($approval)->every(fn (Notification $notification) => $notification->is_read === true));

        $this->upload($approval->entity_id);

        $this->assertSame('pending', $approval->fresh()->status);
        $notifications = $this->reviewNotifications($approval);
        $this->assertCount(2, $notifications);
        $this->assertTrue($notifications->every(fn (Notification $notification) => $notification->is_read === false), 'a resubmitted request needs review again');
    }
}
