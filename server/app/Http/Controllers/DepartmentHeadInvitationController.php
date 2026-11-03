<?php

namespace App\Http\Controllers;

use App\Mail\DeanInvitationMail;
use App\Models\AccountProfile;
use App\Models\AuditLog;
use App\Models\College;
use App\Models\DepartmentHeadInvitation;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class DepartmentHeadInvitationController extends Controller
{
    private const ACTIVE_HEAD_EXISTS = 'This college already has an active Department Head. Deactivate the current one first.';

    private function collegeHome(College $college): ?Organization
    {
        return Organization::where('organization_type', 'COLLEGE')->where('college_id', $college->id)->first();
    }

    private function collegeHasActiveHead(int $homeOrganizationId): bool
    {
        return User::where('role', 'DEPARTMENT_HEAD')
            ->where('account_status', 'active')
            ->where(function ($query) use ($homeOrganizationId) {
                $query->where('organization_id', $homeOrganizationId)
                    ->orWhereHas('accountProfiles', fn ($profiles) => $profiles->where('organization_id', $homeOrganizationId)->where('account_status', 'active')->where('role', 'DEPARTMENT_HEAD'));
            })
            ->exists();
    }

    public function invite(Request $request, College $college): JsonResponse
    {
        $home = $this->collegeHome($college);
        if (! $home) {
            return response()->json(['message' => 'College organization home not found.'], 404);
        }

        if ($this->collegeHasActiveHead($home->id)) {
            return response()->json(['message' => self::ACTIVE_HEAD_EXISTS], 409);
        }

        $data = $request->validate([
            'first_name' => ['required', 'string', 'max:60'],
            'last_name' => ['required', 'string', 'max:60'],
            'email' => ['required', 'email', 'max:100', 'unique:users,email'],
            'school_id' => ['nullable', 'integer', 'min:1', 'max:99999999', 'unique:users,school_id'],
        ]);

        $plainToken = Str::random(64);
        $tokenHash = hash('sha256', $plainToken);

        $invitation = DB::transaction(function () use ($college, $data, $plainToken, $tokenHash, $request, $home) {
            // Cancel any previous pending invitations for this college
            DepartmentHeadInvitation::where('college_id', $college->id)->whereNull('accepted_at')->delete();

            $invitation = DepartmentHeadInvitation::create([
                'college_id' => $college->id,
                'first_name' => trim($data['first_name']),
                'last_name' => trim($data['last_name']),
                'email' => strtolower(trim($data['email'])),
                'school_id' => ! empty($data['school_id']) ? (int) $data['school_id'] : null,
                'token_hash' => $tokenHash,
                'invited_by' => $request->user()->school_id,
                'expires_at' => now()->addHours(48),
            ]);

            AuditLog::create([
                'organization_id' => $home->id,
                'user_id' => $request->user()->school_id,
                'actor_role' => $request->user()->role,
                'module' => 'users',
                'action' => 'department_head_invited',
                'record_type' => DepartmentHeadInvitation::class,
                'record_id' => $invitation->id,
                'new_values' => [
                    'college_id' => $college->id,
                    'first_name' => $invitation->first_name,
                    'last_name' => $invitation->last_name,
                    'email' => $invitation->email,
                    'school_id' => $invitation->school_id,
                ],
                'description' => "SAO generated an invitation magic link for Department Head of {$college->name}.",
                'ip_address' => $request->ip(),
                'created_at' => now(),
            ]);

            return $invitation;
        });

        $frontendUrl = rtrim((string) config('app.frontend_url', 'http://localhost:5173'), '/');
        $magicLink = $frontendUrl . '/accept-invitation?token=' . $plainToken;

        try {
            Mail::to($invitation->email)->send(new DeanInvitationMail(
                $invitation->first_name,
                $invitation->last_name,
                $college->name,
                $magicLink,
                48
            ));
        } catch (\Throwable $e) {
            Log::warning("Could not dispatch Dean invitation email: " . $e->getMessage());
        }

        return response()->json([
            'message' => "Invitation created for {$invitation->first_name} {$invitation->last_name}.",
            'invitation' => $invitation->load('college:id,name,code'),
            'magic_link' => $magicLink,
        ], 201);
    }

    public function show(string $token): JsonResponse
    {
        $tokenHash = hash('sha256', $token);
        $invitation = DepartmentHeadInvitation::where('token_hash', $tokenHash)->with('college:id,name,code')->first();

        if (! $invitation) {
            return response()->json(['message' => 'This invitation link is invalid or has expired.'], 404);
        }

        if ($invitation->isAccepted()) {
            return response()->json(['message' => 'This invitation has already been accepted. Please sign in with your credentials.'], 410);
        }

        if ($invitation->isExpired()) {
            return response()->json(['message' => 'This invitation link has expired. Please ask the Student Affairs Office to generate a new invitation.'], 410);
        }

        return response()->json([
            'invitation' => [
                'id' => $invitation->id,
                'first_name' => $invitation->first_name,
                'last_name' => $invitation->last_name,
                'email' => $invitation->email,
                'school_id' => $invitation->school_id,
            ],
            'college' => $invitation->college,
        ]);
    }

    public function accept(Request $request, string $token): JsonResponse
    {
        $tokenHash = hash('sha256', $token);
        $invitation = DepartmentHeadInvitation::where('token_hash', $tokenHash)->with('college')->first();

        if (! $invitation) {
            return response()->json(['message' => 'This invitation link is invalid or has expired.'], 404);
        }

        if ($invitation->isAccepted()) {
            return response()->json(['message' => 'This invitation has already been accepted.'], 410);
        }

        if ($invitation->isExpired()) {
            return response()->json(['message' => 'This invitation link has expired. Please request a new invitation.'], 410);
        }

        $home = $this->collegeHome($invitation->college);
        if (! $home) {
            return response()->json(['message' => 'College organization home not found.'], 404);
        }

        if ($this->collegeHasActiveHead($home->id)) {
            return response()->json(['message' => self::ACTIVE_HEAD_EXISTS], 409);
        }

        $rules = [
            'password' => ['required', 'string', 'min:8', 'confirmed'],
        ];

        if (empty($invitation->school_id)) {
            $rules['school_id'] = ['required', 'integer', 'min:1', 'max:99999999', 'unique:users,school_id'];
        }

        $validated = $request->validate($rules);

        $schoolId = $invitation->school_id ?? (int) $validated['school_id'];

        $user = DB::transaction(function () use ($invitation, $home, $schoolId, $validated, $request) {
            $user = User::create([
                'school_id' => $schoolId,
                'organization_id' => $home->id,
                'first_name' => $invitation->first_name,
                'last_name' => $invitation->last_name,
                'email' => $invitation->email,
                'password_hash' => Hash::make($validated['password']),
                'role' => 'DEPARTMENT_HEAD',
                'account_status' => 'active',
                'is_member' => true,
                'department' => $invitation->college->name,
                'must_change_password' => false,
            ]);

            AccountProfile::firstOrCreate(
                ['user_school_id' => $user->school_id, 'organization_id' => $home->id],
                ['role' => 'DEPARTMENT_HEAD', 'account_status' => 'active']
            );

            $invitation->update([
                'accepted_at' => now(),
                'school_id' => $schoolId,
            ]);

            AuditLog::create([
                'organization_id' => $home->id,
                'user_id' => $user->school_id,
                'actor_role' => 'DEPARTMENT_HEAD',
                'module' => 'users',
                'action' => 'department_head_invitation_accepted',
                'record_type' => User::class,
                'record_id' => $user->school_id,
                'new_values' => ['school_id' => $user->school_id, 'college_id' => $invitation->college_id],
                'description' => "Department Head invitation accepted by {$user->first_name} {$user->last_name}.",
                'ip_address' => $request->ip(),
                'created_at' => now(),
            ]);

            return $user;
        });

        $sanctumToken = $user->createToken('auth_token');

        return response()->json([
            'message' => 'Account setup complete. Welcome to HIUSA!',
            'token' => $sanctumToken->plainTextToken,
            'user' => $user->load('organization:id,name,acronym,organization_type'),
        ], 200);
    }
}

