<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\Event;
use App\Models\Notification;
use App\Models\User;
use App\Models\Venue;
use App\Models\VenueBooking;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Venue booking requests. ADMIN and SBO_OFFICER request bookings for their own
 * organization; SUPER_ADMIN approves or rejects. A booking that ends exactly
 * when another starts does not overlap it - overlap requires the intervals
 * to actually intersect (strict inequalities on both sides).
 */
class VenueBookingController extends Controller
{
    public function index(Request $request)
    {
        $filters = $request->validate([
            'status' => ['nullable', 'in:pending,approved,rejected,withdrawn'],
            'venue_id' => ['nullable', 'integer', 'exists:venues,id'],
            'organization_id' => ['nullable', 'integer', Rule::exists('organizations', 'id')->where('organization_type', '!=', 'SYSTEM_ADMINISTRATION')],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date', 'after_or_equal:from'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $query = VenueBooking::with([
            'venue:id,name,location',
            'organization:id,name,acronym',
            'requester:school_id,first_name,last_name',
            'event:id,title',
        ]);

        if ($request->user()->role === 'SUPER_ADMIN') {
            $query->when($filters['organization_id'] ?? null, fn ($q, $id) => $q->where('organization_id', $id));
        } else {
            $query->where('organization_id', $request->user()->organization_id);
        }
        $query
            ->when($filters['status'] ?? null, fn ($q, $status) => $q->where('status', $status))
            ->when($filters['venue_id'] ?? null, fn ($q, $id) => $q->where('venue_id', $id))
            ->when($filters['from'] ?? null, fn ($q, $from) => $q->where('end_time', '>=', Carbon::parse($from)))
            ->when($filters['to'] ?? null, fn ($q, $to) => $q->where('start_time', '<=', Carbon::parse($to)));

        return response()->json($query->orderByDesc('start_time')->paginate($filters['per_page'] ?? 20));
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'venue_type' => ['nullable', 'in:on_campus,off_campus'],
            'venue_id' => [Rule::requiredIf($request->input('venue_type', 'on_campus') === 'on_campus'), 'nullable', 'integer', Rule::exists('venues', 'id')->where('is_active', true)],
            'off_campus_location' => [Rule::requiredIf($request->input('venue_type') === 'off_campus'), 'nullable', 'string', 'max:255'],
            'event_id' => ['nullable', 'integer'],
            'start_time' => ['required', 'date'],
            'end_time' => ['required', 'date', 'after:start_time'],
        ]);

        $start = Carbon::parse($data['start_time'])->setTimezone('Asia/Manila');
        $end = Carbon::parse($data['end_time'])->setTimezone('Asia/Manila');
        if (! $start->isSameDay($end) || $start->format('H:i') < '05:00' || $end->format('H:i') > '22:00') {
            return response()->json(['message' => 'Choose a time on one day between 5:00 AM and 10:00 PM.'], 422);
        }

        $organizationId = $request->user()->organization_id;
        if (! empty($data['event_id'])) {
            $event = Event::where('organization_id', $organizationId)->find($data['event_id']);
            if (! $event) {
                return response()->json(['message' => 'Selected event does not belong to this organization.'], 422);
            }
        }

        $offCampus = ($data['venue_type'] ?? 'on_campus') === 'off_campus';
        $booking = DB::transaction(function () use ($data, $organizationId, $request, $offCampus) {
            if (! $offCampus) {
                Venue::whereKey($data['venue_id'])->lockForUpdate()->first();
                if ($this->hasApprovedOverlap($data['venue_id'], $data['start_time'], $data['end_time'], null, true)) {
                    return null;
                }
            }

            return VenueBooking::create([
                'venue_id' => $offCampus ? null : $data['venue_id'],
                'off_campus_location' => $offCampus ? trim($data['off_campus_location']) : null,
                'event_id' => $data['event_id'] ?? null,
                'organization_id' => $organizationId,
                'start_time' => $data['start_time'],
                'end_time' => $data['end_time'],
                'status' => 'pending',
                'requested_by' => $request->user()->school_id,
            ]);
        });
        if (! $booking) {
            return response()->json(['message' => 'This venue already has a pending or approved booking during that time. Choose another slot.'], 422);
        }

        AuditLog::create([
            'organization_id' => $organizationId,
            'user_id' => $request->user()->school_id,
            'actor_role' => $request->user()->role,
            'module' => 'venue_bookings',
            'action' => 'booking_requested',
            'record_type' => VenueBooking::class,
            'record_id' => $booking->id,
            'new_values' => $booking->toArray(),
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);

        $venueName = $offCampus ? $data['off_campus_location'] : Venue::find($data['venue_id'])?->name;
        User::where('role', 'SUPER_ADMIN')->where('account_status', 'active')->get(['school_id', 'organization_id'])
            ->each(fn (User $sao) => Notification::create([
                'organization_id' => $sao->organization_id,
                'user_id' => $sao->school_id,
                'notification_type' => 'general',
                'title' => 'New venue booking request',
                'message' => "A venue booking request for \"{$venueName}\" is awaiting your review.",
                'reference_type' => 'venue_booking',
                'reference_id' => $booking->id,
                'is_read' => false,
                'sent_at' => now(),
            ]));

        return response()->json($booking->load('venue:id,name,location'), 201);
    }

    public function review(Request $request, VenueBooking $venueBooking)
    {
        $data = $request->validate([
            'status' => ['required', 'in:approved,rejected'],
            'remarks' => ['nullable', 'string', 'max:2000', 'required_if:status,rejected'],
        ]);

        $result = DB::transaction(function () use ($request, $venueBooking, $data) {
            $booking = VenueBooking::whereKey($venueBooking->id)->lockForUpdate()->first();
            if ($booking->status !== 'pending') {
                return ['conflict' => 'Only a pending booking can be reviewed.'];
            }

            if ($data['status'] === 'approved' && $booking->venue_id) {
                // Lock the venue row itself, not just this booking, so a
                // concurrent approval of a different overlapping booking for
                // the same venue cannot pass its own overlap check before
                // this transaction commits.
                Venue::whereKey($booking->venue_id)->lockForUpdate()->first();
                if ($this->hasApprovedOverlap($booking->venue_id, $booking->start_time, $booking->end_time, $booking->id)) {
                    return ['conflict' => 'Another booking for this venue was approved for an overlapping time in the meantime.'];
                }
            }

            $booking->update([
                'status' => $data['status'],
                'remarks' => $data['remarks'] ?? null,
                'reviewed_by' => $request->user()->school_id,
                'reviewed_at' => now(),
            ]);

            AuditLog::create([
                'organization_id' => $booking->organization_id,
                'user_id' => $request->user()->school_id,
                'actor_role' => $request->user()->role,
                'module' => 'venue_bookings',
                'action' => $data['status'] === 'approved' ? 'booking_approved' : 'booking_rejected',
                'record_type' => VenueBooking::class,
                'record_id' => $booking->id,
                'new_values' => ['status' => $data['status'], 'remarks' => $data['remarks'] ?? null],
                'ip_address' => $request->ip(),
                'created_at' => now(),
            ]);

            return ['booking' => $booking->fresh()];
        });

        if (isset($result['conflict'])) {
            return response()->json(['message' => $result['conflict']], 409);
        }

        $booking = $result['booking'];
        $venueName = $booking->venue()->value('name');
        User::whereHas('accountProfiles', fn ($profiles) => $profiles->where('organization_id', $booking->organization_id)
            ->whereIn('role', ['ADMIN', 'SBO_OFFICER'])
            ->where('account_status', 'active'))
            ->get(['school_id'])
            ->each(fn (User $recipient) => Notification::create([
                'organization_id' => $booking->organization_id,
                'user_id' => $recipient->school_id,
                'notification_type' => 'general',
                'title' => $data['status'] === 'approved' ? 'Venue booking approved' : 'Venue booking rejected',
                'message' => $data['status'] === 'approved'
                    ? "Your booking request for \"{$venueName}\" was approved."
                    : "Your booking request for \"{$venueName}\" was rejected: ".$data['remarks'],
                'reference_type' => 'venue_booking',
                'reference_id' => $booking->id,
                'is_read' => false,
                'sent_at' => now(),
            ]));

        return response()->json($booking->load('venue:id,name,location'));
    }

    public function withdraw(Request $request, VenueBooking $venueBooking)
    {
        // Both the ownership and the withdrawable-status checks must run
        // against the row as of the moment it is locked, not the possibly
        // stale $venueBooking the route resolved before a concurrent review()
        // could have rejected it - otherwise that reject can be overwritten.
        $result = DB::transaction(function () use ($request, $venueBooking) {
            $booking = VenueBooking::whereKey($venueBooking->id)->lockForUpdate()->first();

            if ($booking->organization_id !== $request->user()->organization_id) {
                return ['not_found' => true];
            }

            $canWithdraw = $booking->status === 'pending'
                || ($booking->status === 'approved' && Carbon::parse($booking->start_time)->isFuture());
            if (! $canWithdraw) {
                return ['conflict' => 'Only a pending booking or a future approved booking can be withdrawn.'];
            }

            $booking->update([
                'status' => 'withdrawn',
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
                'new_values' => ['status' => 'withdrawn'],
                'ip_address' => $request->ip(),
                'created_at' => now(),
            ]);

            return ['booking' => $booking->fresh()];
        });

        if (isset($result['not_found'])) {
            return response()->json(['message' => 'Venue booking not found.'], 404);
        }

        if (isset($result['conflict'])) {
            return response()->json(['message' => $result['conflict']], 409);
        }

        $booking = $result['booking'];
        $venueName = $booking->venue()->value('name');
        User::where('role', 'SUPER_ADMIN')->where('account_status', 'active')->get(['school_id', 'organization_id'])
            ->each(fn (User $sao) => Notification::create([
                'organization_id' => $sao->organization_id,
                'user_id' => $sao->school_id,
                'notification_type' => 'general',
                'title' => 'Venue booking withdrawn',
                'message' => "A booking request for \"{$venueName}\" was withdrawn by the requesting organization.",
                'reference_type' => 'venue_booking',
                'reference_id' => $booking->id,
                'is_read' => false,
                'sent_at' => now(),
            ]));

        return response()->json($booking->load('venue:id,name,location'));
    }

    private function hasApprovedOverlap(int $venueId, $startTime, $endTime, ?int $excludingBookingId = null, bool $includePending = false): bool
    {
        return VenueBooking::where('venue_id', $venueId)
            ->whereIn('status', $includePending ? ['pending', 'approved'] : ['approved'])
            ->when($excludingBookingId, fn ($q, $id) => $q->whereKeyNot($id))
            ->where('start_time', '<', Carbon::parse($endTime))
            ->where('end_time', '>', Carbon::parse($startTime))
            ->exists();
    }
}
