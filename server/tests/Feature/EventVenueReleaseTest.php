<?php

namespace Tests\Feature;

use App\Models\Event;
use App\Models\Organization;
use App\Models\User;
use App\Models\Venue;
use App\Models\VenueBooking;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * An event's venue booking holds the slot until it is withdrawn. Cancelling the event frees the
 * venue, and an event that still holds a booking cannot be deleted, so no booking is left
 * pointing at nothing.
 */
class EventVenueReleaseTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private Venue $venue;

    protected function setUp(): void
    {
        parent::setUp();
        config(['performance.api_cache.enabled' => false]);
        $this->admin = User::factory()->admin()->create(['organization_id' => Organization::factory()]);
        $this->venue = Venue::create(['name' => 'Auditorium', 'location' => 'Main Campus', 'capacity' => 500]);
        Sanctum::actingAs($this->admin);
    }

    private function event(string $status = 'planning'): Event
    {
        return Event::factory()->create([
            'organization_id' => $this->admin->organization_id,
            'created_by' => $this->admin->school_id,
            'status' => $status,
        ]);
    }

    private function booking(Event $event, string $status, ?Organization $organization = null): VenueBooking
    {
        return VenueBooking::create([
            'venue_id' => $this->venue->id,
            'event_id' => $event->id,
            'organization_id' => ($organization ?? $this->admin->organization)->id,
            'start_time' => $event->start_time,
            'end_time' => $event->end_time,
            'status' => $status,
            'requested_by' => $this->admin->school_id,
        ]);
    }

    public function test_cancelling_an_event_withdraws_its_pending_and_approved_bookings_and_frees_the_venue(): void
    {
        $event = $this->event('approved');
        $pending = $this->booking($event, 'pending');
        $approved = $this->booking($event, 'approved');
        $rejected = $this->booking($event, 'rejected');
        $sao = User::factory()->create(['role' => 'SUPER_ADMIN', 'organization_id' => Organization::factory(), 'account_status' => 'active']);

        $this->patchJson("/api/events/{$event->id}/status", ['status' => 'cancelled'])->assertOk();

        $this->assertSame('withdrawn', $pending->fresh()->status);
        $this->assertSame('withdrawn', $approved->fresh()->status);
        $this->assertSame('rejected', $rejected->fresh()->status);
        $this->assertDatabaseHas('audit_logs', ['module' => 'venue_bookings', 'action' => 'booking_withdrawn', 'record_id' => $approved->id]);
        $this->assertDatabaseHas('notifications', ['user_id' => $sao->school_id, 'reference_type' => 'venue_booking', 'reference_id' => $approved->id]);

        Sanctum::actingAs($sao);
        $this->getJson("/api/venues/{$this->venue->id}/availability")->assertOk()->assertJsonCount(0);
    }

    public function test_cancelling_through_the_event_update_also_frees_the_venue(): void
    {
        $event = $this->event('planning');
        $booking = $this->booking($event, 'pending');

        $this->putJson("/api/events/{$event->id}", ['status' => 'cancelled'])->assertOk();

        $this->assertSame('withdrawn', $booking->fresh()->status);
    }

    public function test_cancelling_leaves_another_organizations_booking_alone(): void
    {
        $event = $this->event('planning');
        $other = $this->booking($event, 'pending', Organization::factory()->create());

        $this->patchJson("/api/events/{$event->id}/status", ['status' => 'cancelled'])->assertOk();

        $this->assertSame('pending', $other->fresh()->status);
    }

    public function test_an_event_with_a_pending_or_approved_booking_cannot_be_deleted(): void
    {
        foreach (['pending', 'approved'] as $status) {
            $event = $this->event('planning');
            $booking = $this->booking($event, $status);

            $this->deleteJson("/api/events/{$event->id}")
                ->assertConflict()
                ->assertJsonPath('message', 'This event cannot be deleted because it has a venue booking that is still pending or approved. Cancel it instead to release the venue.');

            $this->assertModelExists($event);
            $this->assertSame($event->id, $booking->fresh()->event_id);
        }
    }

    public function test_the_event_list_carries_the_booking_blocker_so_the_client_offers_cancel(): void
    {
        $event = $this->event('planning');
        $this->booking($event, 'approved');

        $row = collect($this->getJson('/api/events')->assertOk()->json('data'))->firstWhere('id', $event->id);

        $this->assertStringContainsString('venue booking', $row['delete_blocked_reason']);
    }

    public function test_an_event_whose_bookings_were_released_by_cancelling_can_be_deleted(): void
    {
        $event = $this->event('planning');
        $this->booking($event, 'pending');
        $this->booking($event, 'rejected');

        $this->patchJson("/api/events/{$event->id}/status", ['status' => 'cancelled'])->assertOk();
        $this->deleteJson("/api/events/{$event->id}")->assertOk();

        $this->assertModelMissing($event);
    }
}
