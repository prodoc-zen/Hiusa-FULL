<?php

namespace Tests\Feature;

use App\Models\AccountProfile;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ManualNotificationModuleGateTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    protected function setUp(): void
    {
        parent::setUp();
        $this->organization = Organization::factory()->create();
        User::factory()->create(['organization_id' => $this->organization->id, 'role' => 'STUDENT', 'account_status' => 'active']);
    }

    private function officer(?array $modules): User
    {
        $officer = User::factory()->create(['organization_id' => $this->organization->id, 'role' => 'SBO_OFFICER', 'account_status' => 'active']);
        AccountProfile::where('user_school_id', $officer->school_id)->where('organization_id', $this->organization->id)->update(['modules' => $modules]);

        return $officer;
    }

    private function notice(): array
    {
        return ['target_role' => 'STUDENT', 'notification_type' => 'financial', 'title' => 'Unpaid fee', 'message' => 'Settle your fee today.'];
    }

    public function test_an_officer_limited_to_merchandise_cannot_notify_the_organization(): void
    {
        Sanctum::actingAs($this->officer(['merchandise']));

        $this->postJson('/api/notifications', $this->notice())->assertForbidden();

        $this->assertSame(0, Notification::count());
    }

    public function test_an_officer_with_the_announcements_area_can_notify_the_organization(): void
    {
        Sanctum::actingAs($this->officer(['announcements']));

        $this->postJson('/api/notifications', $this->notice())->assertCreated()->assertJsonPath('count', 1);
    }

    public function test_an_officer_with_every_area_and_an_admin_can_still_notify(): void
    {
        Sanctum::actingAs($this->officer(null));
        $this->postJson('/api/notifications', $this->notice())->assertCreated();

        Sanctum::actingAs(User::factory()->create(['organization_id' => $this->organization->id, 'role' => 'ADMIN', 'account_status' => 'active']));
        $this->postJson('/api/notifications', $this->notice())->assertCreated();
    }
}
