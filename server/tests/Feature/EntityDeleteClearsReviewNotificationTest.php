<?php

namespace Tests\Feature;

use App\Models\Announcement;
use App\Models\ApprovalRequest;
use App\Models\Budget;
use App\Models\Election;
use App\Models\Event;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** Deleting an entity removes its approval requests, so the approvers' unread review notifications for them are read too. */
class EntityDeleteClearsReviewNotificationTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private User $approver;

    protected function setUp(): void
    {
        parent::setUp();
        config(['performance.api_cache.enabled' => false]);
        $organization = Organization::factory()->create();
        $this->admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $this->approver = User::factory()->superAdmin()->create();
        Sanctum::actingAs($this->admin);
    }

    /** @return array{0: Notification, 1: Notification} the request's review notification and an unrelated one that must stay unread */
    private function requestWithNotification(int $organizationId, string $entityType, int $entityId): array
    {
        $approval = ApprovalRequest::create([
            'organization_id' => $organizationId,
            'entity_type' => $entityType,
            'entity_id' => $entityId,
            'requested_by' => $this->admin->school_id,
            'required_role' => 'DEPARTMENT_HEAD',
            'status' => 'pending',
        ]);
        $notification = fn (int $id) => Notification::create([
            'user_id' => $this->approver->school_id,
            'title' => 'Review',
            'message' => 'Review requested.',
            'reference_type' => 'approval_request',
            'reference_id' => $id,
            'is_read' => false,
        ]);

        return [$notification($approval->id), $notification($approval->id + 1000)];
    }

    private function assertReviewRead(Notification $review, Notification $other): void
    {
        $this->assertDatabaseMissing('approval_requests', ['id' => $review->reference_id]);
        $this->assertTrue($review->fresh()->is_read, 'the deleted request no longer asks for review');
        $this->assertFalse($other->fresh()->is_read, 'a notification for another request is left alone');
    }

    public function test_deleting_a_budget_reads_its_review_notifications(): void
    {
        $budget = Budget::create([
            'organization_id' => $this->admin->organization_id, 'title' => 'Budget', 'allocated_amount' => '5000.00',
            'remaining_amount' => '5000.00', 'warning_threshold' => '500.00', 'submission_status' => 'pending_department_head',
        ]);
        [$review, $other] = $this->requestWithNotification($budget->organization_id, 'budget', $budget->id);

        $this->deleteJson("/api/budgets/{$budget->id}")->assertOk();

        $this->assertModelMissing($budget);
        $this->assertReviewRead($review, $other);
    }

    public function test_deleting_an_event_reads_its_review_notifications(): void
    {
        $event = Event::factory()->create([
            'organization_id' => $this->admin->organization_id,
            'created_by' => $this->admin->school_id,
            'status' => 'planning',
        ]);
        [$review, $other] = $this->requestWithNotification($event->organization_id, 'event', $event->id);

        $this->deleteJson("/api/events/{$event->id}")->assertOk();

        $this->assertModelMissing($event);
        $this->assertReviewRead($review, $other);
    }

    public function test_deleting_an_election_reads_its_review_notifications(): void
    {
        $election = Election::factory()->create([
            'organization_id' => $this->admin->organization_id,
            'status' => 'upcoming',
        ]);
        [$review, $other] = $this->requestWithNotification($election->organization_id, 'election', $election->id);

        $this->deleteJson("/api/elections/{$election->id}")->assertOk();

        $this->assertModelMissing($election);
        $this->assertReviewRead($review, $other);
    }

    public function test_deleting_an_announcement_reads_its_review_notifications(): void
    {
        $id = $this->postJson('/api/announcements', ['title' => 'Notice', 'body' => 'Review first.', 'target_role' => 'all'])
            ->assertCreated()->json('id');
        $announcement = Announcement::findOrFail($id);
        [$review, $other] = $this->requestWithNotification($announcement->organization_id, 'announcement', $announcement->id);

        $this->deleteJson("/api/announcements/{$id}")->assertOk();

        $this->assertModelMissing($announcement);
        $this->assertReviewRead($review, $other);
    }
}
