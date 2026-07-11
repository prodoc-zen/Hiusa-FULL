<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class UserController extends Controller
{
    public function index(Request $request)
    {
        $users = User::query()
            ->where('organization_id', $request->user()->organization_id)
            ->orderBy('last_name')
            ->orderBy('first_name')
            ->get();

        return response()->json($users);
    }

    public function store(Request $request)
    {
        $actor = $request->user();
        $organizationId = $request->input('organization_id', $actor->organization_id);
        $role = $request->input('role', 'STUDENT');

        $validatedData = $request->validate([
            'organization_id' => ['sometimes', 'required', 'exists:organizations,id'],
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
        ]);

        $user = User::create([
            'organization_id' => $role === 'ADMIN' ? $organizationId : ($validatedData['organization_id'] ?? $organizationId),
            'school_id' => $validatedData['school_id'],
            'first_name' => $validatedData['first_name'],
            'last_name' => $validatedData['last_name'],
            'email' => $validatedData['email'],
            'password_hash' => $validatedData['password'],
            'role' => $validatedData['role'],
            'is_member' => true,
        ]);

        return response()->json($user, 201);
    }

    public function update(Request $request, $id)
    {
        $user = User::find($id);

        if (! $user) {
            return response()->json(['message' => 'User not found.'], 404);
        }

        $validatedData = $request->validate([
            'organization_id' => 'sometimes|required|exists:organizations,id',
            'school_id' => [
                'sometimes',
                'required',
                'integer',
                'min:1',
                'max:99999999',
                Rule::unique('users', 'school_id')
                    ->ignore($user->school_id, 'school_id'),
            ],
            'first_name' => 'sometimes|required|string|max:60',
            'last_name' => 'sometimes|required|string|max:60',
            'email' => [
                'sometimes',
                'required',
                'string',
                'email',
                'max:255',
                Rule::unique('users', 'email')
                    ->where(fn ($query) => $query->where('organization_id', $request->input('organization_id', $user->organization_id)))
                    ->ignore($user->school_id, 'school_id'),
            ],
            'role' => 'sometimes|required|in:STUDENT,SBO_OFFICER,ADMIN,DEPARTMENT_HEAD',
            'password' => 'sometimes|required|string|min:8',
        ]);

        if (
            array_key_exists('role', $validatedData) &&
            $validatedData['role'] !== 'ADMIN' &&
            $user->role === 'ADMIN' &&
            User::where('role', 'ADMIN')->where('organization_id', $user->organization_id)->count() <= 1
        ) {
            return response()->json(['message' => 'Cannot change the role of the last admin account.'], 422);
        }

        if (array_key_exists('password', $validatedData)) {
            $validatedData['password_hash'] = $validatedData['password'];
            unset($validatedData['password']);
            $user->update($validatedData);
            $user->tokens()->delete();
        } else {
            $user->update($validatedData);
        }

        return response()->json($user->fresh());
    }

    public function disable($id)
    {
        $user = User::find($id);

        if (! $user) {
            return response()->json(['message' => 'User not found.'], 404);
        }

        if ($user->role === 'ADMIN') {
            return response()->json(['message' => 'Admin accounts cannot be disabled using this endpoint.'], 422);
        }

        $user->forceFill([
            'password_hash' => Str::random(40),
        ])->save();

        $user->tokens()->delete();

        return response()->json(['message' => 'User account disabled successfully.']);
    }

    public function destroy($id)
    {
        $user = User::find($id);

        if (! $user) {
            return response()->json(['message' => 'User not found.'], 404);
        }

        if ($user->role === 'ADMIN') {
            return response()->json(['message' => 'Admin accounts cannot be deleted using this endpoint.'], 422);
        }

        $user->tokens()->delete();

        try {
            $user->delete();
        } catch (\Illuminate\Database\QueryException $e) {
            return response()->json([
                'message' => 'Cannot delete this user — they have existing records (transactions, tasks, etc.) linked to their account.',
            ], 409);
        }

        return response()->json(['message' => 'User deleted successfully.']);
    }

    public function register(Request $request)
    {
        $validatedData = $request->validate([
            'organization_id' => ['required', 'exists:organizations,id'],
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
        ]);

        $user = User::create([
            'organization_id' => $validatedData['organization_id'],
            'school_id' => $validatedData['school_id'],
            'first_name' => $validatedData['first_name'],
            'last_name' => $validatedData['last_name'],
            'email' => $validatedData['email'],
            'password_hash' => $validatedData['password'],
            'role' => $validatedData['role'] ?? 'STUDENT',
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
            'organization_id' => 'required|exists:organizations,id',
            'email'     => 'required_without:school_id|nullable|email',
            'school_id' => 'required_without:email|nullable|integer|min:1|max:99999999',
            'password'  => 'required|string',
            'role'      => 'sometimes|in:STUDENT,SBO_OFFICER,ADMIN,DEPARTMENT_HEAD',
        ]);

        $user = $request->filled('email')
            ? User::where('organization_id', $request->organization_id)->where('email', $request->email)->first()
            : User::where('organization_id', $request->organization_id)->where('school_id', $request->school_id)->first();

        if (! $user || ! Hash::check($request->password, $user->password_hash)) {
            throw ValidationException::withMessages([
                'email' => ['The provided credentials are incorrect.'],
            ]);
        }

        if ($request->filled('role') && $user->role !== $request->role) {
            return response()->json(['message' => 'Role mismatch. Please select the correct role for this account.'], 403);
        }

        return response()->json([
            'user'         => $user,
            'access_token' => $user->createToken('auth_token')->plainTextToken,
            'token_type'   => 'Bearer',
        ]);
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
            'last_name'  => ['sometimes', 'required', 'string', 'max:60'],
            'email'      => [
                'sometimes',
                'required',
                'email',
                'max:255',
                Rule::unique('users', 'email')
                    ->where(fn ($query) => $query->where('organization_id', $user->organization_id))
                    ->ignore($user->school_id, 'school_id'),
            ],
        ]);

        $user->update($data);

        return response()->json($user->fresh());
    }

    public function updatePassword(Request $request)
    {
        $user = $request->user();

        $request->validate([
            'current_password' => ['required', 'string'],
            'password'         => ['required', 'string', 'min:8', 'confirmed'],
        ]);

        if (!Hash::check($request->current_password, $user->password_hash)) {
            return response()->json(['message' => 'Current password is incorrect.'], 422);
        }

        $user->update(['password_hash' => $request->password]);
        $user->tokens()->delete();

        return response()->json(['message' => 'Password updated successfully. Please log in again.']);
    }
}
