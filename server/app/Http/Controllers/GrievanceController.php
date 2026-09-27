<?php

namespace App\Http\Controllers;

use App\Models\Grievance;
use Illuminate\Http\Request;

class GrievanceController extends Controller
{
    public function index(Request $request)
    {
        $query = Grievance::with(['organization', 'submitter', 'assignee']);
        
        if ($request->has('status')) {
            $query->where('status', $request->input('status'));
        }

        return response()->json($query->orderBy('created_at', 'desc')->paginate(20));
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'organization_id' => 'nullable|exists:organizations,id',
            'title' => 'required|string|max:255',
            'description' => 'required|string',
            'is_anonymous' => 'boolean',
        ]);

        $grievance = Grievance::create([
            'organization_id' => $data['organization_id'] ?? null,
            'title' => $data['title'],
            'description' => $data['description'],
            'status' => 'Open',
            'is_anonymous' => $data['is_anonymous'] ?? false,
            'submitted_by' => ($data['is_anonymous'] ?? false) ? null : $request->user()->school_id,
        ]);

        return response()->json($grievance, 201);
    }

    public function review(Request $request, $id)
    {
        $grievance = Grievance::findOrFail($id);
        $data = $request->validate([
            'status' => 'required|in:Open,In Progress,Resolved',
            'resolution_remarks' => 'nullable|string',
        ]);

        $grievance->update([
            'status' => $data['status'],
            'resolution_remarks' => $data['resolution_remarks'] ?? $grievance->resolution_remarks,
            'assigned_to' => $request->user()->school_id,
            'resolved_at' => $data['status'] === 'Resolved' ? now() : null,
        ]);

        return response()->json($grievance);
    }
}
