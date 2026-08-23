<?php

namespace Tests\Feature;

use App\Models\Event;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
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
}
