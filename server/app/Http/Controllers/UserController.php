<?php

namespace App\Http\Controllers;

use App\Mail\PasswordResetMail;
use App\Models\AcademicProgram;
use App\Models\AcademicSection;
use App\Models\AuditLog;
use App\Models\SboPosition;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class UserController extends Controller
{
    public function index(Request $request)
    {
        $filters = $request->validate([
            'role' => ['nullable', 'in:STUDENT,SBO_OFFICER,ADMIN,DEPARTMENT_HEAD'],
            'account_status' => ['nullable', 'in:active,inactive,disabled'],
            'search' => ['nullable', 'string', 'max:100'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
            'page' => ['nullable', 'integer', 'min:1'],
            'department' => ['nullable', 'string', 'max:120'],
            'program' => ['nullable', 'string', 'max:120'],
            'year_level' => ['nullable', 'in:1st Year,2nd Year,3rd Year,4th Year'],
            'section' => ['nullable', 'string', 'max:60'],
        ]);

        $query = User::query()
            ->where('organization_id', $request->user()->organization_id);

        if (! empty($filters['role'])) {
            $query->where('role', $filters['role']);
        }

        if (! empty($filters['account_status'])) {
            $query->where('account_status', $filters['account_status']);
        }

        foreach (['department', 'program', 'year_level', 'section'] as $field) {
            if (! empty($filters[$field])) {
                $query->where($field, $filters[$field]);
            }
        }

        if (! empty($filters['search'])) {
            $search = trim($filters['search']);
            $query->where(function ($userQuery) use ($search) {
                $userQuery->where('first_name', 'like', "%{$search}%")
                    ->orWhere('last_name', 'like', "%{$search}%")
                    ->orWhere('email', 'like', "%{$search}%")
                    ->orWhere('contact_number', 'like', "%{$search}%")
                    ->orWhere('school_id', 'like', "%{$search}%")
                    ->orWhere('department', 'like', "%{$search}%")
                    ->orWhere('program', 'like', "%{$search}%")
                    ->orWhere('year_level', 'like', "%{$search}%")
                    ->orWhere('section', 'like', "%{$search}%")
                    ->orWhere('major', 'like', "%{$search}%");
            });
        }

        // Counted on the filtered-but-unordered clone so an admin dashboard can
        // show organization-wide role totals without paging through every user.
        $roleCounts = (clone $query)
            ->selectRaw('role, count(*) as aggregate')
            ->groupBy('role')
            ->pluck('aggregate', 'role');

        $paginated = $query
            ->orderBy('last_name')
            ->orderBy('first_name')
            ->paginate($filters['per_page'] ?? 20);

        return response()->json([
            ...$paginated->toArray(),
            'summary' => ['by_role' => $roleCounts],
        ]);
    }

    public function store(Request $request)
    {
        $actor = $request->user();
        $organizationId = $actor->organization_id;

        $validatedData = $request->validate([
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
                'max:255',
                Rule::unique('users', 'email')
                    ->where(fn ($query) => $query->where('organization_id', $organizationId)),
            ],
            'password' => 'required|string|min:8|confirmed',
            'contact_number' => ['nullable', 'string', 'max:30', 'regex:/^[0-9+\\-\\s()]{7,30}$/'],
            'role' => 'required|in:STUDENT,SBO_OFFICER,ADMIN,DEPARTMENT_HEAD',
            'account_status' => ['sometimes', 'in:active,inactive,disabled'],
            'position_title' => ['nullable', 'string', 'max:100'],
            'notification_preferences' => ['nullable', 'array'],
            'department' => ['nullable', 'string', 'max:120'],
            'program' => ['nullable', 'string', 'max:120'],
            'year_level' => ['nullable', 'string', 'max:30'],
            'major' => ['nullable', 'string', 'max:120'],
            'section' => ['nullable', 'string', 'max:60'],
        ]);

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

    public function update(Request $request, $id)
    {
        $user = User::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $user) {
            return response()->json(['message' => 'User not found.'], 404);
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
                'max:255',
                Rule::unique('users', 'email')
                    ->where(fn ($query) => $query->where('organization_id', $user->organization_id))
                    ->ignore($user->school_id, 'school_id'),
            ],
            'role' => 'sometimes|required|in:STUDENT,SBO_OFFICER,ADMIN,DEPARTMENT_HEAD',
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
        $user = User::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $user) {
            return response()->json(['message' => 'User not found.'], 404);
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

        $user->forceFill([
            'account_status' => 'disabled',
        ])->save();

        $user->tokens()->delete();

        $freshUser = $user->fresh();
        $this->recordUserAudit($request, 'deactivated', $freshUser, $oldValues, $this->auditableUserValues($freshUser));

        return response()->json(['message' => 'User account disabled successfully.']);
    }

    public function reactivate(Request $request, $id)
    {
        $user = User::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $user) {
            return response()->json(['message' => 'User not found.'], 404);
        }

        if ($user->account_status === 'active') {
            return response()->json(['message' => 'User account is already active.'], 422);
        }

        $oldValues = $this->auditableUserValues($user);

        $user->forceFill([
            'account_status' => 'active',
        ])->save();

        $freshUser = $user->fresh();
        $this->recordUserAudit($request, 'reactivated', $freshUser, $oldValues, $this->auditableUserValues($freshUser));

        return response()->json($freshUser);
    }

    public function destroy(Request $request, $id)
    {
        $user = User::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $user) {
            return response()->json(['message' => 'User not found.'], 404);
        }

        if ($user->role === 'ADMIN') {
            return response()->json(['message' => 'Admin accounts cannot be deleted using this endpoint.'], 422);
        }

        $oldValues = $this->auditableUserValues($user);
        $user->tokens()->delete();

        try {
            $user->delete();
        } catch (QueryException $e) {
            return response()->json([
                'message' => 'Cannot delete this user - they have existing records (transactions, tasks, etc.) linked to their account.',
            ], 409);
        }

        $this->recordUserAudit($request, 'deleted', $user, $oldValues, []);

        return response()->json(['message' => 'User deleted successfully.']);
    }

    public function register(Request $request)
    {
        $validatedData = $request->validate([
            'organization_id' => ['required', Rule::exists('organizations', 'id')->where('is_active', true)],
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
                'max:255',
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
            'access_token' => $user->createToken('auth_token')->plainTextToken,
            'token_type' => 'Bearer',
        ], 201);
    }

    public function login(Request $request)
    {
        $request->validate([
            'organization_id' => ['required', Rule::exists('organizations', 'id')->where('is_active', true)],
            'school_id' => 'required|integer|min:1|max:99999999',
            'password' => 'required|string',
        ]);

        $user = User::where('organization_id', $request->organization_id)
            ->where('school_id', $request->school_id)
            ->first();

        if (! $user || ! Hash::check($request->password, $user->password_hash)) {
            throw ValidationException::withMessages([
                'school_id' => ['The provided credentials are incorrect.'],
            ]);
        }

        if ($user->account_status !== 'active') {
            return response()->json([
                'message' => 'This account is not active. Please contact an administrator.',
                'account_status' => $user->account_status,
            ], 403);
        }

        return response()->json([
            'user' => $user,
            'access_token' => $user->createToken('auth_token')->plainTextToken,
            'token_type' => 'Bearer',
        ]);
    }

    public function requestPasswordReset(Request $request)
    {
        $validated = $request->validate([
            'organization_id' => ['required', Rule::exists('organizations', 'id')->where('is_active', true)],
            'email' => ['required', 'email'],
        ]);

        $user = User::where('organization_id', $validated['organization_id'])
            ->where('email', $validated['email'])
            ->first();

        if (! $user) {
            return response()->json(['message' => 'If an active account matches those details, password reset instructions will be sent.']);
        }

        if ($user->account_status !== 'active') {
            return response()->json([
                'message' => 'This account is not active. Please contact an administrator.',
                'account_status' => $user->account_status,
            ], 403);
        }

        $token = Str::random(64);

        DB::table('password_reset_tokens')->updateOrInsert(
            [
                'organization_id' => $user->organization_id,
                'email' => $user->email,
            ],
            [
                'token' => Hash::make($token),
                'created_at' => now(),
            ]
        );

        $resetUrl = $this->passwordResetUrl($user->organization_id, $user->email, $token);
        $expiresInMinutes = (int) config('auth.passwords.users.expire', 60);

        Mail::to($user->email)->send(new PasswordResetMail($user, $resetUrl, $expiresInMinutes));

        return response()->json(['message' => 'Password reset instructions sent.']);
    }

    public function validatePasswordResetToken(Request $request)
    {
        $validated = $request->validate([
            'organization_id' => ['required', Rule::exists('organizations', 'id')->where('is_active', true)],
            'email' => ['required', 'email'],
            'token' => ['required', 'string'],
        ]);

        $user = User::where('organization_id', $validated['organization_id'])
            ->where('email', $validated['email'])
            ->first();

        if (! $user || ! $this->validPasswordResetToken((int) $validated['organization_id'], $validated['email'], $validated['token'])) {
            return response()->json(['message' => 'Password reset token is invalid or expired.'], 422);
        }

        return response()->json(['message' => 'Password reset token is valid.']);
    }

    public function resetPassword(Request $request)
    {
        $validated = $request->validate([
            'organization_id' => ['required', Rule::exists('organizations', 'id')->where('is_active', true)],
            'email' => ['required', 'email'],
            'token' => ['required', 'string'],
            'password' => ['required', 'string', 'min:8', 'confirmed'],
        ]);

        $user = User::where('organization_id', $validated['organization_id'])
            ->where('email', $validated['email'])
            ->first();

        if (! $user || ! $this->validPasswordResetToken((int) $validated['organization_id'], $validated['email'], $validated['token'])) {
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
            'email' => [
                'sometimes',
                'required',
                'email',
                'max:255',
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

    private function validPasswordResetToken(int $organizationId, string $email, string $token): bool
    {
        $record = DB::table('password_reset_tokens')
            ->where('organization_id', $organizationId)
            ->where('email', $email)
            ->first();

        if (! $record || ! Hash::check($token, $record->token)) {
            return false;
        }

        return Carbon::parse($record->created_at)->addMinutes(config('auth.passwords.users.expire', 60))->isFuture();
    }

    private function passwordResetUrl(int $organizationId, string $email, string $token): string
    {
        $frontendUrl = rtrim((string) env('FRONTEND_URL', 'http://localhost:5173'), '/');

        return $frontendUrl.'/reset-password?'.http_build_query([
            'organization_id' => $organizationId,
            'email' => $email,
            'token' => $token,
        ]);
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
            $yearNumber = match ($yearLevel) {
                '1st Year' => 1,
                '2nd Year' => 2,
                '3rd Year' => 3,
                '4th Year' => 4,
                default => null,
            };
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
