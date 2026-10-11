<?php

namespace App\Services;

use App\Models\AuditLog;
use App\Models\Event;
use App\Models\Notification;
use App\Models\User;
use App\Models\VenueBooking;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * A booking holds its venue slot while it is pending or approved. Cancelling an event withdraws
 * those bookings so the slot is free again, exactly as if the organization had withdrawn them.
 */
class EventVenueRelease
{
    public const ACTIVE_STATUSES = ['pending', 'approved'];

    public function release(Event $event, Request $request): void
    {
        $released = DB::transaction(function () use ($event, $request) {
            $bookings = VenueBooking::where('event_id', $event->id)
                ->where('organization_id', $event->organization_id)
                ->whereIn('status', self::ACTIVE_STATUSES)
                ->lockForUpdate()
                ->get();

            foreach ($bookings as $booking) {
                $booking->update([
                    'status' => 'withdrawn',
                    'remarks' => 'The event was cancelled.',
                    'reviewed_by' => $request->user()->school_id,
                    'reviewed_at' => now(),
                ]);

                AuditLog::create([
                    'organization_id' => $booking->organization_id,
                    'user_id' => $request->user()->school_id,
                    'actor_role' => $request->user()->role,
                    'module' => 'venue_bookings',
                    'action' => 'booking_withdrawn',
                    'record_type' => VenueBooking::class,
                    'record_id' => $booking->id,
                    'new_values' => ['status' => 'withdrawn', 'reason' => 'event_cancelled'],
                    'ip_address' => $request->ip(),
                    'created_at' => now(),
                ]);
            }

            return $bookings;
        });

        if ($released->isEmpty()) {
            return;
        }

        $saos = User::where('role', 'SUPER_ADMIN')->where('account_status', 'active')->get(['school_id', 'organization_id']);
        foreach ($released as $booking) {
            $venueName = $booking->venue_id ? $booking->venue()->value('name') : $booking->off_campus_location;
            foreach ($saos as $sao) {
                Notification::create([
                    'organization_id' => $sao->organization_id,
                    'user_id' => $sao->school_id,
                    'notification_type' => 'general',
                    'title' => 'Venue booking withdrawn',
                    'message' => "A booking request for \"{$venueName}\" was withdrawn because its event \"{$event->title}\" was cancelled.",
                    'reference_type' => 'venue_booking',
                    'reference_id' => $booking->id,
                    'is_read' => false,
                    'sent_at' => now(),
                ]);
            }
        }
    }
}
