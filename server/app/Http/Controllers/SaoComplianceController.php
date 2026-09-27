<?php

namespace App\Http\Controllers;

use App\Models\Organization;
use App\Models\OrganizationCompliance;
use Illuminate\Http\Request;

class SaoComplianceController extends Controller
{
    public function indexAdmin(Request $request, Organization $organization)
    {
        return response()->json($organization->complianceRequirements);
    }

    public function storeRequirement(Request $request, Organization $organization)
    {
        $data = $request->validate([
            'requirement_name' => 'required|string|max:255',
            'remarks' => 'nullable|string',
        ]);
        
        $req = $organization->complianceRequirements()->create([
            'requirement_name' => $data['requirement_name'],
            'remarks' => $data['remarks'] ?? null,
            'status' => 'Pending'
        ]);

        return response()->json($req, 201);
    }

    public function updateRequirement(Request $request, Organization $organization, OrganizationCompliance $compliance)
    {
        $data = $request->validate([
            'requirement_name' => 'sometimes|required|string|max:255',
            'remarks' => 'nullable|string',
        ]);

        $compliance->update($data);

        return response()->json($compliance);
    }

    public function reviewRequirement(Request $request, Organization $organization, OrganizationCompliance $compliance)
    {
        $data = $request->validate([
            'status' => 'required|in:Approved,Rejected,Pending',
            'remarks' => 'nullable|string',
        ]);

        $compliance->update([
            'status' => $data['status'],
            'remarks' => $data['remarks'] ?? $compliance->remarks,
            'reviewed_by' => $request->user()->school_id,
            'reviewed_at' => now(),
        ]);

        return response()->json($compliance);
    }

    public function index(Request $request)
    {
        $reqs = OrganizationCompliance::where('organization_id', $request->user()->organization_id)->get();
        return response()->json($reqs);
    }

    public function submitDocument(Request $request, OrganizationCompliance $compliance)
    {
        if ($compliance->organization_id !== $request->user()->organization_id) {
            abort(403);
        }

        $data = $request->validate([
            'document_url' => 'required|url|max:500',
        ]);

        $compliance->update([
            'document_url' => $data['document_url'],
            'status' => 'Pending'
        ]);

        return response()->json($compliance);
    }
}
