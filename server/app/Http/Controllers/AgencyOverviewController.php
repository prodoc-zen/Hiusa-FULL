<?php

namespace App\Http\Controllers;

use App\Models\AccountProfile;
use App\Models\ApprovalRequest;
use App\Models\Budget;
use App\Models\College;
use App\Models\Event;
use App\Models\Organization;
use App\Models\OrganizationComplianceSubmission;
use App\Models\User;
use App\Services\Compliance\AccreditationStatusService;
use Illuminate\Support\Collection;

/** SAO read-only view of every college and organization, and a look inside one organization. */
class AgencyOverviewController extends Controller
{
    private const LIFECYCLES = ['pending', 'returned', 'active', 'archived'];

    private const MEMBER_ROLES = ['STUDENT', 'SBO_OFFICER', 'ADMIN'];

    public function __construct(private readonly AccreditationStatusService $accreditation) {}

    public function agency()
    {
        $organizations = Organization::student()->orderBy('name')->get(['id', 'name', 'acronym', 'college_id', 'lifecycle_status', 'is_active', 'submitted_at']);
        $ids = $organizations->pluck('id');
        $members = $this->profileCounts($ids);
        $approvals = ApprovalRequest::whereIn('organization_id', $ids)->where('status', 'pending')
            ->selectRaw('organization_id, count(*) as total')->groupBy('organization_id')->pluck('total', 'organization_id');
        $documents = OrganizationComplianceSubmission::whereIn('organization_id', $ids)->where('status', 'submitted')
            ->selectRaw('organization_id, count(*) as total')->groupBy('organization_id')->pluck('total', 'organization_id');
        $accreditation = $this->accreditation->forOrganizations($ids);

        $rows = $organizations->map(function (Organization $organization) use ($members, $approvals, $documents, $accreditation) {
            $counts = $this->memberCounts($members->get($organization->id, collect()));

            return [
                ...$organization->only(['id', 'name', 'acronym', 'college_id', 'lifecycle_status', 'is_active', 'submitted_at']),
                'member_counts' => $counts,
                'administrators_count' => $counts['ADMIN'],
                'accreditation_status' => $accreditation[$organization->id] ?? 'not_applicable',
                'pending_approvals_count' => (int) $approvals->get($organization->id, 0),
                'pending_documents_count' => (int) $documents->get($organization->id, 0),
            ];
        });
        $byCollege = $rows->groupBy('college_id');

        return response()->json([
            'totals' => [
                'colleges' => College::count(),
                'organizations' => $rows->count(),
                'by_lifecycle_status' => $this->lifecycleCounts($rows),
            ],
            'colleges' => College::with('homeOrganization:id,college_id')->orderBy('name')->get()->map(function (College $college) use ($byCollege) {
                $organizations = $byCollege->get($college->id, collect());

                return [
                    'id' => $college->id,
                    'name' => $college->name,
                    'code' => $college->code,
                    'home_organization_id' => $college->homeOrganization?->id,
                    'organizations_count' => $organizations->count(),
                    'by_lifecycle_status' => $this->lifecycleCounts($organizations),
                    'organizations' => $organizations->values(),
                ];
            })->values(),
            'unassigned_organizations' => $rows->whereNull('college_id')->values(),
        ]);
    }

