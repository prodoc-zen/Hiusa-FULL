<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Organization;
use App\Models\User;
use App\Models\Venue;
use App\Models\VenueBooking;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Before the Manila fix the booking page stored the UTC wall-clock of the instant it sent, so a booking
 * for 10:00 Manila sits in the table as 02:00. The one-time migration moves exactly those rows by eight
 * hours and leaves seeded rows and rows written after the fix alone.
 */
class VenueBookingUtcBackfillMigrationTest extends TestCase
{
    use RefreshDatabase;

    private const MIGRATION = '2026_10_11_000001_shift_utc_venue_bookings_to_manila.php';

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function book(string $start, string $end, bool $viaApi, string $createdAt): VenueBooking
    {
        $venue = Venue::first() ?? Venue::create(['name' => 'Auditorium', 'location' => 'Main Campus', 'capacity' => 500]);
        $user = User::first() ?? User::factory()->create(['role' => 'ADMIN', 'organization_id' => Organization::factory(), 'account_status' => 'active']);
        $booking = DB::table('venue_bookings')->insertGetId([
            'venue_id' => $venue->id, 'organization_id' => $user->organization_id, 'status' => 'approved',
            'start_time' => $start, 'end_time' => $end, 'requested_by' => $user->school_id,
            'created_at' => $createdAt, 'updated_at' => $createdAt,
        ]);
        if ($viaApi) {
            AuditLog::create([
                'organization_id' => $user->organization_id, 'user_id' => $user->school_id, 'module' => 'venue_bookings',
                'action' => 'booking_requested', 'record_type' => VenueBooking::class, 'record_id' => $booking, 'created_at' => $createdAt,
            ]);
        }

        return VenueBooking::find($booking);
    }

    private function migrate(): void
    {
        (require database_path('migrations/'.self::MIGRATION))->up();
    }

    public function test_a_booking_made_through_the_api_before_the_fix_moves_forward_eight_hours(): void
    {
        Carbon::setTestNow('2026-10-12 09:00:00');
        $booking = $this->book('2026-10-14 02:00:00', '2026-10-14 04:00:00', true, '2026-10-10 09:00:00');

        $this->migrate();

        $this->assertSame('2026-10-14 10:00:00', $booking->fresh()->start_time->format('Y-m-d H:i:s'));
        $this->assertSame('2026-10-14 12:00:00', $booking->fresh()->end_time->format('Y-m-d H:i:s'));
    }

    public function test_seeded_rows_and_rows_written_after_the_fix_keep_their_times(): void
    {
        Carbon::setTestNow('2026-10-12 09:00:00');
        $seeded = $this->book('2026-10-14 10:00:00', '2026-10-14 12:00:00', false, '2026-10-10 09:00:00');
        $afterFix = $this->book('2026-10-15 10:00:00', '2026-10-15 12:00:00', true, '2026-10-12 09:30:00');

        $this->migrate();

        $this->assertSame('2026-10-14 10:00:00', $seeded->fresh()->start_time->format('Y-m-d H:i:s'));
        $this->assertSame('2026-10-15 10:00:00', $afterFix->fresh()->start_time->format('Y-m-d H:i:s'));
    }
}
