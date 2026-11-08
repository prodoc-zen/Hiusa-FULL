<?php

namespace App\Http\Controllers;

use App\Models\AccountProfile;
use App\Models\Budget;
use App\Models\Event;
use App\Models\Organization;
use App\Models\OrganizationComplianceSubmission;
use Illuminate\Http\Request;

/** A Department Head's working view of one student organization in their college. */
class OrgSpaceController extends Controller
{
    private const MEMBER_LIMIT = 300;

    private const EVENT_COLUMNS = ['id', 'title', 'status', 'start_time', 'end_time', 'location'];

    public function show(Request $request, Organization $organization)
    {
        abort_unless(in_array($organization->id, $request->user()->scopedOrganizationIds(), true), 403, 'This organization is not in your college.');

        $id = $organization->id;
        $people = AccountProfile::query()
            ->join('users', 'users.school_id', '=', 'account_profiles.user_school_id')
            ->where('account_profiles.organization_id', $id)
            ->where('account_profiles.account_status', 'active')
            ->where('users.account_status', 'active');
        $members = (clone $people)
            ->orderByRaw("case account_profiles.role when 'ADMIN' then 0 when 'SBO_OFFICER' then 1 else 2 end")
            ->orderBy('users.last_name')->orderBy('users.first_name')
            ->limit(self::MEMBER_LIMIT)
            ->get([
                'account_profiles.id as profile_id', 'account_profiles.role', 'account_profiles.position_title',
                'users.school_id', 'users.first_name', 'users.last_name', 'users.email',
            ]);

        $events = Event::where('organization_id', $id);
        $budgets = Budget::where('organization_id', $id)->where('submission_status', 'approved')
            ->withSum(['transactions as spent_amount' => fn ($transactions) => $transactions->where('type', 'expense')], 'amount')
            ->withSum(['transactions as income_amount' => fn ($transactions) => $transactions->where('type', 'income')], 'amount')
            ->get();
        $submissions = OrganizationComplianceSubmission::where('organization_id', $id)->with('requirementType:id,name');

        return response()->json([
            'organization' => $organization->only(['id', 'name', 'acronym', 'description', 'color', 'logo_url', 'college', 'college_id', 'lifecycle_status', 'is_active']),
            'lifecycle' => [
                'status' => $organization->lifecycle_status,
                'review_remarks' => $organization->review_remarks,
                'submitted_at' => $organization->submitted_at,
                'reviewed_at' => $organization->reviewed_at,
                'archived_at' => $organization->archived_at,
            ],
            'counts' => [
                'members' => (clone $people)->count(),
                'officers' => (clone $people)->whereIn('account_profiles.role', ['ADMIN', 'SBO_OFFICER'])->count(),
                'upcoming_events' => (clone $events)->where('start_time', '>=', now())->where('status', '!=', 'cancelled')->count(),
                'pending_documents' => (clone $submissions)->where('status', 'submitted')->count(),
            ],
            'members' => $members->map(fn ($row) => [
                'profile_id' => $row->profile_id,
                'school_id' => $row->school_id,
                'name' => trim($row->first_name.' '.$row->last_name),
                'email' => $row->email,
                'role' => $row->role,
                'position_title' => $row->position_title,
            ])->values(),
            'events' => [
                'upcoming' => (clone $events)->where('start_time', '>=', now())->where('status', '!=', 'cancelled')->orderBy('start_time')->limit(20)->get(self::EVENT_COLUMNS),
                'recent' => (clone $events)->where('start_time', '<', now())->orderByDesc('start_time')->limit(10)->get(self::EVENT_COLUMNS),
            ],
            'finance' => [
                'approved_budget_count' => $budgets->count(),
                'allocated' => round((float) $budgets->sum('allocated_amount'), 2),
                'income' => round((float) $budgets->sum('income_amount'), 2),
                'spent' => round((float) $budgets->sum('spent_amount'), 2),
                'remaining' => round((float) $budgets->sum(fn (Budget $budget) => (float) $budget->allocated_amount + (float) $budget->income_amount - (float) $budget->spent_amount), 2),
                'budgets' => $budgets->map(fn (Budget $budget) => [
                    'id' => $budget->id,
                    'title' => $budget->title,
                    'allocated' => round((float) $budget->allocated_amount, 2),
                    'spent' => round((float) $budget->spent_amount, 2),
                    'remaining' => round((float) $budget->allocated_amount + (float) $budget->income_amount - (float) $budget->spent_amount, 2),
                ])->values(),
            ],
            'documents' => (clone $submissions)->orderByDesc('submitted_at')->orderByDesc('id')->limit(30)->get()->map(fn (OrganizationComplianceSubmission $submission) => [
                'id' => $submission->id,
                'requirement_name' => $submission->requirementType?->name,
                'status' => $submission->status,
                'submitted_at' => $submission->submitted_at,
                'file_name' => $submission->file_original_name,
                'remarks' => $submission->remarks,
                'open_url' => $submission->file_path ? '/compliance/submissions/'.$submission->id.'/document' : null,
            ])->values(),
        ]);
    }
}
