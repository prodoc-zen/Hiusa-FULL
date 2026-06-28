<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class UserController extends Controller
{
    public function index()
    {
        $users = User::orderBy('last_name')->orderBy('first_name')->get();
        return response()->json($users);
    }

    public function update(Request $request, $id)
    {
        $user = User::find($id);

        if (! $user) {
            return response()->json(['message' => 'User not found.'], 404);
        }

        $validatedData = $request->validate([
            'school_id' => 'sometimes|required|string|max:50|unique:users,school_id,' . $user->id,
            'first_name' => 'sometimes|required|string|max:100',
            'last_name' => 'sometimes|required|string|max:100',
            'email' => 'sometimes|required|string|email|max:150|unique:users,email,' . $user->id,
            'role' => 'sometimes|required|in:student,officer,admin,adviser',
            'password' => 'sometimes|required|string|min:8',
        ]);

        if (
            array_key_exists('role', $validatedData) &&
            $validatedData['role'] !== 'admin' &&
            $user->role === 'admin' &&
            User::where('role', 'admin')->count() <= 1
        ) {
            return response()->json(['message' => 'Cannot change the role of the last admin account.'], 422);
        }

        if (array_key_exists('password', $validatedData)) {
            $validatedData['password_hash'] = $validatedData['password'];
            unset($validatedData['password']);
        }

        $user->update($validatedData);

        return response()->json($user->fresh());
    }

    public function disable($id)
    {
        $user = User::find($id);

        if (! $user) {
            return response()->json(['message' => 'User not found.'], 404);
        }

        if ($user->role === 'admin') {
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

        if ($user->role === 'admin') {
            return response()->json(['message' => 'Admin accounts cannot be deleted using this endpoint.'], 422);
        }

        $user->tokens()->delete();
        $user->delete();

        return response()->json(['message' => 'User deleted successfully.']);
    }

    public function register(Request $request)
    {
        $validatedData = $request->validate([
            'school_id' => 'required|string|max:50|unique:users',
            'first_name' => 'required|string|max:100',
            'last_name' => 'required|string|max:100',
            'email' => 'required|string|email|max:150|unique:users',
            'password' => 'required|string|min:8|confirmed',
            'role' => 'sometimes|in:student,officer,admin,adviser',
        ]);

        $user = User::create([
            'school_id' => $validatedData['school_id'],
            'first_name' => $validatedData['first_name'],
            'last_name' => $validatedData['last_name'],
            'email' => $validatedData['email'],
            'password_hash' => $validatedData['password'],
            'role' => $validatedData['role'] ?? 'student',
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
            'email'     => 'required_without:school_id|nullable|email',
            'school_id' => 'required_without:email|nullable|string',
            'password'  => 'required|string',
            'role'      => 'sometimes|in:student,officer,admin,adviser',
        ]);

        $user = $request->filled('email')
            ? User::where('email', $request->email)->first()
            : User::where('school_id', $request->school_id)->first();

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
            'first_name' => ['sometimes', 'required', 'string', 'max:100'],
            'last_name'  => ['sometimes', 'required', 'string', 'max:100'],
            'email'      => ['sometimes', 'required', 'email', 'max:150', 'unique:users,email,' . $user->id],
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

        return response()->json(['message' => 'Password updated successfully.']);
    }
}
