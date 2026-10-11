<?php

namespace Tests\Feature;

use App\Models\Event;
use App\Models\Organization;
use App\Models\User;
use App\Models\Venue;
use App\Models\VenueBooking;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * A delete is only safe when the check that allows it and the delete share one transaction on a locked
 * row, so a booking that lands in between either waits for the delete or is seen by the check. SQLite
 * has no row locks, so these tests pin the shape (the check runs inside the transaction, a row that is
 * gone by the time the lock is taken is a clean answer) and the MariaDB run covers the waiting.
 */
class DeleteGuardLockTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->organization = Organization::factory()->create();
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
    }

    public function test_the_event_delete_check_runs_inside_the_delete_transaction(): void
    {
        $event = Event::factory()->create(['organization_id' => $this->organization->id, 'created_by' => $this->admin->school_id, 'status' => 'planning']);
        Sanctum::actingAs($this->admin);
        $outside = DB::transactionLevel();
        $levels = [];
        DB::listen(function ($query) use (&$levels) {
            if (str_contains($query->sql, 'from "venue_bookings"')) {
                $levels[] = DB::transactionLevel();
            }
        });

        $this->deleteJson("/api/events/{$event->id}")->assertOk();

        $this->assertNotEmpty($levels);
        $this->assertSame([], array_filter($levels, fn ($level) => $level <= $outside), 'the booking check ran outside the delete transaction');
    }

    public function test_the_venue_delete_check_runs_inside_the_delete_transaction(): void
    {
        $venue = Venue::create(['name' => 'Gym', 'location' => 'Main', 'capacity' => 10]);
        Sanctum::actingAs(User::factory()->superAdmin()->create(['organization_id' => Organization::where('slug', 'student-affairs-office')->value('id')]));
        $outside = DB::transactionLevel();
        $levels = [];
        DB::listen(function ($query) use (&$levels) {
            if (str_contains($query->sql, 'from "venue_bookings"')) {
                $levels[] = DB::transactionLevel();
            }
        });

        $this->deleteJson("/api/venues/{$venue->id}")->assertOk();

        $this->assertNotEmpty($levels);
        $this->assertSame([], array_filter($levels, fn ($level) => $level <= $outside), 'the booking check ran outside the delete transaction');
    }

    public function test_a_booking_for_an_event_deleted_after_it_was_read_is_refused_cleanly(): void
    {
        $venue = Venue::create(['name' => 'Gym', 'location' => 'Main', 'capacity' => 10]);
        $event = Event::factory()->create(['organization_id' => $this->organization->id, 'created_by' => $this->admin->school_id, 'status' => 'planning']);
        $fired = false;
        DB::listen(function ($query) use (&$fired, $event) {
            if (! $fired && str_starts_with($query->sql, 'select * from "events" where "organization_id"')) {
                $fired = true;
                DB::table('events')->where('id', $event->id)->delete();
            }
        });
        Sanctum::actingAs($this->admin);

        $this->postJson('/api/venue-bookings', [
            'venue_id' => $venue->id,
            'event_id' => $event->id,
            'start_time' => '2030-03-12T09:00:00+08:00',
            'end_time' => '2030-03-12T11:00:00+08:00',
        ])->assertUnprocessable();

        $this->assertTrue($fired, 'the delete did not interleave');
        $this->assertSame(0, VenueBooking::count());
    }
}
