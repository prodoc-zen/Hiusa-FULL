<?php

namespace App\Http\Controllers;

use App\Models\AcademicSemester;
use App\Models\AccountProfile;
use App\Models\AuditLog;
use App\Models\College;
use App\Models\ComplianceRequirementType;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\OrganizationComplianceSubmission;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * A Department Head's view of their own college: its student organizations, read only, and the
 * college office staff. New organizations no longer start here: the head allows a student to apply
 * (ApplicantGrantController) and the application goes through OrganizationApplicationReviewController.
 * The college always comes from the head's account, never from input.
 */
class CollegeOrganizationController extends Controller
{
    public function index(Request $request)
    {
        $filters = $request->validate([
            'lifecycle_status' => ['nullable', 'in:pending,returned,active,archived,all'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $college = $this->college($request->user());

        $page = $this->query($college)
            ->when(($filters['lifecycle_status'] ?? 'all') !== 'all', fn ($query) => $query->where('lifecycle_status', $filters['lifecycle_status']))
            ->orderBy('name')
            ->paginate($filters['per_page'] ?? 50);

        $checklists = $this->checklists($page->getCollection()->whereIn('lifecycle_status', ['pending', 'returned'])->pluck('id'));
        $scoped = array_values(array_intersect($page->getCollection()->pluck('id')->all(), $request->user()->scopedOrganizationIds()));
        $roleCounts = $this->roleCounts($scoped);
        $leadership = $this->leadership($scoped);
        $page->getCollection()->transform(fn (Organization $organization) => $this->row($organization, $checklists, [
            'role_counts' => [
                'admin' => (int) ($roleCounts[$organization->id]['ADMIN'] ?? 0),
                'sbo_officer' => (int) ($roleCounts[$organization->id]['SBO_OFFICER'] ?? 0),
                'student' => (int) ($roleCounts[$organization->id]['STUDENT'] ?? 0),
            ],
            'leadership' => $leadership->get($organization->id, []),
        ]));

        return response()->json($page);
    }

    public function overview(Request $request)
    {
        $user = $request->user();
        $college = $this->college($user);

        return response()->json([
            'college' => $college->only(['id', 'name', 'code', 'logo_url', 'color']),
            'head' => ['name' => trim("{$user->first_name} {$user->last_name}")],
        ]);
    }

    public function staff(Request $request)
    {
        $college = $this->college($request->user());
        $home = Organization::where('college_id', $college->id)->where('organization_type', 'COLLEGE')->firstOrFail();

        $primaryStaff = User::where('organization_id', $home->id)
            ->whereIn('role', ['DEPARTMENT_HEAD', 'ADMIN'])
            ->where('account_status', 'active')
            ->get();

        $secondaryProfiles = AccountProfile::where('organization_id', $home->id)
            ->whereIn('role', ['DEPARTMENT_HEAD', 'ADMIN'])
            ->where('account_status', 'active')
            ->with('user')
            ->get();

        $allStaff = collect();

        foreach ($primaryStaff as $user) {
            $allStaff->put($user->school_id, [
                'school_id' => $user->school_id,
                'name' => trim("{$user->first_name} {$user->last_name}"),
                'first_name' => $user->first_name,
                'last_name' => $user->last_name,
                'email' => $user->email,
                'role' => $user->role,
                'position_title' => $user->position_title ?? ($user->role === 'DEPARTMENT_HEAD' ? 'Department Head / Dean' : 'College Secretary'),
                'account_status' => $user->account_status,
                'is_lead_head' => $user->role === 'DEPARTMENT_HEAD',
            ]);
        }

        foreach ($secondaryProfiles as $profile) {
            if ($profile->user && ! $allStaff->has($profile->user->school_id)) {
                $allStaff->put($profile->user->school_id, [
                    'school_id' => $profile->user->school_id,
                    'name' => trim("{$profile->user->first_name} {$profile->user->last_name}"),
                    'first_name' => $profile->user->first_name,
                    'last_name' => $profile->user->last_name,
                    'email' => $profile->user->email,
                    'role' => $profile->role,
                    'position_title' => $profile->position_title ?? 'College Secretary',
                    'account_status' => $profile->account_status,
                    'is_lead_head' => false,
                ]);
            }
        }

        return response()->json($allStaff->values());
    }

    /** Attaches an account that already exists. A new person comes through POST /college/staff/invitations. */
    public function storeStaff(Request $request)
    {
        $college = $this->college($request->user());
        $home = Organization::where('college_id', $college->id)->where('organization_type', 'COLLEGE')->firstOrFail();

        $data = $request->validate([
            'school_id' => ['required', 'integer', 'min:1', 'max:99999999'],
            'position_title' => ['required', 'string', 'max:100'],
        ]);

        $staff = DB::transaction(function () use ($request, $data, $home, $college) {
            $existing = User::whereKey($data['school_id'])->lockForUpdate()->first();

            if (! $existing || $existing->getRawOriginal('account_status') !== 'active' || $existing->getRawOriginal('role') === 'SUPER_ADMIN') {
                throw ValidationException::withMessages([
                    'school_id' => ['Pick someone who already has an active account. New people need an invitation link.'],
                ]);
            }

            $inCollege = $existing->accountProfiles()
                ->where('account_status', 'active')
                ->whereHas('organization', fn ($organization) => $organization->where('college_id', $college->id))
                ->exists();
            if (! $inCollege) {
                throw ValidationException::withMessages([
                    'school_id' => ['Pick someone from your own college. People from another college cannot join your office.'],
                ]);
            }

            if ($existing->accountProfiles()->where('organization_id', $home->id)->exists() || (int) $existing->getRawOriginal('organization_id') === (int) $home->id) {
                throw ValidationException::withMessages([
                    'school_id' => ['This person is already on the college office staff.'],
                ]);
            }

            $profile = $existing->accountProfiles()->create([
                'organization_id' => $home->id,
                'role' => 'ADMIN',
                'position_title' => $data['position_title'],
                'account_status' => 'active',
            ]);

            AuditLog::create([
                'organization_id' => $home->id,
                'user_id' => $request->user()->school_id,
                'actor_role' => $request->user()->role,
                'module' => 'users',
                'action' => 'college_staff_delegated',
                'record_type' => AccountProfile::class,
                'record_id' => $profile->id,
                'new_values' => ['user_school_id' => $existing->school_id, 'position_title' => $data['position_title'], 'role' => 'ADMIN'],
                'description' => "Assigned {$existing->first_name} {$existing->last_name} as {$data['position_title']} in {$college->name}.",
                'ip_address' => $request->ip(),
                'created_at' => now(),
            ]);

            Notification::create([
                'organization_id' => $home->id,
                'user_id' => $existing->school_id,
                'notification_type' => 'general',
                'title' => 'College Office Role Assigned',
                'message' => "You have been assigned as {$data['position_title']} for {$college->name}.",
                'is_read' => false,
                'sent_at' => now(),
            ]);

            return [
                'school_id' => $existing->school_id,
                'name' => trim("{$existing->first_name} {$existing->last_name}"),
                'first_name' => $existing->first_name,
                'last_name' => $existing->last_name,
                'email' => $existing->email,
                'role' => 'ADMIN',
                'position_title' => $data['position_title'],
                'account_status' => 'active',
                'is_lead_head' => false,
            ];
        });

        return response()->json($staff, 201);
    }

    public function destroyStaff(Request $request, $schoolId)
    {
        $college = $this->college($request->user());
        $home = Organization::where('college_id', $college->id)->where('organization_type', 'COLLEGE')->firstOrFail();

        if ((int) $schoolId === (int) $request->user()->school_id) {
            return response()->json(['message' => 'You cannot remove yourself from the college office.'], 422);
        }

        $user = User::whereKey($schoolId)->first();
        if (! $user) {
            return response()->json(['message' => 'Staff member not found.'], 404);
        }

        DB::transaction(function () use ($request, $user, $home, $college) {
            $profile = AccountProfile::where('organization_id', $home->id)
                ->where('user_school_id', $user->school_id)
                ->first();

            if ($profile) {
                $remaining = AccountProfile::where('user_school_id', $user->school_id)->where('id', '!=', $profile->id)->exists();
                $profile->delete();
                $user->tokens()->where('account_profile_id', $profile->id)->delete();
                if (! $remaining && (int) $user->getRawOriginal('organization_id') === (int) $home->id) {
                    $user->update(['account_status' => 'disabled']);
                    $user->tokens()->delete();
                }
            } elseif ((int) $user->organization_id === (int) $home->id) {
                abort_if($user->role === 'DEPARTMENT_HEAD' && User::where('organization_id', $home->id)->where('role', 'DEPARTMENT_HEAD')->where('account_status', 'active')->count() <= 1, 422, 'Cannot remove the primary Department Head.');
                $user->update(['account_status' => 'disabled']);
                $user->tokens()->delete();
            }

            AuditLog::create([
                'organization_id' => $home->id,
                'user_id' => $request->user()->school_id,
                'actor_role' => $request->user()->role,
                'module' => 'users',
                'action' => 'college_staff_removed',
                'record_type' => User::class,
                'record_id' => $user->school_id,
                'description' => "Removed {$user->first_name} {$user->last_name} from {$college->name} office staff.",
                'ip_address' => $request->ip(),
                'created_at' => now(),
            ]);
        });

        return response()->json(['message' => 'Staff member removed successfully.']);
    }

    private function college(User $user): College
    {
        $home = Organization::whereKey($user->organization_id)->first(['id', 'organization_type', 'college_id']);
        $college = $home && $home->organization_type === 'COLLEGE' && $home->college_id ? College::find($home->college_id) : null;
        abort_if(! $college, 403, 'Your account is not assigned to a college.');

        return $college;
    }

    private function query(College $college)
    {
        return Organization::student()->where('college_id', $college->id)->withCount([
            'accountProfiles as members_count' => fn ($query) => $query->where('account_status', 'active'),
            'accountProfiles as administrators_count' => fn ($query) => $query->activeAdministrators(),
        ]);
    }

    private function roleCounts(array $organizationIds): Collection
    {
        if ($organizationIds === []) {
            return collect();
        }

        return AccountProfile::query()
            ->join('users', 'users.school_id', '=', 'account_profiles.user_school_id')
            ->whereIn('account_profiles.organization_id', $organizationIds)
            ->where('account_profiles.account_status', 'active')
            ->where('users.account_status', 'active')
            ->whereIn('account_profiles.role', ['ADMIN', 'SBO_OFFICER', 'STUDENT'])
            ->selectRaw('account_profiles.organization_id, account_profiles.role, count(*) as total')
            ->groupBy('account_profiles.organization_id', 'account_profiles.role')
            ->get()
            ->groupBy('organization_id')
            ->map(fn (Collection $rows) => $rows->pluck('total', 'role'));
    }

    private function leadership(array $organizationIds): Collection
    {
        if ($organizationIds === []) {
            return collect();
        }

        return AccountProfile::query()
            ->join('users', 'users.school_id', '=', 'account_profiles.user_school_id')
            ->whereIn('account_profiles.organization_id', $organizationIds)
            ->where('account_profiles.account_status', 'active')
            ->whereIn('account_profiles.role', ['ADMIN', 'SBO_OFFICER'])
            ->orderBy('account_profiles.role')
            ->orderBy('users.last_name')
            ->orderBy('users.first_name')
            ->get(['account_profiles.organization_id', 'account_profiles.role', 'account_profiles.position_title', 'users.first_name', 'users.last_name'])
            ->groupBy('organization_id')
            ->map(fn (Collection $rows) => $rows->map(fn ($row) => [
                'name' => trim("{$row->first_name} {$row->last_name}"),
                'role' => $row->role,
                'position_title' => $row->position_title,
            ])->values()->all());
    }

    private function row(Organization $organization, Collection $checklists, array $extra = []): array
    {
        return [
            ...$organization->only(['id', 'name', 'acronym', 'slug', 'description', 'color', 'logo_url', 'college', 'college_id', 'lifecycle_status', 'is_active', 'review_remarks', 'submitted_at', 'reviewed_at', 'archived_at']),
            'admin_payload' => $organization->admin_payload,
            'members_count' => $organization->members_count,
            'administrators_count' => $organization->administrators_count,
            'registration_requirements' => $checklists->get($organization->id),
            ...$extra,
        ];
    }

    /** One checklist per organization id: every requirement it was asked for, with the file it submitted or null. */
    private function checklists(Collection $organizationIds): Collection
    {
        if ($organizationIds->isEmpty()) {
            return collect();
        }
        $submissions = OrganizationComplianceSubmission::whereIn('organization_id', $organizationIds)->get()->groupBy('organization_id');
        [, $current] = $this->registrationRequirements();
        $types = ComplianceRequirementType::whereIn('id', $current->pluck('id')->merge($submissions->flatten(1)->pluck('requirement_type_id')))->orderBy('id')->get();

        return $organizationIds->mapWithKeys(function ($organizationId) use ($submissions, $types) {
            $byType = ($submissions->get($organizationId) ?? collect())->keyBy('requirement_type_id');

            return [$organizationId => $types->map(function (ComplianceRequirementType $type) use ($byType) {
                $sub = $byType->get($type->id);
                $row = [
                    'requirement_type_id' => $type->id,
                    'requirement_name' => $type->name,
                    'allowed_extensions' => $type->acceptedExtensions(),
                    'template_original_name' => $type->template_original_name,
                    'template_url' => $type->template_url,
                    'file_name' => $sub?->file_original_name,
                    'status' => $sub?->status ?? 'not_submitted',
                    'submission_id' => $sub?->id,
                ];
                if ($sub?->remarks) {
                    $row['remarks'] = $sub->remarks;
                }

                return $row;
            })->values()];
        });
    }

    /** The registration set is every active requirement attached to the current semester. */
    private function registrationRequirements(): array
    {
        $semester = AcademicSemester::active();
        $types = $semester
            ? ComplianceRequirementType::where('academic_semester_id', $semester->id)->where('is_active', true)->where('category', 'organization')->orderBy('id')->get()
            : collect();

        return [$semester, $types];
    }
}
