<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use App\Models\Venue;
use App\Models\VenueBooking;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The booking page sends UTC instants (toISOString), the database holds wall-clock Manila time. Every
 * instant, whatever offset it arrives with, must land on the same moment in the database, in the overlap
 * check and in the window filters.
 */
class VenueBookingTimezoneTest extends TestCase
{
    use RefreshDatabase;

    private Venue $venue;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->venue = Venue::create(['name' => 'Auditorium', 'location' => 'Main Campus', 'capacity' => 500]);
        $this->admin = User::factory()->create(['role' => 'ADMIN', 'organization_id' => Organization::factory(), 'account_status' => 'active']);
        Sanctum::actingAs($this->admin);
    }

    public function test_an_instant_sent_in_utc_is_stored_as_the_same_moment(): void
    {
        $id = $this->postJson('/api/venue-bookings', [
            'venue_id' => $this->venue->id,
            'start_time' => '2030-03-12T02:00:00.000Z',
            'end_time' => '2030-03-12T04:00:00.000Z',
        ])->assertCreated()->json('id');

        $booking = VenueBooking::find($id);
        $this->assertTrue($booking->start_time->equalTo(Carbon::parse('2030-03-12T10:00:00+08:00')));
        $this->assertTrue($booking->end_time->equalTo(Carbon::parse('2030-03-12T12:00:00+08:00')));
    }

    public function test_a_request_in_utc_that_overlaps_a_booking_made_with_a_manila_offset_is_refused(): void
    {
        VenueBooking::create([
            'venue_id' => $this->venue->id, 'organization_id' => $this->admin->organization_id, 'status' => 'pending',
            'start_time' => Carbon::parse('2030-03-12T09:00:00+08:00'), 'end_time' => Carbon::parse('2030-03-12T11:00:00+08:00'),
            'requested_by' => $this->admin->school_id,
        ]);

        $this->postJson('/api/venue-bookings', [
            'venue_id' => $this->venue->id,
            'start_time' => '2030-03-12T02:00:00.000Z',
            'end_time' => '2030-03-12T04:00:00.000Z',
        ])->assertUnprocessable()->assertJsonPath('message', 'This venue already has a pending or approved booking during that time. Choose another slot.');

        $this->postJson('/api/venue-bookings', [
            'venue_id' => $this->venue->id,
            'start_time' => '2030-03-12T03:00:00.000Z',
            'end_time' => '2030-03-12T05:00:00.000Z',
        ])->assertCreated();
    }

    public function test_the_window_filters_read_an_instant_in_utc_as_the_same_moment(): void
    {
        $booking = VenueBooking::create([
            'venue_id' => $this->venue->id, 'organization_id' => $this->admin->organization_id, 'status' => 'pending',
            'start_time' => Carbon::parse('2030-03-12T09:00:00+08:00'), 'end_time' => Carbon::parse('2030-03-12T11:00:00+08:00'),
            'requested_by' => $this->admin->school_id,
        ]);

        // 03:30Z is 11:30 in Manila: the booking has ended by then.
        $this->getJson("/api/venues/{$this->venue->id}/availability?from=2030-03-12T03:30:00.000Z")->assertOk()->assertJsonCount(0);
        $this->getJson('/api/venue-bookings?from=2030-03-12T03:30:00.000Z')->assertOk()->assertJsonCount(0, 'data');
        // 00:30Z is 08:30 in Manila: the booking is still ahead.
        $this->getJson("/api/venues/{$this->venue->id}/availability?from=2030-03-12T00:30:00.000Z&to=2030-03-12T01:30:00.000Z")->assertOk()->assertJsonCount(1);
        $this->getJson('/api/venue-bookings?from=2030-03-12T00:30:00.000Z&to=2030-03-12T01:30:00.000Z')->assertOk()->assertJsonPath('data.0.id', $booking->id);
        // 00:30Z to 00:45Z is 08:30 to 08:45 in Manila: nothing is booked then.
        $this->getJson("/api/venues/{$this->venue->id}/availability?from=2030-03-12T00:30:00.000Z&to=2030-03-12T00:45:00.000Z")->assertOk()->assertJsonCount(0);
    }
}
