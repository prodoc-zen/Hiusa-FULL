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
use App\Services\SubmissionStoragePolicy;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * A Department Head registers the student organizations of their own college.
 * The college always comes from the head's account, never from input. A new
 * organization stays pending and inactive until the SAO approves it, and the
 * registration documents are the same compliance submissions the SAO reviews
 * for renewal, stored on the private local disk.
 */
class CollegeOrganizationController extends Controller
{
    private const PENDING_LIMIT = 10;

    /** Tables whose rows a registration legitimately owns, so they never count as activity. */
    private const REGISTRATION_TABLES = ['audit_logs', 'organization_compliance_submissions'];

    private const ORGANIZATION_COLUMNS = ['organization_id', 'parent_organization_id', 'source_organization_id'];

    private const NO_REQUIREMENTS = 'Registration is closed. SAO must activate a semester and publish its requirements with sample formats.';

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

    public function storeStaff(Request $request)
    {
        $college = $this->college($request->user());
        $home = Organization::where('college_id', $college->id)->where('organization_type', 'COLLEGE')->firstOrFail();

        $data = $request->validate([
            'school_id' => ['required', 'integer', 'min:1', 'max:99999999'],
            'first_name' => ['required', 'string', 'max:60'],
            'last_name' => ['required', 'string', 'max:60'],
            'email' => ['required', 'string', 'email', 'max:100'],
            'position_title' => ['required', 'string', 'max:100'],
            'role' => ['nullable', 'in:ADMIN,DEPARTMENT_HEAD'],
        ]);

        $role = $data['role'] ?? 'ADMIN';

        $staff = DB::transaction(function () use ($request, $data, $home, $college, $role) {
            $existing = User::whereKey($data['school_id'])->orWhere('email', $data['email'])->first();

            if ($existing) {
                if ($existing->school_id !== (int) $data['school_id'] || strtolower($existing->email) !== strtolower($data['email'])) {
                    throw ValidationException::withMessages([
                        'school_id' => ['The school ID or email belongs to another registered account.'],
                    ]);
                }

                if ($existing->accountProfiles()->where('organization_id', $home->id)->exists()) {
                    throw ValidationException::withMessages([
                        'school_id' => ['This user is already an assigned staff member of this college office.'],
                    ]);
                }

                $profile = $existing->accountProfiles()->create([
                    'organization_id' => $home->id,
                    'role' => $role,
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
                    'new_values' => ['user_school_id' => $existing->school_id, 'position_title' => $data['position_title'], 'role' => $role],
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
                    'role' => $role,
                    'position_title' => $data['position_title'],
                    'account_status' => 'active',
                    'is_lead_head' => false,
                ];
            }

            $password = 'Demo@12345';
            $user = User::create([
                'organization_id' => $home->id,
                'school_id' => (int) $data['school_id'],
                'first_name' => $data['first_name'],
                'last_name' => $data['last_name'],
                'email' => $data['email'],
                'role' => $role,
                'position_title' => $data['position_title'],
                'account_status' => 'active',
                'must_change_password' => false,
                'password_hash' => bcrypt($password),
                'department' => $college->name,
                'is_member' => true,
            ]);

            AuditLog::create([
                'organization_id' => $home->id,
                'user_id' => $request->user()->school_id,
                'actor_role' => $request->user()->role,
                'module' => 'users',
                'action' => 'college_staff_created',
                'record_type' => User::class,
                'record_id' => $user->school_id,
                'new_values' => ['school_id' => $user->school_id, 'position_title' => $data['position_title'], 'role' => $role],
                'description' => "Created college staff account for {$user->first_name} {$user->last_name} ({$data['position_title']}).",
                'ip_address' => $request->ip(),
                'created_at' => now(),
            ]);

            return [
                'school_id' => $user->school_id,
                'name' => trim("{$user->first_name} {$user->last_name}"),
                'first_name' => $user->first_name,
                'last_name' => $user->last_name,
                'email' => $user->email,
                'role' => $role,
                'position_title' => $data['position_title'],
                'account_status' => 'active',
                'is_lead_head' => false,
                'temporary_password' => $password,
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

    public function requirements(Request $request)
    {
        $this->college($request->user());
        [$semester, $types] = $this->registrationRequirements();

        return response()->json([
            'academic_semester' => $semester ? ['id' => $semester->id, 'number' => $semester->number, 'academic_year' => $semester->academicYear->label] : null,
            'requirements' => $types->map(fn (ComplianceRequirementType $type) => [...$type->only(['id', 'name', 'description', 'deadline_at', 'template_original_name', 'template_url']), 'allowed_extensions' => $type->acceptedExtensions()])->values(),
        ]);
    }

    public function store(Request $request, SubmissionStoragePolicy $storagePolicy)
    {
        $user = $request->user();
        $college = $this->college($user);
        [$semester, $types] = $this->registrationRequirements();
        if (! $semester || $types->isEmpty()) {
            return response()->json(['message' => self::NO_REQUIREMENTS], 422);
        }

        $data = $request->validate([
            'name' => ['required', 'string', 'max:255', Rule::unique('organizations', 'name')],
            'acronym' => ['required', 'string', 'max:50', Rule::unique('organizations', 'acronym')],
            'description' => ['nullable', 'string', 'max:3000'],
            'color' => ['nullable', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'admin_school_id' => ['nullable', 'integer', 'min:1'],
            'admin_first_name' => ['nullable', 'string', 'max:100'],
            'admin_last_name' => ['nullable', 'string', 'max:100'],
            'admin_email' => ['nullable', 'email', 'max:255'],
            'admin_position_title' => ['nullable', 'string', 'max:100'],
            'files' => ['required', 'array'],
            ...$types->mapWithKeys(fn (ComplianceRequirementType $type) => ["files.{$type->id}" => ['required', ...$type->uploadRules()]])->all(),
        ]);
        $slug = $this->slugFor($data['name']);
        $storagePolicy->assertUpload(array_values($request->file('files', [])), field: 'files');

        $adminPayload = ! empty($data['admin_school_id']) && ! empty($data['admin_first_name']) && ! empty($data['admin_last_name']) && ! empty($data['admin_email']) ? [
            'school_id' => (int) $data['admin_school_id'],
            'first_name' => trim($data['admin_first_name']),
            'last_name' => trim($data['admin_last_name']),
            'email' => strtolower(trim($data['admin_email'])),
            'position_title' => trim($data['admin_position_title'] ?? 'President') ?: 'President',
        ] : null;

        $stored = [];
        try {
            $organization = DB::transaction(function () use ($request, $user, $college, $types, $data, $slug, $adminPayload, &$stored) {
                College::whereKey($college->id)->lockForUpdate()->first();
                if (Organization::student()->where('college_id', $college->id)->where('lifecycle_status', 'pending')->count() >= self::PENDING_LIMIT) {
                    throw ValidationException::withMessages(['name' => ['Too many registrations are waiting for SAO review. Wait for a decision before registering more.']]);
                }

                $organization = Organization::create([
                    'name' => $data['name'],
                    'slug' => $slug,
                    'acronym' => $data['acronym'],
                    'description' => $data['description'] ?? null,
                    'color' => $data['color'] ?? null,
                    'admin_payload' => $adminPayload,
                    'organization_type' => 'STUDENT_ORGANIZATION',
                    'college_id' => $college->id,
                    'college' => $college->name,
                    'lifecycle_status' => 'pending',
                    'is_active' => false,
                    'submitted_by' => $user->school_id,
                    'submitted_at' => now(),
                ]);
                foreach ($types as $type) {
                    $file = $request->file("files.{$type->id}");
                    $stored[] = $path = $file->store('compliance-submissions/'.$organization->id, 'local');
                    abort_unless($path, 500, 'Could not save the required document. Try again.');
                    OrganizationComplianceSubmission::create([
                        'organization_id' => $organization->id,
                        'requirement_type_id' => $type->id,
                        'is_registration_document' => true,
                        ...$this->fileAttributes($path, $file, $user),
                    ]);
                }
                $this->audit($request, 'organization_registration_submitted', $organization, ['name' => $organization->name, 'college_id' => $college->id], 'A Department Head submitted a new organization for registration.');

                return $organization;
            });
        } catch (\Throwable $error) {
            Storage::disk('local')->delete($stored);
            throw $error;
        }

        $this->notifyDirectors($organization, 'New organization registration', "{$college->name} submitted {$organization->name} for registration.");

        return response()->json($this->present($college, $organization->id), 201);
    }

    public function update(Request $request, string $organization, SubmissionStoragePolicy $storagePolicy)
    {
        $user = $request->user();
        $college = $this->college($user);
        $organization = $this->registrationOf($college, $organization);
        if ($organization->lifecycle_status !== 'returned') {
            return response()->json(['message' => 'Only a returned registration can be edited.'], 409);
        }

        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255', Rule::unique('organizations', 'name')->ignore($organization->id)],
            'acronym' => ['sometimes', 'required', 'string', 'max:50', Rule::unique('organizations', 'acronym')->ignore($organization->id)],
            'description' => ['nullable', 'string', 'max:3000'],
            'color' => ['nullable', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'files' => ['sometimes', 'array:'.OrganizationComplianceSubmission::where('organization_id', $organization->id)->pluck('requirement_type_id')->implode(',')],
            ...ComplianceRequirementType::whereIn('id', OrganizationComplianceSubmission::where('organization_id', $organization->id)->pluck('requirement_type_id'))
                ->get()->mapWithKeys(fn (ComplianceRequirementType $type) => ["files.{$type->id}" => $type->uploadRules()])->all(),
        ]);
        $changes = Arr::only($data, ['name', 'acronym', 'description', 'color']);
        $replacing = $request->file('files', []);
        $replacedBytes = OrganizationComplianceSubmission::where('organization_id', $organization->id)->whereIn('requirement_type_id', array_keys($replacing))->sum('file_size');
        $storagePolicy->assertUpload(array_values($replacing), $organization->id, (int) $replacedBytes, 'files');
        if (isset($changes['name'])) {
            $changes['slug'] = $this->slugFor($changes['name'], $organization->id);
        }

        $stored = [];
        $replaced = [];
        try {
            $conflict = DB::transaction(function () use ($request, $user, $organization, $changes, $data, &$stored, &$replaced) {
                $locked = Organization::whereKey($organization->id)->lockForUpdate()->first();
                if (! $locked || $locked->lifecycle_status !== 'returned') {
                    return true;
                }
                foreach ($data['files'] ?? [] as $typeId => $file) {
                    $submission = OrganizationComplianceSubmission::where('organization_id', $organization->id)->where('requirement_type_id', $typeId)->firstOrFail();
                    $replaced[] = $submission->file_path;
                    $stored[] = $path = $file->store('compliance-submissions/'.$organization->id, 'local');
                    abort_unless($path, 500, 'Could not save the replacement document. Try again.');
                    $submission->update($this->fileAttributes($path, $file, $user));
                }
                $locked->update([
                    ...$changes,
                    'lifecycle_status' => 'pending',
                    'review_remarks' => null,
                    'submitted_by' => $user->school_id,
                    'submitted_at' => now(),
                    'reviewed_by' => null,
                    'reviewed_at' => null,
                ]);
                $this->audit($request, 'organization_registration_resubmitted', $locked, ['changes' => array_keys($changes), 'replaced_files' => count($replaced)], 'A Department Head resubmitted a returned organization registration.');

                return false;
            });
        } catch (\Throwable $error) {
            Storage::disk('local')->delete($stored);
            throw $error;
        }
        if ($conflict) {
            return response()->json(['message' => 'Only a returned registration can be edited.'], 409);
        }
        Storage::disk('local')->delete($replaced);

        $this->notifyDirectors($organization, 'Organization registration resubmitted', "{$college->name} resubmitted ".($changes['name'] ?? $organization->name).' for registration.');

        return response()->json($this->present($college, $organization->id));
    }

    public function destroy(Request $request, string $organization)
    {
        $user = $request->user();
        $college = $this->college($user);
        $organization = $this->registrationOf($college, $organization);

        $paths = [];
        $result = DB::transaction(function () use ($request, $organization, $college, &$paths) {
            $locked = Organization::whereKey($organization->id)->lockForUpdate()->first();
            if (! $locked || ! in_array($locked->lifecycle_status, ['pending', 'returned'], true)) {
                return 'not_withdrawable';
            }
            if ($this->hasRecords($locked)) {
                return 'has_records';
            }

            $paths = OrganizationComplianceSubmission::where('organization_id', $locked->id)->pluck('file_path')->filter()->all();
            $this->audit($request, 'organization_registration_withdrawn', $locked, ['name' => $locked->name, 'lifecycle_status' => $locked->lifecycle_status, 'college_id' => $college->id], 'A Department Head withdrew an organization registration.', $request->user()->organization_id);
            $locked->delete();

            return $locked;
        });

        if ($result === 'not_withdrawable') {
            return response()->json(['message' => 'Only a pending or returned registration can be withdrawn. Ask the SAO to archive an active organization.'], 409);
        }
        if ($result === 'has_records') {
            return response()->json(['message' => 'This organization already has members, users or other records, so it cannot be withdrawn.'], 409);
        }
        Storage::disk('local')->delete($paths);

        if ($result->lifecycle_status === 'pending') {
            $this->notifyDirectors($result, 'Organization registration withdrawn', "{$college->name} withdrew {$result->name} before review.", false);
        }

        return response()->json(['message' => 'Registration withdrawn.']);
    }

    /** A wrong college and a missing id answer alike, so a Department Head cannot probe other colleges. */
    private function registrationOf(College $college, string $id): Organization
    {
        $organization = ctype_digit($id)
            ? Organization::where('organization_type', 'STUDENT_ORGANIZATION')->where('college_id', $college->id)->find($id)
            : null;
        abort_unless($organization, 404, 'Organization not found.');

        return $organization;
    }

    private function college(User $user): College
    {
        $home = Organization::whereKey($user->organization_id)->first(['id', 'organization_type', 'college_id']);
        $college = $home && $home->organization_type === 'COLLEGE' && $home->college_id ? College::find($home->college_id) : null;
        abort_if(! $college, 403, 'Your account is not assigned to a college.');

        return $college;
    }

    /** True when anything outside the registration itself points at the organization: accounts, events, money, elections and the rest. */
    private function hasRecords(Organization $organization): bool
    {
        foreach (Schema::getTables(Schema::getCurrentSchemaListing()) as $table) {
            if (in_array($table['name'], self::REGISTRATION_TABLES, true)) {
                continue;
            }
            foreach (array_intersect(self::ORGANIZATION_COLUMNS, Schema::getColumnListing($table['name'])) as $column) {
                if (DB::table($table['name'])->where($column, $organization->id)->exists()) {
                    return true;
                }
            }
        }

        return false;
    }

    private function query(College $college)
    {
        return Organization::student()->where('college_id', $college->id)->withCount([
            'accountProfiles as members_count' => fn ($query) => $query->where('account_status', 'active'),
            'accountProfiles as administrators_count' => fn ($query) => $query->activeAdministrators(),
        ]);
    }

    private function present(College $college, int $organizationId): array
    {
        $organization = $this->query($college)->findOrFail($organizationId);

        return $this->row($organization, $this->checklists(collect([$organization->id])));
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

    private function fileAttributes(string $path, $file, User $user): array
    {
        return [
            'status' => 'submitted',
            'file_path' => $path,
            'file_original_name' => $file->getClientOriginalName(),
            'mime_type' => $file->getClientMimeType(),
            'file_size' => $file->getSize(),
            'remarks' => null,
            'submitted_by' => $user->school_id,
            'submitted_at' => now(),
            'reviewed_by' => null,
            'reviewed_at' => null,
        ];
    }

    private function slugFor(string $name, ?int $ignoreId = null): string
    {
        $slug = Str::slug($name);
        if (Organization::where('slug', $slug)->when($ignoreId, fn ($query) => $query->whereKeyNot($ignoreId))->exists()) {
            throw ValidationException::withMessages(['name' => ['An organization with a similar name already exists.']]);
        }

        return $slug;
    }

    private function notifyDirectors(Organization $organization, string $title, string $message, bool $linked = true): void
    {
        User::where('role', 'SUPER_ADMIN')->where('account_status', 'active')->get(['school_id', 'organization_id'])
            ->each(fn (User $sao) => Notification::create([
                'organization_id' => $sao->organization_id,
                'user_id' => $sao->school_id,
                'notification_type' => 'general',
                'title' => $title,
                'message' => $message,
                'reference_type' => $linked ? 'organization' : null,
                'reference_id' => $linked ? $organization->id : null,
                'is_read' => false,
                'sent_at' => now(),
            ]));
    }

    private function audit(Request $request, string $action, Organization $organization, array $values, string $description, ?int $scopeOrganizationId = null): void
    {
        AuditLog::create(['organization_id' => $scopeOrganizationId ?? $organization->id, 'user_id' => $request->user()->school_id, 'actor_role' => $request->user()->role, 'module' => 'organizations', 'action' => $action, 'description' => $description, 'record_type' => Organization::class, 'record_id' => $organization->id, 'new_values' => $values, 'ip_address' => $request->ip(), 'created_at' => now()]);
    }
}
