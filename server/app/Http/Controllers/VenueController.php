<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\Venue;
use App\Models\VenueBooking;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

/** SAO's venue catalog. Booking requests live in VenueBookingController. */
class VenueController extends Controller
{
    public function availability(Request $request, Venue $venue)
    {
        $filters = $request->validate([
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date', 'after_or_equal:from'],
        ]);

        $slots = VenueBooking::where('venue_id', $venue->id)
            ->whereIn('status', ['pending', 'approved'])
            ->when($filters['from'] ?? null, fn ($q, $from) => $q->where('end_time', '>=', Carbon::parse($from)))
            ->when($filters['to'] ?? null, fn ($q, $to) => $q->where('start_time', '<=', Carbon::parse($to)))
            ->orderBy('start_time')
            ->get(['id', 'organization_id', 'status', 'start_time', 'end_time'])
            ->map(fn (VenueBooking $booking) => [
                'id' => $booking->id,
                'start_time' => $booking->start_time,
                'end_time' => $booking->end_time,
                'status' => $booking->status,
                'reserved_by' => $booking->organization_id === $request->user()->organization_id
                    ? 'Your organization'
                    : 'Another organization',
            ]);

        return response()->json($slots);
    }

    public function index(Request $request)
    {
        $filters = $request->validate([
            'is_active' => ['nullable', 'boolean'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $query = Venue::query();
        if ($request->user()->role !== 'SUPER_ADMIN') {
            $query->where('is_active', true);
        } elseif ($request->has('is_active')) {
            $query->where('is_active', $filters['is_active']);
        }

        return response()->json($query->orderBy('name')->paginate($filters['per_page'] ?? 20));
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'location' => ['required', 'string', 'max:255'],
            'capacity' => ['required', 'integer', 'min:0'],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        $venue = Venue::create(['is_active' => $data['is_active'] ?? true, ...$data]);

        AuditLog::create([
            'organization_id' => null,
            'user_id' => $request->user()->school_id,
            'actor_role' => $request->user()->role,
            'module' => 'venues',
            'action' => 'venue_created',
            'record_type' => Venue::class,
            'record_id' => $venue->id,
            'new_values' => $venue->toArray(),
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);

        return response()->json($venue, 201);
    }

    public function update(Request $request, Venue $venue)
    {
        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'location' => ['sometimes', 'required', 'string', 'max:255'],
            'capacity' => ['sometimes', 'required', 'integer', 'min:0'],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        $old = $venue->toArray();
        $venue->update($data);

        AuditLog::create([
            'organization_id' => null,
            'user_id' => $request->user()->school_id,
            'actor_role' => $request->user()->role,
            'module' => 'venues',
            'action' => 'venue_updated',
            'record_type' => Venue::class,
            'record_id' => $venue->id,
            'new_values' => ['before' => $old, 'after' => $venue->fresh()->toArray()],
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);

        return response()->json($venue->fresh());
    }

    public function destroy(Request $request, Venue $venue)
    {
        $hasActiveBookings = $venue->bookings()->whereIn('status', ['pending', 'approved'])->exists();
        if ($hasActiveBookings) {
            return response()->json(['message' => 'This venue has pending or approved bookings and cannot be deleted.'], 409);
        }

        AuditLog::create([
            'organization_id' => null,
            'user_id' => $request->user()->school_id,
            'actor_role' => $request->user()->role,
            'module' => 'venues',
            'action' => 'venue_deleted',
            'record_type' => Venue::class,
            'record_id' => $venue->id,
            'new_values' => $venue->toArray(),
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);
        $venue->delete();

        return response()->json(['message' => 'Venue deleted.']);
    }
}
