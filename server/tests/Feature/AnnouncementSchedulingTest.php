<?php

namespace Tests\Feature;

use App\Http\Controllers\AnnouncementController;
use App\Models\Announcement;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AnnouncementSchedulingTest extends TestCase
{
    use RefreshDatabase;

    private function adminWithMember(): array
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $student = User::factory()->student()->create(['organization_id' => $organization->id]);

        return [$admin, $student];
    }

    private function schedule(User $admin, string $when): int
    {
        Sanctum::actingAs($admin);

        return $this->postJson('/api/announcements', [
            'title' => 'General assembly', 'body' => 'Bring your ID.', 'target_role' => 'all',
            'is_published' => true, 'scheduled_at' => $when,
        ])->assertCreated()->assertJsonPath('is_published', true)->json('id');
    }

    public function test_a_scheduled_announcement_is_held_back_until_its_time_and_then_goes_out_once(): void
    {
        [$admin, $student] = $this->adminWithMember();
        $id = $this->schedule($admin, now()->addHours(2)->toDateTimeString());

        $this->assertNull(Announcement::findOrFail($id)->published_at);
        $this->assertSame(0, Notification::where('notification_type', 'announcement')->count());
        $this->assertNull(Announcement::findOrFail($id)->published_at);

        Sanctum::actingAs($student);
        $this->getJson('/api/announcements?published_only=1')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/student/feed')->assertOk()->assertJsonCount(0, 'items');

        $this->travel(3)->hours();
        $this->assertSame(1, app(AnnouncementController::class)->publishScheduled());
        $this->assertSame(0, app(AnnouncementController::class)->publishScheduled());

        $this->assertNotNull(Announcement::findOrFail($id)->published_at);
        $this->assertSame(1, Notification::where('notification_type', 'announcement')->where('user_id', $student->school_id)->count());
        $this->getJson('/api/announcements?published_only=1')->assertOk()->assertJsonCount(1, 'data');
        $this->getJson('/api/student/feed')->assertOk()->assertJsonCount(1, 'items');
    }

    public function test_the_publish_time_must_be_in_the_future_and_needs_publish_not_a_draft(): void
    {
        [$admin] = $this->adminWithMember();
        Sanctum::actingAs($admin);
        $payload = ['title' => 'Notice', 'body' => 'Text.', 'target_role' => 'all'];

        $this->postJson('/api/announcements', $payload + ['is_published' => true, 'scheduled_at' => now()->subHour()->toDateTimeString()])
            ->assertUnprocessable()->assertJsonValidationErrors('scheduled_at');
        $this->postJson('/api/announcements', $payload + ['is_published' => false, 'scheduled_at' => now()->addDay()->toDateTimeString()])
            ->assertUnprocessable()->assertJsonValidationErrors('scheduled_at');
        $this->assertDatabaseMissing('announcements', ['title' => 'Notice']);
    }

    public function test_an_officer_cannot_schedule_an_announcement_that_still_needs_approval(): void
    {
        $organization = Organization::factory()->create();
        Sanctum::actingAs(User::factory()->officer()->create(['organization_id' => $organization->id]));

        $this->postJson('/api/announcements', [
            'title' => 'Officer notice', 'body' => 'Text.', 'target_role' => 'all', 'scheduled_at' => now()->addDay()->toDateTimeString(),
        ])->assertUnprocessable()->assertJsonValidationErrors('scheduled_at');
    }

    public function test_unpublishing_a_scheduled_announcement_cancels_it_and_publishing_again_goes_out_at_once(): void
    {
        [$admin, $student] = $this->adminWithMember();
        $id = $this->schedule($admin, now()->addHours(2)->toDateTimeString());

        $this->patchJson("/api/announcements/{$id}/publish")->assertOk()->assertJsonPath('is_published', false);
        $this->assertNull(Announcement::findOrFail($id)->scheduled_at);
        $this->travel(3)->hours();
        $this->assertSame(0, app(AnnouncementController::class)->publishScheduled());

        $this->patchJson("/api/announcements/{$id}/publish")->assertOk()->assertJsonPath('is_published', true);
        $this->assertNotNull(Announcement::findOrFail($id)->published_at);
        $this->assertSame(1, Notification::where('notification_type', 'announcement')->where('user_id', $student->school_id)->count());
    }

    public function test_the_scheduler_has_an_entry_that_publishes_organization_announcements(): void
    {
        $this->artisan('schedule:list')->expectsOutputToContain('publish-scheduled-org-announcements')->assertSuccessful();
    }
}