    public function organization(Organization $organization)
    {
        abort_unless($organization->organization_type === 'STUDENT_ORGANIZATION', 404);
        $id = $organization->id;
        $profiles = AccountProfile::where('organization_id', $id)
            ->with(['user' => fn ($query) => $query->without('organization')->select('school_id', 'first_name', 'last_name')])
            ->get();
        $budgets = Budget::where('organization_id', $id)->where('submission_status', 'approved')
            ->withSum(['transactions as spent_amount' => fn ($transactions) => $transactions->where('type', 'expense')], 'amount')
            ->withSum(['transactions as income_amount' => fn ($transactions) => $transactions->where('type', 'income')], 'amount')
            ->get();
        $eventColumns = ['id', 'title', 'status', 'start_time', 'end_time', 'location'];
        $events = Event::where('organization_id', $id)->limit(5);
        $submissions = OrganizationComplianceSubmission::where('organization_id', $id);
        $people = User::without('organization')
            ->whereIn('school_id', array_filter([$organization->submitted_by, $organization->reviewed_by, $organization->archived_by]))
            ->get(['school_id', 'first_name', 'last_name'])->keyBy('school_id');
        $person = fn ($schoolId) => $people->get($schoolId) ? ['school_id' => $people[$schoolId]->school_id, 'name' => trim($people[$schoolId]->first_name.' '.$people[$schoolId]->last_name)] : null;

        return response()->json([
            'organization' => $organization->only(['id', 'name', 'acronym', 'slug', 'description', 'color', 'logo_url', 'college', 'college_id', 'is_active', 'lifecycle_status']),
            'lifecycle' => [
                'status' => $organization->lifecycle_status,
                'review_remarks' => $organization->review_remarks,
                'submitted_at' => $organization->submitted_at,
                'submitted_by' => $person($organization->submitted_by),
                'reviewed_at' => $organization->reviewed_at,
                'reviewed_by' => $person($organization->reviewed_by),
                'archived_at' => $organization->archived_at,
                'archived_by' => $person($organization->archived_by),
            ],
            'leadership' => $profiles->whereIn('role', ['ADMIN', 'SBO_OFFICER'])->sortBy(fn (AccountProfile $profile) => $profile->role.'|'.$profile->user->last_name)->map(fn (AccountProfile $profile) => [
                'school_id' => $profile->user_school_id,
                'name' => trim($profile->user->first_name.' '.$profile->user->last_name),
                'role' => $profile->role,
                'position_title' => $profile->position_title,
                'account_status' => $profile->account_status,
            ])->values(),
            'member_counts' => $this->memberCounts($profiles->where('account_status', 'active')->countBy('role')),
            'events' => [
                'upcoming' => (clone $events)->where('start_time', '>=', now())->where('status', '!=', 'cancelled')->orderBy('start_time')->get($eventColumns),
                'recent' => (clone $events)->where('start_time', '<', now())->orderByDesc('start_time')->get($eventColumns),
            ],
            'budget' => [
                'approved_budget_count' => $budgets->count(),
                'allocated' => round((float) $budgets->sum('allocated_amount'), 2),
                'spent' => round((float) $budgets->sum('spent_amount'), 2),
                'income' => round((float) $budgets->sum('income_amount'), 2),
                'remaining' => round((float) $budgets->sum(fn (Budget $budget) => (float) $budget->allocated_amount + (float) $budget->income_amount - (float) $budget->spent_amount), 2),
            ],
            'compliance' => [
                'accreditation_status' => $this->accreditation->forOrganization($id),
                'pending_documents_count' => (clone $submissions)->where('status', 'submitted')->count(),
            ],
            'pending_approvals_count' => ApprovalRequest::where('organization_id', $id)->where('status', 'pending')->count(),
            'documents' => (clone $submissions)->with('requirementType:id,name')->orderByDesc('submitted_at')->limit(10)->get()->map(fn (OrganizationComplianceSubmission $submission) => [
                'id' => $submission->id,
                'requirement_name' => $submission->requirementType?->name,
                'status' => $submission->status,
                'submitted_at' => $submission->submitted_at,
                'file_name' => $submission->file_original_name,
                'remarks' => $submission->remarks,
            ])->values(),
        ]);
    }

    /** @return Collection<int, Collection> active profile counts per organization id, each a role => total map */
    private function profileCounts(Collection $organizationIds): Collection
    {
        return AccountProfile::whereIn('organization_id', $organizationIds)->where('account_status', 'active')
            ->selectRaw('organization_id, role, count(*) as total')->groupBy('organization_id', 'role')->get()
            ->groupBy('organization_id')->map(fn (Collection $rows) => $rows->pluck('total', 'role'));
    }

    private function memberCounts(Collection $byRole): array
    {
        return [...collect(self::MEMBER_ROLES)->mapWithKeys(fn ($role) => [$role => (int) $byRole->get($role, 0)])->all(), 'total' => (int) $byRole->sum()];
    }

    private function lifecycleCounts(Collection $rows): array
    {
        return collect(self::LIFECYCLES)->mapWithKeys(fn ($status) => [$status => $rows->where('lifecycle_status', $status)->count()])->all();
    }
}
