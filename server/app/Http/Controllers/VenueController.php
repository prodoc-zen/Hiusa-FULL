<?php

namespace App\Http\Controllers;

use App\Models\Venue;
use Illuminate\Http\Request;

class VenueController extends Controller
{
    public function index(Request $request)
    {
        return response()->json(Venue::all());
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'name' => 'required|string|max:255',
            'capacity' => 'integer|min:0',
            'description' => 'nullable|string',
            'status' => 'sometimes|in:Available,Maintenance'
        ]);

        $venue = Venue::create($data);
        return response()->json($venue, 201);
    }

    public function update(Request $request, Venue $venue)
    {
        $data = $request->validate([
            'name' => 'sometimes|required|string|max:255',
            'capacity' => 'sometimes|integer|min:0',
            'description' => 'nullable|string',
            'status' => 'sometimes|in:Available,Maintenance'
        ]);

        $venue->update($data);
        return response()->json($venue);
    }

    public function destroy(Venue $venue)
    {
        $venue->delete();
        return response()->noContent();
    }
}
