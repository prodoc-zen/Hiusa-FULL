<?php

namespace Tests\Feature;

use App\Models\AccountProfile;
use App\Models\ApprovalRequest;
use App\Models\College;
use App\Models\Event;
use App\Models\Organization;
use App\Models\User;
use App\Models\Venue;
use App\Models\VenueBooking;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

class ArchivedOrganizationReadOnlyTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private const MESSAGE = 'This organization is archived and read only.';

    private College $college;

    private Organization $archived;

    private User $sao;

    protected function setUp(): void
    {
        parent::setUp();
        $this->college = $this->makeCollege('CCS');
        $this->archived = $this->makeCollegeStudentOrganization($this->college, ['lifecycle_status' => 'archived', 'is_active' => false]);
        $this->sao = User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->value('id')]);
    }

    private function approvalFor(Organization $organization, string $requiredRole): ApprovalRequest
    {
        $requester = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $event = Event::factory()->create([
            'organization_id' => $organization->id, 'created_by' => $requester->school_id, 'status' => 'planning',
            'start_time' => now()->addWeek(), 'end_time' => now()->addWeek()->addHours(2),
        ]);

        return ApprovalRequest::create([
            'organization_id' => $organization->id, 'entity_type' => 'event', 'entity_id' => $event->id,
            'requested_by' => $requester->school_id, 'required_role' => $requiredRole, 'status' => 'pending', 'requested_at' => now()->subHour(),
        ]);
    }

    public function test_a_department_head_cannot_review_an_approval_of_an_archived_organization(): void
    {
        $approval = $this->approvalFor($this->archived, 'DEPARTMENT_HEAD');
        Sanctum::actingAs($this->makeCollegeHead($this->college));

        $this->patchJson("/api/approval-requests/{$approval->id}", ['status' => 'approved'])
            ->assertStatus(409)->assertJsonPath('message', self::MESSAGE);

        $this->assertSame('pending', $approval->fresh()->status);
    }

    public function test_sao_cannot_review_an_approval_of_an_archived_organization(): void
    {
        $approval = $this->approvalFor($this->archived, 'SUPER_ADMIN');
        Sanctum::actingAs($this->sao);

        $this->patchJson("/api/approval-requests/{$approval->id}", ['status' => 'rejected', 'remarks' => 'No.'])
            ->assertStatus(409)->assertJsonPath('message', self::MESSAGE);

        $this->assertSame('pending', $approval->fresh()->status);
    }

    public function test_an_active_organization_approval_can_still_be_reviewed(): void
    {
        $active = $this->makeCollegeStudentOrganization($this->college);
        $approval = $this->approvalFor($active, 'DEPARTMENT_HEAD');
        Sanctum::actingAs($this->makeCollegeHead($this->college));

        $this->patchJson("/api/approval-requests/{$approval->id}", ['status' => 'approved'])->assertOk();
    }

    public function test_sao_cannot_review_a_venue_booking_of_an_archived_organization(): void
    {
        $venue = Venue::create(['name' => 'Gymnasium', 'location' => 'Main Campus', 'capacity' => 200]);
        $requester = User::factory()->admin()->create(['organization_id' => $this->archived->id]);
        $booking = VenueBooking::create([
            'venue_id' => $venue->id, 'organization_id' => $this->archived->id, 'requested_by' => $requester->school_id, 'status' => 'pending',
            'start_time' => now()->addDay()->setTime(9, 0), 'end_time' => now()->addDay()->setTime(11, 0),
        ]);
        Sanctum::actingAs($this->sao);

        $this->patchJson("/api/venue-bookings/{$booking->id}/review", ['status' => 'approved'])
            ->assertStatus(409)->assertJsonPath('message', self::MESSAGE);

        $this->assertSame('pending', $booking->fresh()->status);
    }

    public function test_sao_cannot_delete_or_reset_the_admin_of_an_archived_organization(): void
    {
        $admin = User::factory()->admin()->create(['organization_id' => $this->archived->id]);
        User::factory()->admin()->create(['organization_id' => $this->archived->id]);
        Sanctum::actingAs($this->sao);

        $this->deleteJson("/api/system/admins/{$admin->school_id}")->assertStatus(409)->assertJsonPath('message', 'Archived organizations are read only.');
        $this->postJson("/api/system/admins/{$admin->school_id}/password-reset")->assertStatus(409)->assertJsonPath('message', 'Archived organizations are read only.');

        $this->assertDatabaseHas('users', ['school_id' => $admin->school_id]);
    }

    public function test_sao_cannot_delete_a_profile_of_an_archived_organization(): void
    {
        $member = User::factory()->student()->create(['organization_id' => $this->archived->id]);
        $profile = AccountProfile::where('user_school_id', $member->school_id)->where('organization_id', $this->archived->id)->firstOrFail();
        Sanctum::actingAs($this->sao);

        $this->deleteJson("/api/account-profiles/{$profile->id}")->assertStatus(409)->assertJsonPath('message', 'Archived organizations are read only.');

        $this->assertDatabaseHas('account_profiles', ['id' => $profile->id]);
    }

    public function test_sao_can_still_delete_a_profile_of_an_active_organization(): void
    {
        $active = $this->makeCollegeStudentOrganization($this->college);
        $member = User::factory()->student()->create(['organization_id' => $active->id]);
        $profile = AccountProfile::where('user_school_id', $member->school_id)->where('organization_id', $active->id)->firstOrFail();
        Sanctum::actingAs($this->sao);

        $this->deleteJson("/api/account-profiles/{$profile->id}")->assertOk();
    }
}
