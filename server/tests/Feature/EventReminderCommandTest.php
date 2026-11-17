<?php

namespace Tests\Feature;

use App\Models\Event;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class EventReminderCommandTest extends TestCase
{
    use RefreshDatabase;

    public function test_approved_upcoming_events_create_one_reminder_per_active_member(): void
    {
        $organization = Organization::factory()->create();
        $creator = User::factory()->create([
            'organization_id' => $organization->id,
            'account_status' => 'active',
            'role' => 'ADMIN',
        ]);
        User::factory()->create([
            'organization_id' => $organization->id,
            'account_status' => 'active',
            'role' => 'STUDENT',
        ]);
        User::factory()->create([
            'organization_id' => $organization->id,
            'account_status' => 'inactive',
            'role' => 'STUDENT',
        ]);
        Event::create([
            'organization_id' => $organization->id,
            'created_by' => $creator->school_id,
            'title' => 'Tomorrow Activity',
            'location' => 'Main Hall',
            'start_time' => now()->addHours(12),
            'end_time' => now()->addHours(14),
            'status' => 'approved',
            'approved_at' => now(),
        ]);

        Artisan::call('events:send-reminders');
        Artisan::call('events:send-reminders');

        $this->assertSame(2, Notification::where('title', 'Event Reminder: Tomorrow Activity')->count());
    }

    private function memberAndEvent(array $planning, int $startsInHours): array
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->create(['organization_id' => $organization->id, 'account_status' => 'active', 'role' => 'ADMIN']);
        User::factory()->create(['organization_id' => $organization->id, 'account_status' => 'active', 'role' => 'STUDENT']);
        $event = Event::create([
            'organization_id' => $organization->id,
            'created_by' => $admin->school_id,
            'title' => 'Lead Time Activity',
            'location' => 'Main Hall',
            'start_time' => now()->addHours($startsInHours),
            'end_time' => now()->addHours($startsInHours + 2),
            'status' => 'approved',
            'approved_at' => now(),
            'planning_details' => $planning,
        ]);

        return [$admin, $event];
    }

    public function test_a_shorter_reminder_time_holds_the_reminder_back_until_it_is_due(): void
    {
        $this->memberAndEvent(['reminder_hours' => 3], 12);

        Artisan::call('events:send-reminders');

        $this->assertSame(0, Notification::where('title', 'Event Reminder: Lead Time Activity')->count());
    }

    public function test_a_longer_reminder_time_sends_it_earlier_than_a_day_ahead(): void
    {
        $this->memberAndEvent(['reminder_hours' => 72], 60);

        Artisan::call('events:send-reminders');

        $this->assertSame(2, Notification::where('title', 'Event Reminder: Lead Time Activity')->count());
    }

    public function test_an_event_without_a_chosen_time_keeps_the_day_ahead_reminder(): void
    {
        $this->memberAndEvent([], 30);
        Artisan::call('events:send-reminders');
        $this->assertSame(0, Notification::where('title', 'Event Reminder: Lead Time Activity')->count());

        $this->travel(7)->hours();
        Artisan::call('events:send-reminders');
        $this->assertSame(2, Notification::where('title', 'Event Reminder: Lead Time Activity')->count());
    }

    public function test_the_admin_sets_the_reminder_time_on_the_event_and_only_from_the_offered_choices(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->create(['organization_id' => $organization->id, 'account_status' => 'active', 'role' => 'ADMIN']);
        Sanctum::actingAs($admin);
        $dates = ['title' => 'Reminder form', 'start_time' => now()->addDays(10)->toDateTimeString(), 'end_time' => now()->addDays(10)->addHours(2)->toDateTimeString()];

        $this->postJson('/api/events', [...$dates, 'planning_details' => ['reminder_hours' => 5]])->assertUnprocessable()->assertJsonValidationErrors('planning_details.reminder_hours');
        $id = $this->postJson('/api/events', [...$dates, 'planning_details' => ['reminder_hours' => 48]])->assertCreated()->json('id');
        $this->assertSame(48, Event::findOrFail($id)->planning_details['reminder_hours']);

        $this->putJson("/api/events/{$id}", ['planning_details' => ['reminder_hours' => 6]])->assertOk();
        $this->assertSame(6, Event::findOrFail($id)->planning_details['reminder_hours']);
    }
}
