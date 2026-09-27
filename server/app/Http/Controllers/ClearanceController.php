<?php

namespace App\Http\Controllers;

use App\Models\Clearance;
use App\Models\ClearanceSignature;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Http\Request;

class ClearanceController extends Controller
{
    public function index(Request $request)
    {
        return response()->json(Clearance::orderBy('created_at', 'desc')->get());
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'academic_year' => 'required|string|max:20',
            'semester' => 'required|string|max:20',
            'title' => 'required|string|max:255',
            'description' => 'nullable|string',
            'deadline' => 'nullable|date',
        ]);

        $clearance = Clearance::create($data);

        // Generate signatures for all active organization officers
        $officers = User::where('role', 'SBO_OFFICER')->where('account_status', 'active')->get();
        foreach ($officers as $officer) {
            ClearanceSignature::create([
                'clearance_id' => $clearance->id,
                'officer_id' => $officer->school_id,
                'organization_id' => $officer->organization_id,
            ]);
        }

        return response()->json($clearance, 201);
    }

    public function signatures(Request $request, $id)
    {
        $clearance = Clearance::findOrFail($id);
        $query = $clearance->signatures()->with(['officer', 'organization', 'clearingUser']);

        if ($request->user()->role !== 'SUPER_ADMIN') {
            $query->where('organization_id', $request->user()->organization_id);
        }

        return response()->json($query->get());
    }

    public function reviewSignature(Request $request, $id, $signatureId)
    {
        $signature = ClearanceSignature::where('clearance_id', $id)->findOrFail($signatureId);

        $data = $request->validate([
            'status' => 'required|in:Pending,Cleared,Denied',
            'remarks' => 'nullable|string',
        ]);

        $signature->update([
            'status' => $data['status'],
            'remarks' => $data['remarks'] ?? $signature->remarks,
            'cleared_by' => $request->user()->school_id,
            'cleared_at' => $data['status'] === 'Cleared' ? now() : null,
        ]);

        return response()->json($signature);
    }
}
