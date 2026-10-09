<?php

namespace App\Http\Controllers;

use App\Models\AcademicProgram;
use App\Models\AcademicSection;
use App\Models\AuditLog;
use App\Models\SboPosition;
use App\Models\User;
use App\Services\AccountProfileDeletionService;
use App\Services\PasswordResetService;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class UserController extends Controller
{
    private const IMPORT_LIMIT = 500;

    private const LOGIN_FAILURE_LIMIT = 5;

    private const LOGIN_FAILURE_WINDOW_SECONDS = 900;

    // Verified against when no real hash exists so every credential check costs one bcrypt comparison.
    private const DUMMY_PASSWORD_HASH = '$2y$12$cGJC6K8U4dNA3Rl2TMWQiOhoUMx0jYi9looYyezKTFEHr2imRatym';

    // Admin accounts and advisers are provisioned one at a time, never in bulk.
    private const IMPORTABLE_ROLES = ['STUDENT', 'SBO_OFFICER'];

    private const IMPORT_COLUMNS = ['school_id', 'first_name', 'last_name', 'email', 'role', 'contact_number', 'position_title', 'program', 'year_level', 'major', 'section'];

    public function __construct(private readonly PasswordResetService $passwordResetService) {}

    public function index(Request $request)
    {
        $filters = $request->validate([
            'role' => ['nullable', 'in:STUDENT,SBO_OFFICER,ADMIN,DEPARTMENT_HEAD,SUPER_ADMIN'],
            'account_status' => ['nullable', 'in:active,inactive,disabled'],
            'search' => ['nullable', 'string', 'max:100'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
            'page' => ['nullable', 'integer', 'min:1'],
            'department' => ['nullable', 'string', 'max:120'],
            'program' => ['nullable', 'string', 'max:120'],
            'year_level' => ['nullable', 'string', 'max:30'],
            'section' => ['nullable', 'string', 'max:60'],
        ]);

        $query = User::query()
            ->join('account_profiles as membership', 'membership.user_school_id', '=', 'users.school_id')
            ->where('membership.organization_id', $request->user()->organization_id)
            ->select('users.*')
            ->with(['accountProfiles' => fn ($profiles) => $profiles->where('organization_id', $request->user()->organization_id)->with('organization')])
            ->withExists(['fingerprints as fingerprint_enrolled']);

        // SBO Officers use this directory only to select Students for attendance
        // and biometric enrollment. Account administration remains Admin-only.
        if ($request->user()->role === 'SBO_OFFICER') {
            $query->where('membership.role', 'STUDENT');
        }

        if (! empty($filters['role'])) {
            $query->where('membership.role', $filters['role']);
        }

        if (! empty($filters['account_status'])) {
            $query->where('membership.account_status', $filters['account_status']);
        }

        foreach (['department', 'program', 'year_level', 'section'] as $field) {
            if (! empty($filters[$field])) {
                $query->where('users.'.$field, $filters[$field]);
            }
        }

        if (! empty($filters['search'])) {
            $search = trim($filters['search']);
            $query->where(function ($userQuery) use ($search) {
                $userQuery->where('users.first_name', 'like', "%{$search}%")
                    ->orWhere('users.last_name', 'like', "%{$search}%")
                    ->orWhere('users.email', 'like', "%{$search}%")
                    ->orWhere('users.contact_number', 'like', "%{$search}%")
                    ->orWhere('users.school_id', 'like', "%{$search}%")
                    ->orWhere('users.department', 'like', "%{$search}%")
                    ->orWhere('users.program', 'like', "%{$search}%")
                    ->orWhere('users.year_level', 'like', "%{$search}%")
                    ->orWhere('users.section', 'like', "%{$search}%")
                    ->orWhere('users.major', 'like', "%{$search}%");
            });
        }

        // Counted on the filtered-but-unordered clone so an admin dashboard can
        // show organization-wide role totals without paging through every user.
        // select() deliberately replaces users.* and the fingerprint EXISTS
        // projection; MySQL's ONLY_FULL_GROUP_BY rejects either in this grouped
        // aggregate even though SQLite permits the ambiguous query.
        $roleCounts = (clone $query)
            ->reorder()
            ->select('membership.role')
            ->selectRaw('count(*) as aggregate')
            ->groupBy('membership.role')
            ->pluck('aggregate', 'role');

        $sectionCounts = (clone $query)
            ->reorder()
            ->where('membership.role', 'STUDENT')
            ->whereNotNull('users.section')
            ->where('users.section', '!=', '')
            ->select('users.program', 'users.year_level', 'users.section')
            ->selectRaw('count(*) as total')
            ->groupBy('users.program', 'users.year_level', 'users.section')
            ->orderBy('users.program')
            ->orderBy('users.year_level')
            ->orderBy('users.section')
            ->toBase()
            ->get();

        $paginated = $query
            ->orderBy('users.last_name')
            ->orderBy('users.first_name')
            ->orderBy('users.school_id')
            ->paginate($filters['per_page'] ?? 20);

        $paginated->getCollection()->each(fn (User $user) => $user->activateProfile($user->accountProfiles->first()));

        return response()->json([
            ...$paginated->toArray(),
            'summary' => ['by_role' => $roleCounts, 'by_section' => $sectionCounts],
        ]);
    }

    public function store(Request $request)
    {
        $actor = $request->user();
        $organizationId = $actor->organization_id;

        $validatedData = $request->validate([
            ...$this->memberRules($organizationId, ['STUDENT', 'SBO_OFFICER', 'ADMIN']),
            'password' => 'required|string|min:8|confirmed',
            'account_status' => ['sometimes', 'in:active,inactive,disabled'],
            'notification_preferences' => ['nullable', 'array'],
        ]);

        if ($actor->role === 'SBO_OFFICER' && $validatedData['role'] !== 'STUDENT') {
            return response()->json(['message' => 'SBO Officers can create Student accounts only.'], 403);
        }

        if ($validatedData['role'] === 'ADMIN' && $this->isAdviserPosition($validatedData['position_title'] ?? null)) {
            return response()->json(['message' => 'Adviser accounts and Adviser assignments are managed only by the SAO Director.'], 403);
        }

        $this->assertStudentHasProgram($validatedData, AcademicProgram::where('organization_id', $organizationId)->exists());

        $validatedData = $this->normalizeAcademicPayload($validatedData, $actor);
        $validatedData = $this->normalizePositionPayload($validatedData, $actor);

        $user = User::create([
            'organization_id' => $organizationId,
            'school_id' => $validatedData['school_id'],
            'first_name' => $validatedData['first_name'],
            'last_name' => $validatedData['last_name'],
            'email' => $validatedData['email'],
            'contact_number' => $validatedData['contact_number'] ?? null,
            'password_hash' => $validatedData['password'],
            'role' => $validatedData['role'],
            'account_status' => $validatedData['account_status'] ?? 'active',
            'is_member' => true,
            'position_title' => $validatedData['position_title'] ?? null,
            'notification_preferences' => $validatedData['notification_preferences'] ?? null,
            'department' => $validatedData['department'] ?? null,
            'program' => $validatedData['program'] ?? null,
            'year_level' => $validatedData['year_level'] ?? null,
            'major' => $validatedData['major'] ?? null,
            'section' => $validatedData['section'] ?? null,
        ]);

        $this->recordUserAudit($request, 'created', $user, null, $this->auditableUserValues($user));

        return response()->json($user, 201);
    }

    /**
     * Enroll a roster from a CSV file. Every row is checked with the same rules
     * as creating one account; nothing is written unless every row passes, and
     * dry_run only reports. Imported members get a random password and set
     * their own through "Forgot password", so no password travels in a file.
     */
    public function import(Request $request)
    {
        $actor = $request->user();
        $organizationId = $actor->organization_id;
        $request->validate([
            'file' => ['required', 'file', 'mimes:csv,txt', 'max:1024'],
            'dry_run' => ['sometimes', 'boolean'],
        ]);

        $rows = $this->readImportRows($request->file('file')->getRealPath());
        if ($rows === null) {
            return response()->json(['message' => 'The first row must name the columns, including school_id, first_name, last_name, email and role.'], 422);
        }
        if ($rows === []) {
            return response()->json(['message' => 'The file has no member rows under its header.'], 422);
        }
        if (count($rows) > self::IMPORT_LIMIT) {
            return response()->json(['message' => 'Import up to '.self::IMPORT_LIMIT.' members at a time.'], 422);
        }

        $rules = $this->memberRules($organizationId, self::IMPORTABLE_ROLES);
        $programsConfigured = AcademicProgram::where('organization_id', $organizationId)->exists();
        $seenIds = [];
        $seenEmails = [];
        $results = [];
        foreach ($rows as $line => $row) {
            $validator = Validator::make($row, $rules);
            $errors = $validator->errors()->all();
            $data = null;

            $schoolId = filter_var($row['school_id'] ?? null, FILTER_VALIDATE_INT);
            $email = strtolower((string) ($row['email'] ?? ''));
            if ($schoolId !== false && isset($seenIds[$schoolId])) {
                $errors[] = "School ID {$schoolId} is also on row {$seenIds[$schoolId]}.";
            }
            if ($email !== '' && isset($seenEmails[$email])) {
                $errors[] = "The email {$email} is also on row {$seenEmails[$email]}.";
            }
            if ($schoolId !== false) {
                $seenIds[$schoolId] ??= $line;
            }
            $seenEmails[$email] ??= $line;

            if ($errors === []) {
                try {
                    $validated = $validator->validated();
                    $this->assertStudentHasProgram($validated, $programsConfigured);
                    $data = $this->normalizePositionPayload($this->normalizeAcademicPayload($validated, $actor), $actor);
                } catch (ValidationException $exception) {
                    $errors = collect($exception->errors())->flatten()->all();
                }
            }

            $results[] = [
                'row' => $line,
                'school_id' => $row['school_id'] ?? null,
                'name' => trim(($row['first_name'] ?? '').' '.($row['last_name'] ?? '')),
                'role' => $row['role'] ?? null,
                'status' => $errors === [] ? 'ready' : 'error',
                'errors' => $errors,
                'data' => $data,
            ];
        }

        $invalid = count(array_filter($results, fn (array $result) => $result['status'] === 'error'));
        $summary = ['total' => count($results), 'ready' => count($results) - $invalid, 'invalid' => $invalid];
        $report = array_map(fn (array $result) => array_diff_key($result, ['data' => true]), $results);

        if ($request->boolean('dry_run') || $invalid > 0) {
            return response()->json(['imported' => false, 'summary' => $summary, 'rows' => $report], $invalid > 0 && ! $request->boolean('dry_run') ? 422 : 200);
        }

        DB::transaction(function () use ($results, $organizationId, $request) {
            foreach ($results as $result) {
                $data = $result['data'];
                $user = User::create([
                    'organization_id' => $organizationId,
                    'school_id' => (int) $data['school_id'],
                    'first_name' => $data['first_name'],
                    'last_name' => $data['last_name'],
                    'email' => $data['email'],
                    'contact_number' => $data['contact_number'] ?? null,
                    'password_hash' => Str::password(32),
                    'role' => $data['role'],
                    'account_status' => 'active',
                    'is_member' => true,
                    'position_title' => $data['position_title'] ?? null,
                    'department' => $data['department'] ?? null,
                    'program' => $data['program'] ?? null,
                    'year_level' => $data['year_level'] ?? null,
                    'major' => $data['major'] ?? null,
                    'section' => $data['section'] ?? null,
                ]);
                $this->recordUserAudit($request, 'imported', $user, null, $this->auditableUserValues($user));
            }
        });

        return response()->json(['imported' => true, 'summary' => $summary, 'rows' => $report], 201);
    }

    /**
     * Rows keyed by their line number in the file, with headers normalized
     * ("First Name" -> first_name) and roles accepted in plain words
     * ("SBO Officer" -> SBO_OFFICER). Null when the required columns are missing.
     */
    private function readImportRows(string $path): ?array
    {
        $handle = fopen($path, 'r');
        $header = fgetcsv($handle);
        if (! is_array($header)) {
            fclose($handle);

            return null;
        }
        $header = array_map(fn ($name) => str_replace([' ', '-'], '_', strtolower(trim(preg_replace('/^\xEF\xBB\xBF/', '', (string) $name)))), $header);
        if (array_diff(['school_id', 'first_name', 'last_name', 'email', 'role'], $header) !== []) {
            fclose($handle);

            return null;
        }

        $rows = [];
        $line = 1;
        while (($values = fgetcsv($handle)) !== false) {
            $line++;
            if ($values === [null] || implode('', array_map('trim', $values)) === '') {
                continue;
            }
            $row = [];
            foreach ($header as $index => $column) {
                if (in_array($column, self::IMPORT_COLUMNS, true)) {
                    $value = trim((string) ($values[$index] ?? ''));
                    if (! mb_check_encoding($value, 'UTF-8')) {
                        $value = mb_convert_encoding($value, 'UTF-8', 'Windows-1252');
                    }
                    $row[$column] = $value === '' ? null : $value;
                }
            }
            if (isset($row['role'])) {
                $row['role'] = str_replace([' ', '-'], '_', strtoupper($row['role']));
            }
            $rows[$line] = $row;
        }
        fclose($handle);

        return $rows;
    }

    private function assertStudentHasProgram(array $data, bool $programsConfigured): void
    {
        if ($data['role'] !== 'STUDENT') {
            return;
        }

        if (! $programsConfigured) {
            throw ValidationException::withMessages([
                'program' => ['Configure a course/program before creating a student account.'],
            ]);
        }

        if (empty($data['program'])) {
            throw ValidationException::withMessages([
                'program' => ['Choose a course/program for this student.'],
            ]);
        }
    }

    private function memberRules(int $organizationId, array $roles): array
    {
        return [
            'school_id' => ['required', 'integer', 'min:1', 'max:99999999', Rule::unique('users', 'school_id')],
            'first_name' => 'required|string|max:60',
            'last_name' => 'required|string|max:60',
            'email' => [
                'required',
                'string',
                'email',
                'max:100',
                Rule::unique('users', 'email')->where(fn ($query) => $query->where('organization_id', $organizationId)),
            ],
            'contact_number' => ['nullable', 'string', 'max:30', 'regex:/^[0-9+\\-\\s()]{7,30}$/'],
            'role' => ['required', Rule::in($roles)],
            'position_title' => ['nullable', 'string', 'max:100'],
            'department' => ['nullable', 'string', 'max:120'],
            'program' => ['nullable', 'string', 'max:120'],
            'year_level' => ['nullable', 'string', 'max:30'],
            'major' => ['nullable', 'string', 'max:120'],
            'section' => ['nullable', 'string', 'max:60'],
        ];
    }

    public function update(Request $request, $id)
    {
        $organizationId = $request->user()->organization_id;
        $user = User::whereHas('accountProfiles', fn ($profiles) => $profiles->where('organization_id', $organizationId))->find($id);

        if (! $user) {
            return response()->json(['message' => 'User not found.'], 404);
        }
        $profile = $user->accountProfiles()->where('organization_id', $organizationId)->firstOrFail();
        $secondary = (int) $user->getRawOriginal('organization_id') !== (int) $organizationId;
        $user->activateProfile($profile->load('organization'));

        if ($request->user()->role === 'SBO_OFFICER' && $user->role !== 'STUDENT') {
            return response()->json(['message' => 'SBO Officers can manage Student accounts only.'], 403);
        }

        if ($user->role === 'SUPER_ADMIN') {
            return response()->json(['message' => 'The super admin account cannot be changed from user management.'], 403);
        }

        if ($user->role === 'DEPARTMENT_HEAD') {
            return response()->json(['message' => 'Department Head accounts are managed only by the SAO Director.'], 403);
        }

        $oldValues = $this->auditableUserValues($user);

        $validatedData = $request->validate([
            'first_name' => 'sometimes|required|string|max:60',
            'last_name' => 'sometimes|required|string|max:60',
            'email' => [
                'sometimes',
                'required',
                'string',
                'email',
                'max:100',
                Rule::unique('users', 'email')
                    ->where(fn ($query) => $query->where('organization_id', $user->organization_id))
                    ->ignore($user->school_id, 'school_id'),
            ],
            'role' => 'sometimes|required|in:STUDENT,SBO_OFFICER,ADMIN',
            'contact_number' => ['nullable', 'string', 'max:30', 'regex:/^[0-9+\\-\\s()]{7,30}$/'],
            'account_status' => ['sometimes', 'required', 'in:active,inactive,disabled'],
            'position_title' => ['nullable', 'string', 'max:100'],
            'notification_preferences' => ['nullable', 'array'],
            'department' => ['nullable', 'string', 'max:120'],
            'program' => ['nullable', 'string', 'max:120'],
            'year_level' => ['nullable', 'string', 'max:30'],
            'major' => ['nullable', 'string', 'max:120'],
            'section' => ['nullable', 'string', 'max:60'],
            'password' => 'sometimes|required|string|min:8',
        ]);

        if ($request->user()->role === 'SBO_OFFICER' && ($validatedData['role'] ?? 'STUDENT') !== 'STUDENT') {
            return response()->json(['message' => 'SBO Officers cannot assign or promote users to another role.'], 403);
        }

        if ($user->role === 'ADMIN') {
            if ($this->isAdviserPosition($user->position_title) || (array_key_exists('position_title', $validatedData) && $this->isAdviserPosition($validatedData['position_title']))) {
                return response()->json(['message' => 'Adviser accounts and Adviser assignments are managed only by the SAO Director.'], 403);
            }

            if (isset($validatedData['role']) && $validatedData['role'] !== 'ADMIN') {
                return response()->json(['message' => 'Only the SAO Director can change an administrator role.'], 403);
            }

            if (isset($validatedData['account_status']) && $validatedData['account_status'] !== $user->account_status) {
                return response()->json(['message' => 'Only the SAO Director can change an administrator account status.'], 403);
            }

            if (array_key_exists('password', $validatedData)) {
                return response()->json(['message' => 'Only the SAO Director can reset another administrator account.'], 403);
            }
        }

        if (($validatedData['role'] ?? $user->role) === 'ADMIN'
            && $this->isAdviserPosition($validatedData['position_title'] ?? $user->position_title)) {
            return response()->json(['message' => 'Adviser accounts and Adviser assignments are managed only by the SAO Director.'], 403);
        }

        if (
            array_key_exists('role', $validatedData) &&
            $validatedData['role'] !== 'ADMIN' &&
            $user->role === 'ADMIN' &&
            $user->account_status === 'active' &&
            User::where('role', 'ADMIN')->where('account_status', 'active')->where('organization_id', $user->organization_id)->count() <= 1
        ) {
            return response()->json(['message' => 'Cannot change the role of the last admin account.'], 422);
        }

        if (
            ($validatedData['account_status'] ?? 'active') !== 'active' &&
            $user->role === 'ADMIN' &&
            User::where('role', 'ADMIN')->where('account_status', 'active')->where('organization_id', $user->organization_id)->count() <= 1
        ) {
            return response()->json(['message' => 'Cannot deactivate the last active admin account.'], 422);
        }

        $validatedData = $this->normalizeAcademicPayload($validatedData, $request->user(), $user);
        $validatedData = $this->normalizePositionPayload($validatedData, $request->user(), $user);

        if ($secondary) {
            if (array_key_exists('password', $validatedData) || ($validatedData['role'] ?? null) === 'ADMIN') {
                return response()->json(['message' => 'Only the primary organization can manage this account password or assign an Admin role.'], 403);
            }
            $validatedData = $this->normalizeUserPayload($validatedData, $user);
            $membershipData = array_intersect_key($validatedData, array_flip(['role', 'account_status', 'position_title']));
            $identityData = array_diff_key($validatedData, $membershipData);
            DB::transaction(function () use ($user, $profile, $identityData, $membershipData) {
                if ($identityData) {
                    $user->update($identityData);
                }
                if ($membershipData) {
                    $profile->update($membershipData);
                }
                if (($membershipData['account_status'] ?? 'active') !== 'active') {
                    $user->tokens()->where('account_profile_id', $profile->id)->delete();
                }
            });
            $freshUser = $user->fresh();
            $freshUser->activateProfile($profile->fresh()->load('organization'));
            $this->recordUserAudit($request, 'updated', $freshUser, $oldValues, $this->auditableUserValues($freshUser));

            return response()->json($freshUser);
        }

        if (array_key_exists('password', $validatedData)) {
            $validatedData['password_hash'] = $validatedData['password'];
            unset($validatedData['password']);
            $user->update($this->normalizeUserPayload($validatedData, $user));
            $user->tokens()->delete();
        } else {
            $user->update($this->normalizeUserPayload($validatedData, $user));
        }

        if (array_key_exists('account_status', $validatedData) && $validatedData['account_status'] !== 'active') {
            $user->tokens()->delete();
        }

        $freshUser = $user->fresh();
        $this->recordUserAudit($request, 'updated', $freshUser, $oldValues, $this->auditableUserValues($freshUser));

        return response()->json($freshUser);
    }

    public function disable(Request $request, $id)
    {
        $user = User::whereHas('accountProfiles', fn ($profiles) => $profiles->where('organization_id', $request->user()->organization_id))->find($id);

        if (! $user) {
            return response()->json(['message' => 'User not found.'], 404);
        }
        $profile = $user->accountProfiles()->where('organization_id', $request->user()->organization_id)->firstOrFail();
        $secondary = (int) $user->getRawOriginal('organization_id') !== (int) $profile->organization_id;
        $user->activateProfile($profile->load('organization'));

        if ($request->user()->role === 'SBO_OFFICER' && $user->role !== 'STUDENT') {
            return response()->json(['message' => 'SBO Officers can manage Student accounts only.'], 403);
        }

        if ($user->role === 'SUPER_ADMIN') {
            return response()->json(['message' => 'The super admin account cannot be deactivated.'], 403);
        }

        if ($user->role === 'ADMIN') {
            return response()->json(['message' => 'Administrator accounts are managed only from SAO Administration.'], 403);
        }

        if ($user->role === 'DEPARTMENT_HEAD' || $profile->role === 'DEPARTMENT_HEAD') {
            return response()->json(['message' => 'Department Head accounts are managed only by the SAO Director.'], 403);
        }

        if ($user->school_id === $request->user()->school_id) {
            return response()->json(['message' => 'You cannot deactivate your own account.'], 422);
        }

        if (
            $user->role === 'ADMIN' &&
            User::where('role', 'ADMIN')->where('account_status', 'active')->where('organization_id', $user->organization_id)->count() <= 1
        ) {
            return response()->json(['message' => 'Cannot deactivate the last active admin account.'], 422);
        }

        $oldValues = $this->auditableUserValues($user);

        if ($secondary) {
            $profile->update(['account_status' => 'disabled']);
            $user->tokens()->where('account_profile_id', $profile->id)->delete();
        } else {
            $user->forceFill(['account_status' => 'disabled'])->save();
            $user->tokens()->delete();
        }

        $freshUser = $user->fresh();
        $freshUser->activateProfile($profile->fresh()->load('organization'));
        $this->recordUserAudit($request, 'deactivated', $freshUser, $oldValues, $this->auditableUserValues($freshUser));

        return response()->json(['message' => 'User account disabled successfully.']);
    }

    public function reactivate(Request $request, $id)
    {
        $user = User::whereHas('accountProfiles', fn ($profiles) => $profiles->where('organization_id', $request->user()->organization_id))->find($id);

        if (! $user) {
            return response()->json(['message' => 'User not found.'], 404);
        }
        $profile = $user->accountProfiles()->where('organization_id', $request->user()->organization_id)->firstOrFail();
        $secondary = (int) $user->getRawOriginal('organization_id') !== (int) $profile->organization_id;
        $user->activateProfile($profile->load('organization'));

        if ($request->user()->role === 'SBO_OFFICER' && $user->role !== 'STUDENT') {
            return response()->json(['message' => 'SBO Officers can manage Student accounts only.'], 403);
        }

        if ($user->role === 'SUPER_ADMIN') {
            return response()->json(['message' => 'The super admin account cannot be changed from user management.'], 403);
        }

        if ($user->role === 'ADMIN') {
            return response()->json(['message' => 'Administrator accounts are managed only from SAO Administration.'], 403);
        }

        if ($user->role === 'DEPARTMENT_HEAD' || $profile->role === 'DEPARTMENT_HEAD') {
            return response()->json(['message' => 'Department Head accounts are managed only by the SAO Director.'], 403);
        }

        if ($user->account_status === 'active') {
            return response()->json(['message' => 'User account is already active.'], 422);
        }

        $oldValues = $this->auditableUserValues($user);

        if ($secondary) {
            $profile->update(['account_status' => 'active']);
        } else {
            $user->forceFill(['account_status' => 'active'])->save();
        }

        $freshUser = $user->fresh();
        $freshUser->activateProfile($profile->fresh()->load('organization'));
        $this->recordUserAudit($request, 'reactivated', $freshUser, $oldValues, $this->auditableUserValues($freshUser));

        return response()->json($freshUser);
    }

    public function destroy(Request $request, $id)
    {
        $organizationId = $request->user()->organization_id;
        $user = User::whereHas('accountProfiles', fn ($profiles) => $profiles->where('organization_id', $organizationId))->find($id);

        if (! $user) {
            return response()->json(['message' => 'User not found.'], 404);
        }

        $profile = $user->accountProfiles()->where('organization_id', $organizationId)->firstOrFail();
        if ($request->user()->school_id === $user->school_id) {
            return response()->json(['message' => 'You cannot delete your own account.'], 403);
        }

        if ($request->user()->role === 'SBO_OFFICER' && $profile->role !== 'STUDENT') {
            return response()->json(['message' => 'SBO Officers can manage Student accounts only.'], 403);
        }

        if ($profile->role === 'SUPER_ADMIN') {
            return response()->json(['message' => 'The super admin account cannot be deleted.'], 403);
        }

        if ($profile->role === 'ADMIN') {
            return response()->json(['message' => 'Administrator accounts are managed only from SAO Administration.'], 403);
        }

        if ($user->role === 'DEPARTMENT_HEAD' || $profile->role === 'DEPARTMENT_HEAD') {
            return response()->json(['message' => 'Department Head accounts are managed only by the SAO Director.'], 403);
        }

        $oldValues = $this->auditableUserValues($user);

        $result = app(AccountProfileDeletionService::class)->remove($request->user(), $profile);

        $this->recordUserAudit($request, 'deleted', $user, $oldValues, []);

        return response()->json(['message' => 'Organization profile removed successfully.', ...$result]);
    }

    public function register(Request $request)
    {
        $validatedData = $request->validate([
            'organization_id' => ['required', Rule::exists('organizations', 'id')->where('is_active', true)->where('organization_type', 'STUDENT_ORGANIZATION')],
            'school_id' => [
                'required',
                'integer',
                'min:1',
                'max:99999999',
                Rule::unique('users', 'school_id'),
            ],
            'first_name' => 'required|string|max:60',
            'last_name' => 'required|string|max:60',
            'email' => [
                'required',
                'string',
                'email',
                'max:100',
                Rule::unique('users', 'email')->where(fn ($query) => $query->where('organization_id', $request->organization_id)),
            ],
            'password' => 'required|string|min:8|confirmed',
            'contact_number' => ['nullable', 'string', 'max:30', 'regex:/^[0-9+\\-\\s()]{7,30}$/'],
            'role' => 'sometimes|in:STUDENT',
            'notification_preferences' => ['nullable', 'array'],
            'department' => ['nullable', 'string', 'max:120'],
            'program' => ['nullable', 'string', 'max:120'],
            'year_level' => ['nullable', 'string', 'max:30'],
        ]);

        $user = User::create([
            'organization_id' => $validatedData['organization_id'],
            'school_id' => $validatedData['school_id'],
            'first_name' => $validatedData['first_name'],
            'last_name' => $validatedData['last_name'],
            'email' => $validatedData['email'],
            'contact_number' => $validatedData['contact_number'] ?? null,
            'password_hash' => $validatedData['password'],
            'role' => $validatedData['role'] ?? 'STUDENT',
            'account_status' => 'active',
            'is_member' => true,
            'notification_preferences' => $validatedData['notification_preferences'] ?? null,
        ]);

        return response()->json([
            'user' => $user,
            'access_token' => $this->issueProfileToken($user),
            'token_type' => 'Bearer',
        ], 201);
    }

    public function login(Request $request)
    {
        $request->validate([
            'school_id' => ['required', 'integer', 'min:1', 'max:99999999'],
            'password' => 'required|string',
        ]);

        $failureKey = 'login-failures:'.$request->school_id;

        if (RateLimiter::tooManyAttempts($failureKey, self::LOGIN_FAILURE_LIMIT)) {
            return response()->json([
                'message' => 'Too many failed sign in attempts for this account. Please wait before trying again.',
            ], 429, ['Retry-After' => RateLimiter::availableIn($failureKey)]);
        }

        $user = User::where('school_id', $request->school_id)->first();

        $passwordMatches = Hash::check($request->password, $user?->password_hash ?? self::DUMMY_PASSWORD_HASH);

        if (! $user || ! $passwordMatches) {
            RateLimiter::hit($failureKey, self::LOGIN_FAILURE_WINDOW_SECONDS);

            throw ValidationException::withMessages([
                'school_id' => ['The provided credentials are incorrect.'],
            ]);
        }

        RateLimiter::clear($failureKey);

        $organization = $user->organization()->first(['id', 'is_active', 'lifecycle_status']);

        if (! $organization?->is_active) {
            return response()->json([
                'message' => match ($organization?->lifecycle_status) {
                    'archived' => 'Your organization has been archived by the Student Affairs Office and is read only. Contact the Student Affairs Office to restore it.',
                    'pending' => 'Your organization is still waiting for approval by the Student Affairs Office.',
                    'returned' => 'Your organization registration was returned by the Student Affairs Office. Contact your Department Head.',
                    default => 'This organization is not active. Contact the Student Affairs Office.',
                },
                'organization_status' => $organization?->lifecycle_status,
            ], 403);
        }

        if ($user->account_status !== 'active') {
            return response()->json([
                'message' => 'This account is not active. Please contact an administrator.',
                'account_status' => $user->account_status,
            ], 403);
        }

        return response()->json([
            'user' => $user,
            'access_token' => $this->issueProfileToken($user),
            'token_type' => 'Bearer',
        ]);
    }

    private function issueProfileToken(User $user): string
    {
        $token = $user->createToken('auth_token');
        $profileId = $user->accountProfiles()->where('organization_id', $user->getRawOriginal('organization_id'))->value('id');
        $token->accessToken->forceFill(['account_profile_id' => $profileId])->save();

        return $token->plainTextToken;
    }

    public function requestPasswordReset(Request $request)
    {
        $validated = $request->validate([
            'school_id' => ['nullable', 'required_without:organization_id', 'integer', 'min:1', 'max:99999999'],
            'organization_id' => ['nullable', 'required_without:school_id', 'integer', 'min:1'],
            'email' => ['required', 'email'],
        ]);

        $user = User::query()
            ->when(isset($validated['school_id']), fn ($query) => $query->where('school_id', $validated['school_id']))
            ->when(isset($validated['organization_id']), fn ($query) => $query->where('organization_id', $validated['organization_id']))
            ->where('email', $validated['email'])
            ->first();

        // Non-enumerating: an unknown email, a disabled account, and an active
        // account all return the identical body, so an unauthenticated caller
        // cannot use this endpoint to discover which emails have accounts or an
        // account's status. Mail is only actually sent for an active account, and
        // the branches that send nothing still pay for one hash so response time
        // does not tell the two apart. An inactive or nonexistent organization is
        // treated exactly like an unknown user.
        if (! $user || $user->account_status !== 'active' || ! $user->organization()->where('is_active', true)->exists()) {
            Hash::make(Str::random(64));

            return response()->json(['message' => 'If an active account matches those details, password reset instructions will be sent.']);
        }

        $this->passwordResetService->issue($user);

        return response()->json(['message' => 'If an active account matches those details, password reset instructions will be sent.']);
    }

    public function validatePasswordResetToken(Request $request)
    {
        $validated = $request->validate([
            'organization_id' => ['required', 'integer', 'min:1'],
            'email' => ['required', 'email'],
            'token' => ['required', 'string'],
        ]);

        $user = $this->activeOrganizationUser((int) $validated['organization_id'], $validated['email']);
        $tokenValid = $this->validPasswordResetToken((int) $validated['organization_id'], $validated['email'], $validated['token']);

        if (! $user || ! $tokenValid) {
            return response()->json(['message' => 'Password reset token is invalid or expired.'], 422);
        }

        return response()->json(['message' => 'Password reset token is valid.']);
    }

    public function resetPassword(Request $request)
    {
        $validated = $request->validate([
            'organization_id' => ['required', 'integer', 'min:1'],
            'email' => ['required', 'email'],
            'token' => ['required', 'string'],
            'password' => ['required', 'string', 'min:8', 'confirmed'],
        ]);

        $user = $this->activeOrganizationUser((int) $validated['organization_id'], $validated['email']);
        $tokenValid = $this->validPasswordResetToken((int) $validated['organization_id'], $validated['email'], $validated['token']);

        if (! $user || ! $tokenValid) {
            return response()->json(['message' => 'Password reset token is invalid or expired.'], 422);
        }

        if ($user->account_status !== 'active') {
            return response()->json([
                'message' => 'This account is not active. Please contact an administrator.',
                'account_status' => $user->account_status,
            ], 403);
        }

        $user->update(['password_hash' => $validated['password']]);
        $user->tokens()->delete();

        DB::table('password_reset_tokens')
            ->where('organization_id', $validated['organization_id'])
            ->where('email', $validated['email'])
            ->delete();

        return response()->json(['message' => 'Password updated successfully. Please log in with your new password.']);
    }

    public function logout(Request $request)
    {
        $request->user()->currentAccessToken()->delete();

        return response()->json([
            'message' => 'Successfully logged out',
        ]);
    }

    public function updateProfile(Request $request)
    {
        $user = $request->user();

        $data = $request->validate([
            'first_name' => ['sometimes', 'required', 'string', 'max:60'],
            'last_name' => ['sometimes', 'required', 'string', 'max:60'],
            'contact_number' => ['nullable', 'string', 'max:30', 'regex:/^[0-9+\\-\\s()]{7,30}$/'],
            'email' => [
                'sometimes',
                'required',
                'email',
                'max:100',
                Rule::unique('users', 'email')
                    ->where(fn ($query) => $query->where('organization_id', $user->organization_id))
                    ->ignore($user->school_id, 'school_id'),
            ],
            'notification_preferences' => ['nullable', 'array'],
        ]);

        $user->update($data);

        return response()->json($user->fresh());
    }

    public function updatePassword(Request $request)
    {
        $user = $request->user();

        $request->validate([
            'current_password' => ['required', 'string'],
            'password' => ['required', 'string', 'min:8', 'confirmed'],
        ]);

        if (! Hash::check($request->current_password, $user->password_hash)) {
            return response()->json(['message' => 'Current password is incorrect.'], 422);
        }

        $user->update(['password_hash' => $request->password]);
        $user->tokens()->delete();

        return response()->json(['message' => 'Password updated successfully. Please log in again.']);
    }

    private function activeOrganizationUser(int $organizationId, string $email): ?User
    {
        return User::where('organization_id', $organizationId)
            ->where('email', $email)
            ->whereHas('organization', fn ($query) => $query->where('is_active', true))
            ->first();
    }

    private function validPasswordResetToken(int $organizationId, string $email, string $token): bool
    {
        $record = DB::table('password_reset_tokens')
            ->where('organization_id', $organizationId)
            ->where('email', $email)
            ->first();

        $tokenMatches = Hash::check($token, $record->token ?? self::DUMMY_PASSWORD_HASH);

        if (! $record || ! $tokenMatches) {
            return false;
        }

        return Carbon::parse($record->created_at)->addMinutes(config('auth.passwords.users.expire', 60))->isFuture();
    }

    private function auditableUserValues(User $user): array
    {
        return [
            'school_id' => $user->school_id,
            'first_name' => $user->first_name,
            'last_name' => $user->last_name,
            'email' => $user->email,
            'contact_number' => $user->contact_number,
            'role' => $user->role,
            'position_title' => $user->position_title,
            'department' => $user->department,
            'program' => $user->program,
            'year_level' => $user->year_level,
            'major' => $user->major,
            'section' => $user->section,
            'account_status' => $user->account_status,
        ];
    }

    private function normalizeUserPayload(array $data, User $user): array
    {
        $role = $data['role'] ?? $user->role;

        if (! in_array($role, ['ADMIN', 'SBO_OFFICER'], true)) {
            $data['position_title'] = null;
        }

        return $data;
    }

    private function normalizePositionPayload(array $data, User $actor, ?User $existingUser = null): array
    {
        $role = $data['role'] ?? $existingUser?->role;
        $positionWasSubmitted = array_key_exists('position_title', $data);
        $positionTitle = $positionWasSubmitted ? trim((string) ($data['position_title'] ?? '')) : null;

        if (! in_array($role, ['ADMIN', 'SBO_OFFICER'], true)) {
            if ($positionWasSubmitted && $positionTitle !== '') {
                throw ValidationException::withMessages([
                    'position_title' => ['Only Admin and SBO Officer accounts can be assigned an organization position.'],
                ]);
            }

            $data['position_title'] = null;

            return $data;
        }

        if ($existingUser && array_key_exists('role', $data) && $role !== $existingUser->role && ! $positionWasSubmitted) {
            $data['position_title'] = null;

            return $data;
        }

        if (! $positionWasSubmitted) {
            return $data;
        }

        if ($positionTitle === '') {
            $data['position_title'] = null;

            return $data;
        }

        $validPosition = SboPosition::where('organization_id', $actor->organization_id)
            ->where('role', $role)
            ->where('title', $positionTitle)
            ->where('is_active', true)
            ->exists();

        if (! $validPosition) {
            throw ValidationException::withMessages([
                'position_title' => ['Choose an active position configured for the selected account role.'],
            ]);
        }

        $data['position_title'] = $positionTitle;

        return $data;
    }

    private function isAdviserPosition(mixed $title): bool
    {
        return in_array(strtolower(trim((string) $title)), ['adviser', 'advisor', 'organization adviser', 'organization advisor'], true);
    }

    private function normalizeAcademicPayload(array $data, User $actor, ?User $existingUser = null): array
    {
        $organization = $actor->organization;
        $department = $organization?->college ?: 'College of Computer Studies';
        $program = $data['program'] ?? $existingUser?->program;
        $yearLevel = $data['year_level'] ?? $existingUser?->year_level;
        $section = $data['section'] ?? $existingUser?->section;

        $data['department'] = $department;

        if (
            $existingUser &&
            $program === $existingUser->program &&
            $yearLevel === $existingUser->year_level &&
            $section === $existingUser->section
        ) {
            return $data;
        }

        if ($program === null || $program === '') {
            if (! empty($section)) {
                throw ValidationException::withMessages(['section' => ['Choose a course/program before selecting a section.']]);
            }

            return $data;
        }

        $configuredProgram = AcademicProgram::where('organization_id', $actor->organization_id)
            ->where('name', $program)
            ->first();

        if (! $configuredProgram) {
            throw ValidationException::withMessages(['program' => ['Choose a course/program configured for this organization.']]);
        }

        if ($section && ! $yearLevel) {
            throw ValidationException::withMessages(['year_level' => ['Choose a year level before selecting a section.']]);
        }

        if ($section) {
            $yearNumber = preg_match('/^(\d+)(?:st|nd|rd|th) Year$/', (string) $yearLevel, $matches)
                ? (int) $matches[1]
                : null;
            $validSection = $yearNumber && AcademicSection::where('academic_program_id', $configuredProgram->id)
                ->where('year_level', $yearNumber)
                ->where('name', $section)
                ->exists();
            if (! $validSection) {
                throw ValidationException::withMessages(['section' => ['Choose a section that matches the selected program and year level.']]);
            }
        }

        return $data;
    }

    private function recordUserAudit(Request $request, string $action, User $user, ?array $oldValues, array $newValues): void
    {
        AuditLog::create([
            'organization_id' => $request->user()?->organization_id,
            'user_id' => $request->user()?->school_id,
            'module' => 'users',
            'action' => $action,
            'record_type' => User::class,
            'record_id' => $user->school_id,
            'old_values' => $oldValues,
            'new_values' => $newValues,
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);
    }
}
