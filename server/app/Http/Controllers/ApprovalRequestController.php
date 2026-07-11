<?php

namespace App\Http\Controllers;

use App\Models\ApprovalRequest;
use App\Models\Budget;
use App\Models\Election;
use App\Models\Event;
use Illuminate\Http\Request;

class ApprovalRequestController extends Controller
{
    public function index(Request $request)
    {
        $query = ApprovalRequest::with([
            'requester:school_id,first_name,last_name',
            'reviewer:school_id,first_name,last_name',
        ])
            ->where('organization_id', $request->user()->organization_id)
            ->orderBy('requested_at', 'desc');

        $status = $request->query('status', 'pending');

        if ($status !== 'all') {
            $query->where('status', $status);
        }

        return response()->json($query->get());
    }

    public function review(Request $request, $id)
    {
        $approval = ApprovalRequest::where('organization_id', $request->user()->organization_id)->find($id);

        if (!$approval) {
            return response()->json(['message' => 'Approval request not found.'], 404);
        }

        if ($approval->status !== 'pending') {
            return response()->json(['message' => 'This request has already been reviewed.'], 409);
        }

        $data = $request->validate([
            'status' => ['required', 'in:approved,rejected'],
            'remarks' => ['nullable', 'string'],
        ]);

        $approval->update([
            'status' => $data['status'],
            'remarks' => $data['remarks'] ?? null,
            'reviewed_by' => $request->user()->id,
            'reviewed_at' => now(),
        ]);

        if ($data['status'] === 'approved') {
            $this->applyApproval($approval);
        }

        return response()->json($approval->fresh()->load([
            'requester:school_id,first_name,last_name',
            'reviewer:school_id,first_name,last_name',
        ]));
    }

    private function applyApproval(ApprovalRequest $approval): void
    {
        match ($approval->entity_type) {
            'event' => Event::where('id', $approval->entity_id)->update(['status' => 'approved']),
            'budget' => Budget::where('id', $approval->entity_id)->update(['status' => 'approved']),
            'election' => Election::where('id', $approval->entity_id)->update([
                'status' => $approval->summary['target_status'] ?? 'upcoming',
            ]),
        };
    }
}
