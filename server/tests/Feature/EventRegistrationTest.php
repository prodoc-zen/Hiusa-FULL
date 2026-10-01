<?php

namespace Tests\Feature;

use App\Models\Event;
use App\Models\EventRegistration;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class EventRegistrationTest extends TestCase
{
    use RefreshDatabase;

    private function makeEvent(Organization $organization, User $creator, array $overrides = []): Event
    {
        return Event::factory()->create(array_merge([
            'organization_id' => $organization->id,
            'created_by' => $creator->school_id,
            'status' => 'approved',
            'start_time' => now()->addDays(3),
            'end_time' => now()->addDays(3)->addHours(2),
        ], $overrides));
    }

    public function test_student_can_register_for_an_approved_upcoming_event(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $student = User::factory()->student()->create(['organization_id' => $organization->id]);
        $event = $this->makeEvent($organization, $admin);

        Sanctum::actingAs($student);
        $this->postJson("/api/events/{$event->id}/registrations")
            ->assertCreated()
            ->assertJsonPath('status', 'registered')
            ->assertJsonPath('user_id', $student->school_id);

        $this->assertDatabaseHas('event_registrations', [
            'event_id' => $event->id,
            'user_id' => $student->school_id,
            'organization_id' => $organization->id,
            'status' => 'registered',
        ]);
        $this->assertDatabaseHas('audit_logs', [
            'organization_id' => $organization->id,
            'user_id' => $student->school_id,
            'module' => 'event_registrations',
            'action' => 'registered',
        ]);
    }

    public function test_duplicate_registration_is_rejected(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $student = User::factory()->student()->create(['organization_id' => $organization->id]);
        $event = $this->makeEvent($organization, $admin);

        Sanctum::actingAs($student);
        $this->postJson("/api/events/{$event->id}/registrations")->assertCreated();
        $this->postJson("/api/events/{$event->id}/registrations")
            ->assertStatus(409)
            ->assertJsonPath('message', 'You are already registered for this event.');

        $this->assertSame(1, EventRegistration::where('event_id', $event->id)->count());
    }

    public function test_cancel_and_re_register_is_allowed(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $student = User::factory()->student()->create(['organization_id' => $organization->id]);
        $event = $this->makeEvent($organization, $admin);

        Sanctum::actingAs($student);
        $this->postJson("/api/events/{$event->id}/registrations")->assertCreated();
        $this->deleteJson("/api/events/{$event->id}/registrations/mine")
            ->assertOk()
            ->assertJsonPath('status', 'cancelled');

        $this->postJson("/api/events/{$event->id}/registrations")
            ->assertCreated()
            ->assertJsonPath('status', 'registered');

        $this->assertSame(1, EventRegistration::where('event_id', $event->id)->where('user_id', $student->school_id)->count());
    }

    public function test_registration_is_blocked_once_capacity_is_reached_and_organizers_are_notified(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $officer = User::factory()->officer()->create(['organization_id' => $organization->id]);
        $studentA = User::factory()->student()->create(['organization_id' => $organization->id]);
        $studentB = User::factory()->student()->create(['organization_id' => $organization->id]);
        $event = $this->makeEvent($organization, $admin, [
            'planning_details' => ['expected_participants' => 1],
        ]);

        Sanctum::actingAs($studentA);
        $this->postJson("/api/events/{$event->id}/registrations")->assertCreated();

        Sanctum::actingAs($studentB);
        $this->postJson("/api/events/{$event->id}/registrations")
            ->assertStatus(409)
            ->assertJsonPath('message', 'This event has reached its registration capacity. Please check back in case a spot opens up.');

        $this->assertDatabaseHas('notifications', [
            'organization_id' => $organization->id,
            'user_id' => $admin->school_id,
            'title' => 'Event at Capacity',
            'reference_id' => $event->id,
        ]);
        $this->assertDatabaseHas('notifications', [
            'organization_id' => $organization->id,
            'user_id' => $officer->school_id,
            'title' => 'Event at Capacity',
            'reference_id' => $event->id,
        ]);
    }

    public function test_registration_is_rejected_for_non_approved_event_states(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        Sanctum::actingAs($admin);

        foreach (['planning', 'ongoing', 'completed', 'cancelled'] as $status) {
            $event = $this->makeEvent($organization, $admin, ['status' => $status]);

            $this->postJson("/api/events/{$event->id}/registrations")
                ->assertStatus(422)
                ->assertJsonPath('message', 'This event is not open for registration.');
        }
    }

    public function test_registration_is_rejected_once_the_event_has_started(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $event = $this->makeEvent($organization, $admin, [
            'status' => 'approved',
            'start_time' => now()->subHour(),
            'end_time' => now()->addHour(),
        ]);

        Sanctum::actingAs($admin);
        $this->postJson("/api/events/{$event->id}/registrations")
            ->assertStatus(422)
            ->assertJsonPath('message', 'This event is not open for registration.');
    }

    public function test_a_planning_event_is_not_visible_to_a_student(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $student = User::factory()->student()->create(['organization_id' => $organization->id]);
        $event = $this->makeEvent($organization, $admin, ['status' => 'planning']);

        Sanctum::actingAs($student);
        $this->postJson("/api/events/{$event->id}/registrations")
            ->assertStatus(403)
            ->assertJsonPath('message', 'Event not available.');
    }

    public function test_registration_is_denied_across_organizations(): void
    {
        $organizationA = Organization::factory()->create();
        $organizationB = Organization::factory()->create();
        $adminA = User::factory()->admin()->create(['organization_id' => $organizationA->id]);
        $studentB = User::factory()->student()->create(['organization_id' => $organizationB->id]);
        $event = $this->makeEvent($organizationA, $adminA);

        Sanctum::actingAs($studentB);
        $this->postJson("/api/events/{$event->id}/registrations")->assertNotFound();
    }

    public function test_cannot_cancel_after_the_event_has_started_or_after_being_marked_attended(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $student = User::factory()->student()->create(['organization_id' => $organization->id]);
        $event = $this->makeEvent($organization, $admin);

        Sanctum::actingAs($student);
        $this->postJson("/api/events/{$event->id}/registrations")->assertCreated();

        Sanctum::actingAs($admin);
        $this->postJson("/api/events/{$event->id}/attendance", [
            'user_id' => $student->school_id,
            'method' => 'manual',
            'status' => 'present',
        ])->assertCreated();

        Sanctum::actingAs($student);
        $this->deleteJson("/api/events/{$event->id}/registrations/mine")
            ->assertStatus(422)
            ->assertJsonPath('message', 'You have already attended this event and cannot cancel your registration.');

        $startedEvent = $this->makeEvent($organization, $admin, [
            'start_time' => now()->subMinutes(5),
            'end_time' => now()->addHour(),
        ]);
        EventRegistration::create([
            'event_id' => $startedEvent->id,
            'organization_id' => $organization->id,
            'user_id' => $student->school_id,
            'status' => 'registered',
            'registered_at' => now()->subDay(),
        ]);
        $this->deleteJson("/api/events/{$startedEvent->id}/registrations/mine")
            ->assertStatus(422)
            ->assertJsonPath('message', 'This event has already started; registration can no longer be cancelled.');
    }

    public function test_recording_manual_attendance_marks_the_registration_attended(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $student = User::factory()->student()->create(['organization_id' => $organization->id]);
        $event = $this->makeEvent($organization, $admin);

        Sanctum::actingAs($student);
        $this->postJson("/api/events/{$event->id}/registrations")->assertCreated();

        Sanctum::actingAs($admin);
        $this->postJson("/api/events/{$event->id}/attendance", [
            'user_id' => $student->school_id,
            'method' => 'manual',
            'status' => 'present',
        ])->assertCreated();

        $this->assertDatabaseHas('event_registrations', [
            'event_id' => $event->id,
            'user_id' => $student->school_id,
            'status' => 'attended',
        ]);
    }

    public function test_officer_can_list_registrations_with_counts_and_attendance_cross_reference(): void
    {
        $organization = Organization::factory()->create();
        $officer = User::factory()->officer()->create(['organization_id' => $organization->id]);
        $studentA = User::factory()->student()->create(['organization_id' => $organization->id]);
        $studentB = User::factory()->student()->create(['organization_id' => $organization->id]);
        $event = $this->makeEvent($organization, $officer);

        Sanctum::actingAs($studentA);
        $this->postJson("/api/events/{$event->id}/registrations")->assertCreated();
        Sanctum::actingAs($studentB);
        $this->postJson("/api/events/{$event->id}/registrations")->assertCreated();

        Sanctum::actingAs($officer);
        $this->postJson("/api/events/{$event->id}/attendance", [
            'user_id' => $studentA->school_id,
            'method' => 'manual',
            'status' => 'present',
        ])->assertCreated();

        $response = $this->getJson("/api/events/{$event->id}/registrations")
            ->assertOk()
            ->assertJsonPath('summary.registered', 1)
            ->assertJsonPath('summary.attended', 1)
            ->assertJsonCount(2, 'registrations');

        $rows = collect($response->json('registrations'));
        $attendedRow = $rows->firstWhere('user_id', $studentA->school_id);
        $this->assertSame('attended', $attendedRow['status']);
        $this->assertSame('present', $attendedRow['attendance']['status']);
        $this->assertNull($rows->firstWhere('user_id', $studentB->school_id)['attendance']);
    }

    public function test_student_cannot_list_event_registrations(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $student = User::factory()->student()->create(['organization_id' => $organization->id]);
        $event = $this->makeEvent($organization, $admin);

        Sanctum::actingAs($student);
        $this->getJson("/api/events/{$event->id}/registrations")->assertForbidden();
    }

    public function test_my_event_registrations_splits_upcoming_and_past(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $student = User::factory()->student()->create(['organization_id' => $organization->id]);
        $upcomingEvent = $this->makeEvent($organization, $admin, ['start_time' => now()->addWeek(), 'end_time' => now()->addWeek()->addHours(2)]);
        $pastEvent = $this->makeEvent($organization, $admin, ['status' => 'completed', 'start_time' => now()->subWeek(), 'end_time' => now()->subWeek()->addHours(2)]);

        EventRegistration::create([
            'event_id' => $upcomingEvent->id,
            'organization_id' => $organization->id,
            'user_id' => $student->school_id,
            'status' => 'registered',
            'registered_at' => now(),
        ]);
        EventRegistration::create([
            'event_id' => $pastEvent->id,
            'organization_id' => $organization->id,
            'user_id' => $student->school_id,
            'status' => 'attended',
            'registered_at' => now()->subWeek(),
        ]);

        Sanctum::actingAs($student);
        $response = $this->getJson('/api/me/event-registrations')->assertOk();

        $response->assertJsonCount(1, 'upcoming')->assertJsonCount(1, 'past');
        $this->assertSame($upcomingEvent->id, $response->json('upcoming.0.event_id'));
        $this->assertSame($pastEvent->id, $response->json('past.0.event_id'));
    }
}
