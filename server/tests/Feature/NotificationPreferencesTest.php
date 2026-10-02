<?php

namespace Tests\Feature;

use App\Models\Notification;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class NotificationPreferencesTest extends TestCase
{
    use RefreshDatabase;

    private User $student;

    protected function setUp(): void
    {
        parent::setUp();
        $organization = Organization::factory()->create();
        $this->student = User::factory()->create(['organization_id' => $organization->id, 'role' => 'STUDENT', 'account_status' => 'active']);
        foreach (['event' => 'Sports Fest starts tomorrow', 'announcement' => 'General assembly moved', 'general' => 'Your clearance was signed'] as $type => $title) {
            Notification::create(['organization_id' => $organization->id, 'user_id' => $this->student->school_id, 'notification_type' => $type, 'title' => $title, 'message' => $title, 'is_read' => false, 'sent_at' => now()]);
        }
    }

    public function test_muted_kinds_leave_the_list_and_the_unread_count_but_are_still_stored(): void
    {
        Sanctum::actingAs($this->student);
        $this->putJson('/api/user/notification-preferences', ['muted' => ['event', 'announcement']])
            ->assertOk()
            ->assertJsonPath('muted', ['announcement', 'event']);

        $response = $this->getJson('/api/notifications')->assertOk();

        $this->assertSame(['Your clearance was signed'], array_column($response->json('data'), 'title'));
        $this->assertSame(1, $response->json('unread_count'));
        $this->assertSame(3, Notification::where('user_id', $this->student->school_id)->count());
        $this->assertStringStartsWith('1 unread', $this->getJson('/api/dashboard/briefing')->json('pillars.communication.context'));
    }

    public function test_notices_someone_is_waiting_on_cannot_be_muted(): void
    {
        Sanctum::actingAs($this->student);

        $this->putJson('/api/user/notification-preferences', ['muted' => ['general']])->assertUnprocessable();
        $this->putJson('/api/user/notification-preferences', ['muted' => ['task']])->assertUnprocessable();
        $this->assertSame([], $this->student->fresh()->mutedNotificationTypes());
    }

    public function test_preferences_round_trip_and_unmuting_restores_everything(): void
    {
        Sanctum::actingAs($this->student);
        $this->putJson('/api/user/notification-preferences', ['muted' => ['event']])->assertOk();

        $this->getJson('/api/user/notification-preferences')
            ->assertOk()
            ->assertJsonPath('muted', ['event'])
            ->assertJsonPath('mutable', Notification::MUTABLE_TYPES);

        $this->putJson('/api/user/notification-preferences', ['muted' => []])->assertOk()->assertJsonPath('muted', []);
        $this->assertSame(3, $this->getJson('/api/notifications')->json('total'));
    }
}
