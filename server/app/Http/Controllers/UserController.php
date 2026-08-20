<?php

namespace App\Http\Controllers;

use App\Mail\PasswordResetMail;
use App\Models\AuditLog;
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
        ]);

        $query = User::query()
            ->where('organization_id', $request->user()->organization_id)
            ->orderBy('last_name')
            ->orderBy('first_name');

        if (! empty($filters['role'])) {
            $query->where('role', $filters['role']);
        }

        if (! empty($filters['account_status'])) {
            $query->where('account_status', $filters['account_status']);
        }

        if (! empty($filters['search'])) {
            $search = trim($filters['search']);
            $query->where(function ($userQuery) use ($search) {
                $userQuery->where('first_name', 'like', "%{$search}%")
                    ->orWhere('last_name', 'like', "%{$search}%")
                    ->orWhere('email', 'like', "%{$search}%")
                    ->orWhere('school_id', 'like', "%{$search}%");
            });
        }

        return response()->json($query->get());
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
            'role' => 'required|in:STUDENT,SBO_OFFICER,ADMIN,DEPARTMENT_HEAD',
            'account_status' => ['sometimes', 'in:active,inactive,disabled'],
            'position_title' => ['nullable', 'string', 'max:100'],
            'notification_preferences' => ['nullable', 'array'],
        ]);

        $user = User::create([
            'organization_id' => $organizationId,
            'school_id' => $validatedData['school_id'],
            'first_name' => $validatedData['first_name'],
            'last_name' => $validatedData['last_name'],
            'email' => $validatedData['email'],
            'password_hash' => $validatedData['password'],
            'role' => $validatedData['role'],
            'account_status' => $validatedData['account_status'] ?? 'active',
            'is_member' => true,
            'position_title' => $validatedData['role'] === 'SBO_OFFICER' ? ($validatedData['position_title'] ?? null) : null,
            'notification_preferences' => $validatedData['notification_preferences'] ?? null,
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
            'account_status' => ['sometimes', 'required', 'in:active,inactive,disabled'],
            'position_title' => ['nullable', 'string', 'max:100'],
            'notification_preferences' => ['nullable', 'array'],
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

        $user->tokens()->delete();

        try {
            $user->delete();
        } catch (QueryException $e) {
            return response()->json([
                'message' => 'Cannot delete this user - they have existing records (transactions, tasks, etc.) linked to their account.',
            ], 409);
        }

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
            'role' => 'sometimes|in:STUDENT',
            'notification_preferences' => ['nullable', 'array'],
        ]);

        $user = User::create([
            'organization_id' => $validatedData['organization_id'],
            'school_id' => $validatedData['school_id'],
            'first_name' => $validatedData['first_name'],
            'last_name' => $validatedData['last_name'],
            'email' => $validatedData['email'],
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
            'role' => $user->role,
            'position_title' => $user->position_title,
            'account_status' => $user->account_status,
        ];
    }

    private function normalizeUserPayload(array $data, User $user): array
    {
        $role = $data['role'] ?? $user->role;

        if ($role !== 'SBO_OFFICER') {
            $data['position_title'] = null;
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
