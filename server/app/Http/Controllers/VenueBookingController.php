<?php

namespace App\Http\Controllers;

use App\Models\VenueBooking;
use Illuminate\Http\Request;

class VenueBookingController extends Controller
{
    public function index(Request $request)
    {
        // SAO can see all bookings. Orgs can see their own.
        $query = VenueBooking::with(['venue', 'organization', 'requester', 'event']);
        
        if ($request->user()->role !== 'SUPER_ADMIN') {
            $query->where('organization_id', $request->user()->organization_id);
        }

        return response()->json($query->orderBy('start_time', 'desc')->paginate(20));
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'venue_id' => 'required|exists:venues,id',
            'event_id' => 'nullable|exists:events,id',
            'start_time' => 'required|date',
            'end_time' => 'required|date|after:start_time',
        ]);

        $booking = VenueBooking::create([
            'venue_id' => $data['venue_id'],
            'event_id' => $data['event_id'] ?? null,
            'organization_id' => $request->user()->organization_id,
            'start_time' => $data['start_time'],
            'end_time' => $data['end_time'],
            'status' => 'Pending',
            'requested_by' => $request->user()->school_id,
        ]);

        return response()->json($booking->load('venue'), 201);
    }

    public function review(Request $request, $id)
    {
        $booking = VenueBooking::findOrFail($id);
        $data = $request->validate([
            'status' => 'required|in:Approved,Rejected',
        ]);

        $booking->update([
            'status' => $data['status'],
            'approved_by' => $request->user()->school_id,
        ]);

        return response()->json($booking);
    }
}
