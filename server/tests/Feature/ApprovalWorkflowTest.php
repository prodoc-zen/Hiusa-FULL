<?php

namespace Tests\Feature;

use App\Models\ApprovalRequest;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ApprovalWorkflowTest extends TestCase
{
    use RefreshDatabase;

    /**
     * Sanctum's guard caches the resolved user on the shared auth manager,
     * which persists across multiple test-client calls within one test
     * method. forgetGuards() clears that cache so each subsequent request
     * re-resolves the user from the Bearer token actually being sent,
     * instead of reusing whichever user authenticated first.
     */
    private function loginAs(User $user): string
    {
        $login = $this->postJson('/api/login', [
            'organization_id' => $user->organization_id,
            'email' => $user->email,
            'password' => 'password123',
        ]);

        $this->app['auth']->forgetGuards();

        return $login->json('access_token');
    }

    public function test_event_creation_starts_in_planning_and_creates_a_pending_approval_request(): void
    {
        $admin = User::factory()->create(['role' => 'ADMIN', 'password_hash' => 'password123']);
        $token = $this->loginAs($admin);

        $response = $this->withToken($token)->postJson('/api/events', [
            'title' => 'General Assembly',
            'start_time' => now()->addWeek()->toDateTimeString(),
            'end_time' => now()->addWeek()->addHours(2)->toDateTimeString(),
        ]);

        $response->assertCreated()->assertJsonPath('status', 'planning');

        $this->assertDatabaseHas('approval_requests', [
            'entity_type' => 'event',
            'entity_id' => $response->json('id'),
            'status' => 'pending',
            'requested_by' => $admin->school_id,
        ]);
    }

    public function test_department_head_can_approve_a_pending_event(): void
    {
        $admin = User::factory()->create(['role' => 'ADMIN', 'password_hash' => 'password123']);
        $deptHead = User::factory()->create([
            'role' => 'DEPARTMENT_HEAD',
            'organization_id' => $admin->organization_id,
            'password_hash' => 'password123',
        ]);

        $eventId = $this->withToken($this->loginAs($admin))->postJson('/api/events', [
            'title' => 'Leadership Seminar',
            'start_time' => now()->addWeek()->toDateTimeString(),
            'end_time' => now()->addWeek()->addHours(2)->toDateTimeString(),
        ])->json('id');

        $approvalId = ApprovalRequest::where('entity_type', 'event')->where('entity_id', $eventId)->value('id');

        $this->withToken($this->loginAs($deptHead))
            ->patchJson("/api/approval-requests/{$approvalId}", ['status' => 'approved'])
            ->assertOk()
            ->assertJsonPath('status', 'approved');

        $this->assertDatabaseHas('events', ['id' => $eventId, 'status' => 'approved']);
    }

    public function test_department_head_rejection_keeps_event_in_planning_and_records_remarks(): void
    {
        $admin = User::factory()->create(['role' => 'ADMIN', 'password_hash' => 'password123']);
        $deptHead = User::factory()->create([
            'role' => 'DEPARTMENT_HEAD',
            'organization_id' => $admin->organization_id,
            'password_hash' => 'password123',
        ]);

        $eventId = $this->withToken($this->loginAs($admin))->postJson('/api/events', [
            'title' => 'Sports Fest',
            'start_time' => now()->addWeek()->toDateTimeString(),
            'end_time' => now()->addWeek()->addHours(2)->toDateTimeString(),
        ])->json('id');

        $approvalId = ApprovalRequest::where('entity_type', 'event')->where('entity_id', $eventId)->value('id');

        $this->withToken($this->loginAs($deptHead))
            ->patchJson("/api/approval-requests/{$approvalId}", [
                'status' => 'rejected',
                'remarks' => 'Budget not yet finalized.',
            ])
            ->assertOk()
            ->assertJsonPath('status', 'rejected')
            ->assertJsonPath('remarks', 'Budget not yet finalized.');

        $this->assertDatabaseHas('events', ['id' => $eventId, 'status' => 'planning']);
    }

    public function test_editing_a_rejected_event_resubmits_it_for_approval(): void
    {
        $admin = User::factory()->create(['role' => 'ADMIN', 'password_hash' => 'password123']);
        $deptHead = User::factory()->create([
            'role' => 'DEPARTMENT_HEAD',
            'organization_id' => $admin->organization_id,
            'password_hash' => 'password123',
        ]);
        $adminToken = $this->loginAs($admin);

        $eventId = $this->withToken($adminToken)->postJson('/api/events', [
            'title' => 'Induction Ceremony',
            'start_time' => now()->addWeek()->toDateTimeString(),
            'end_time' => now()->addWeek()->addHours(2)->toDateTimeString(),
        ])->json('id');

        $approvalId = ApprovalRequest::where('entity_type', 'event')->where('entity_id', $eventId)->value('id');

        $this->withToken($this->loginAs($deptHead))
            ->patchJson("/api/approval-requests/{$approvalId}", ['status' => 'rejected', 'remarks' => 'Wrong venue.'])
            ->assertOk();

        $adminToken = $this->loginAs($admin);

        $this->withToken($adminToken)
            ->putJson("/api/events/{$eventId}", ['location' => 'University Convention Center'])
            ->assertOk();

        $this->assertDatabaseHas('approval_requests', [
            'id' => $approvalId,
            'status' => 'pending',
            'remarks' => null,
        ]);
    }

    public function test_sbo_officer_cannot_review_approval_requests(): void
    {
        $admin = User::factory()->create(['role' => 'ADMIN', 'password_hash' => 'password123']);
        $officer = User::factory()->create([
            'role' => 'SBO_OFFICER',
            'organization_id' => $admin->organization_id,
            'password_hash' => 'password123',
        ]);

        $eventId = $this->withToken($this->loginAs($admin))->postJson('/api/events', [
            'title' => 'Org Fee Collection',
            'start_time' => now()->addWeek()->toDateTimeString(),
            'end_time' => now()->addWeek()->addHours(2)->toDateTimeString(),
        ])->json('id');

        $approvalId = ApprovalRequest::where('entity_type', 'event')->where('entity_id', $eventId)->value('id');

        $this->withToken($this->loginAs($officer))
            ->patchJson("/api/approval-requests/{$approvalId}", ['status' => 'approved'])
            ->assertForbidden();
    }
}
