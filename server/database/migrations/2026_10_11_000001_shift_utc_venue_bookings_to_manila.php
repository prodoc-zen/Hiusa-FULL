<?php

use App\Models\VenueBooking;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Until the booking times were read as Manila, a request sent as UTC (the booking page sends
 * toISOString) was saved as its UTC wall clock, eight hours before the Manila time it names. Only the
 * API writes a `booking_requested` audit row, so those rows are the ones to move; seeded rows were
 * written in Manila time already, and a row requested after this migration runs is stored correctly.
 */
return new class extends Migration
{
    private const MANILA_OFFSET_HOURS = 8;

    public function up(): void
    {
        $cutoff = now();

        $apiRequested = DB::table('audit_logs')
            ->where('module', 'venue_bookings')
            ->where('action', 'booking_requested')
            ->where('record_type', VenueBooking::class)
            ->select('record_id');

        DB::table('venue_bookings')
            ->whereIn('id', $apiRequested)
            ->where('created_at', '<', $cutoff)
            ->orderBy('id')
            ->each(function ($booking) {
                DB::table('venue_bookings')->where('id', $booking->id)->update([
                    'start_time' => Carbon::parse($booking->start_time)->addHours(self::MANILA_OFFSET_HOURS)->format('Y-m-d H:i:s'),
                    'end_time' => Carbon::parse($booking->end_time)->addHours(self::MANILA_OFFSET_HOURS)->format('Y-m-d H:i:s'),
                ]);
            });
    }

    public function down(): void
    {
        // The shift cannot be told apart from later writes, so it is not reversed.
    }
};
