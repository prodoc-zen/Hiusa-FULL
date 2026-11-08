<?php

namespace App\Http\Controllers;

use App\Mail\DeanInvitationMail;
use App\Models\AccountProfile;
use App\Models\AuditLog;
use App\Models\College;
use App\Models\DepartmentHeadInvitation;
use App\Models\Organization;
use App\Models\StudentRegistryEntry;
use App\Models\User;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Account links for the people who run a college: one Department Head per college
 * and any number of office staff. A plain link carries no identity: the person types their
 * own name, email and password. A link made from an employee record in the school records
 * carries that record's number and name instead, and the person only sets email and password,
 * so nobody types a school ID and nobody can change one.
 */
class DepartmentHeadInvitationController extends Controller
{
    private const ACTIVE_HEAD_EXISTS = 'This college already has an active Department Head. Deactivate the current one first.';

    private const STAFF = 'COLLEGE_STAFF';

    private const HEAD = 'DEPARTMENT_HEAD';

    private const INTERNAL_ID_START = 95000000;

    private const MAX_ID = 99999999;

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
        if (! $home || ! $college->is_active) {
            return response()->json(['message' => 'This college cannot take an invitation right now.'], 404);
        }

        if ($this->collegeHasActiveHead($home->id)) {
            return response()->json(['message' => self::ACTIVE_HEAD_EXISTS], 409);
        }

        $data = $request->validate(['email' => ['nullable', 'email', 'max:100']]);

        [$invitation, $magicLink] = DB::transaction(function () use ($college, $request, $home) {
            DepartmentHeadInvitation::where('college_id', $college->id)->where('role', self::HEAD)->whereNull('accepted_at')->delete();

            return $this->createInvitation($request, $college, $home, self::HEAD, null, 'department_head_invited', "SAO created an invitation link for the Department Head of {$college->name}.");
        });

        $emailed = $this->sendLink($data['email'] ?? null, $college, 'Department Head', $magicLink);

        return response()->json([
            'message' => 'The link is ready.',
            'invitation' => $invitation->load('college:id,name,code'),
            'magic_link' => $magicLink,
            'emailed' => $emailed,
        ], 201);
    }

    public function inviteStaff(Request $request): JsonResponse
    {
        $home = Organization::whereKey($request->user()->organization_id)->first();
        $college = $home && $home->organization_type === 'COLLEGE' && $home->college_id ? College::find($home->college_id) : null;
        abort_if(! $college || ! $college->is_active, 403, 'Your account is not assigned to a college.');

        $data = $request->validate([
            'registry_school_id' => ['nullable', 'integer', 'min:1'],
            'position_title' => ['required_without:registry_school_id', 'nullable', 'string', 'max:100'],
            'email' => ['nullable', 'email', 'max:100'],
        ]);

        [$invitation, $magicLink] = DB::transaction(function () use ($request, $college, $home, $data) {
            $record = null;
            if (! empty($data['registry_school_id'])) {
                $record = $this->availableEmployeeRecord($college, (int) $data['registry_school_id'], lock: true);
                DepartmentHeadInvitation::where('registry_school_id', $record->school_id)->whereNull('accepted_at')->delete();
            }

            return $this->createInvitation(
                $request,
                $college,
                $home,
                self::STAFF,
                $record?->position ?: (isset($data['position_title']) ? trim($data['position_title']) : null),
                'college_staff_invited',
                "Created an office staff invitation link for {$college->name}.",
                $record?->school_id,
            );
        });

        $emailed = $this->sendLink($data['email'] ?? null, $college, 'office staff', $magicLink);

        return response()->json([
            'message' => 'The link is ready.',
            'invitation' => $invitation->load('college:id,name,code'),
            'magic_link' => $magicLink,
            'emailed' => $emailed,
        ], 201);
    }

    public function show(string $token): JsonResponse
    {
        $invitation = $this->find($token);

        if (! $invitation) {
            return response()->json(['message' => 'This link is not valid.'], 404);
        }

        if ($invitation->isAccepted()) {
            return response()->json(['message' => 'This link was already used. Sign in instead.'], 410);
        }

        if ($invitation->isExpired() || ! $invitation->college?->is_active) {
            return response()->json(['message' => 'This link has expired. Ask for a new one.'], 410);
        }

        $inviter = $invitation->inviter;

        $record = $invitation->registry_school_id ? StudentRegistryEntry::employees()->where('school_id', $invitation->registry_school_id)->first() : null;

        return response()->json([
            'invitation' => [
                'role' => $invitation->role,
                'position_title' => $invitation->position_title,
                'expires_at' => $invitation->expires_at,
                // The name only: the page says who invited you, and the link holder gets no email or ID.
                'inviter' => $inviter ? ['name' => trim("{$inviter->first_name} {$inviter->last_name}")] : null,
                'record' => $record ? [
                    'school_id' => $record->school_id,
                    'first_name' => $record->first_name,
                    'last_name' => $record->last_name,
                ] : null,
            ],
            'college' => $invitation->college->only(['id', 'name', 'code']),
        ]);
    }

    public function accept(Request $request, string $token): JsonResponse
    {
        $invitation = $this->find($token);

        if (! $invitation) {
            return response()->json(['message' => 'This link is not valid.'], 404);
        }

        if ($invitation->isAccepted()) {
            return response()->json(['message' => 'This link was already used. Sign in instead.'], 410);
        }

        if ($invitation->isExpired() || ! $invitation->college?->is_active) {
            return response()->json(['message' => 'This link has expired. Ask for a new one.'], 410);
        }

        $request->merge(['email' => is_string($request->input('email')) ? Str::lower(trim($request->input('email'))) : $request->input('email')]);
        $fromRecord = $invitation->registry_school_id !== null;
        $validated = $request->validate([
            'first_name' => [$fromRecord ? 'prohibited' : 'required', 'string', 'max:60'],
            'last_name' => [$fromRecord ? 'prohibited' : 'required', 'string', 'max:60'],
            'email' => ['required', 'email', 'max:100', 'unique:users,email'],
            'school_id' => [$fromRecord ? 'prohibited' : 'nullable', 'integer', 'min:1', 'max:'.(self::INTERNAL_ID_START - 1), 'unique:users,school_id'],
            'password' => ['required', 'string', 'min:8', 'confirmed'],
        ]);

        $user = null;
        for ($attempt = 1; $attempt <= 3; $attempt++) {
            try {
                $user = DB::transaction(fn () => $this->createAccount($request, $invitation->id, $validated));
                break;
            } catch (UniqueConstraintViolationException $e) {
                if ($attempt === 3) {
                    throw $e;
                }
            }
        }

        $sanctumToken = $user->createToken('auth_token');

        return response()->json([
            'message' => 'Your account is ready.',
            'token' => $sanctumToken->plainTextToken,
            'user' => $user->load('organization:id,name,acronym,organization_type'),
        ], 200);
    }

    private function find(string $token): ?DepartmentHeadInvitation
    {
        return DepartmentHeadInvitation::where('token_hash', hash('sha256', $token))->with('college')->first();
    }

    private function createInvitation(Request $request, College $college, Organization $home, string $role, ?string $positionTitle, string $action, string $description, ?int $registrySchoolId = null): array
    {
        $plainToken = Str::random(64);

        $invitation = DepartmentHeadInvitation::create([
            'college_id' => $college->id,
            'role' => $role,
            'position_title' => $positionTitle,
            'registry_school_id' => $registrySchoolId,
            'token_hash' => hash('sha256', $plainToken),
            'invited_by' => $request->user()->school_id,
            'expires_at' => now()->addHours(48),
        ]);

        AuditLog::create([
            'organization_id' => $home->id,
            'user_id' => $request->user()->school_id,
            'actor_role' => $request->user()->role,
            'module' => 'users',
            'action' => $action,
            'record_type' => DepartmentHeadInvitation::class,
            'record_id' => $invitation->id,
            'new_values' => ['college_id' => $college->id, 'role' => $role, 'position_title' => $positionTitle, 'registry_school_id' => $registrySchoolId],
            'description' => $description,
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);

        $frontendUrl = rtrim((string) config('app.frontend_url', 'http://localhost:5173'), '/');

        return [$invitation, $frontendUrl.'/accept-invitation?token='.$plainToken];
    }

    private function sendLink(?string $email, College $college, string $roleLabel, string $magicLink): bool
    {
        if (! $email) {
            return false;
        }

        try {
            Mail::to(Str::lower(trim($email)))->send(new DeanInvitationMail($college->name, $roleLabel, $magicLink, 48));

            return true;
        } catch (\Throwable $e) {
            Log::warning('Could not dispatch invitation email: '.$e->getMessage());

            return false;
        }
    }

    private function createAccount(Request $request, int $invitationId, array $validated): User
    {
        $invitation = DepartmentHeadInvitation::whereKey($invitationId)->lockForUpdate()->first();
        abort_if(! $invitation, 404, 'This link is not valid.');
        abort_if($invitation->isAccepted(), 410, 'This link was already used. Sign in instead.');
        abort_if($invitation->isExpired(), 410, 'This link has expired. Ask for a new one.');

        $college = College::whereKey($invitation->college_id)->lockForUpdate()->first();
        abort_if(! $college || ! $college->is_active, 410, 'This link has expired. Ask for a new one.');

        $home = $this->collegeHome($college);
        abort_if(! $home, 404, 'College organization home not found.');

        $isHead = $invitation->role === self::HEAD;
        abort_if($isHead && $this->collegeHasActiveHead($home->id), 409, self::ACTIVE_HEAD_EXISTS);

        $role = $isHead ? 'DEPARTMENT_HEAD' : 'ADMIN';
        $positionTitle = $isHead ? null : ($invitation->position_title ?: 'College Secretary');

        if ($invitation->registry_school_id !== null) {
            $record = $this->availableEmployeeRecord($college, $invitation->registry_school_id, lock: true);
            $record->update(['claimed_at' => now()]);
            $identity = ['school_id' => $record->school_id, 'first_name' => $record->first_name, 'last_name' => $record->last_name];
        } else {
            $identity = [
                'school_id' => ! empty($validated['school_id']) ? (int) $validated['school_id'] : $this->nextInternalId(),
                'first_name' => trim($validated['first_name']),
                'last_name' => trim($validated['last_name']),
            ];
        }

        $user = User::create([
            ...$identity,
            'organization_id' => $home->id,
            'email' => $validated['email'],
            'password_hash' => Hash::make($validated['password']),
            'role' => $role,
            'position_title' => $positionTitle,
            'account_status' => 'active',
            'is_member' => true,
            'department' => $college->name,
            'must_change_password' => false,
        ]);

        AccountProfile::firstOrCreate(
            ['user_school_id' => $user->school_id, 'organization_id' => $home->id],
            ['role' => $role, 'position_title' => $positionTitle, 'account_status' => 'active']
        );

        $invitation->update(['accepted_at' => now(), 'school_id' => $user->school_id]);

        AuditLog::create([
            'organization_id' => $home->id,
            'user_id' => $user->school_id,
            'actor_role' => $role,
            'module' => 'users',
            'action' => $isHead ? 'department_head_invitation_accepted' : 'college_staff_invitation_accepted',
            'record_type' => User::class,
            'record_id' => $user->school_id,
            'new_values' => ['school_id' => $user->school_id, 'college_id' => $college->id, 'role' => $role],
            'description' => ($isHead ? 'Department Head' : 'Office staff')." invitation accepted by {$user->first_name} {$user->last_name}.",
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);

        return $user;
    }

    /** An employee record of this college that nobody has used yet, locked so two links cannot claim it at once. */
    private function availableEmployeeRecord(College $college, int $schoolId, bool $lock = false): StudentRegistryEntry
    {
        $query = StudentRegistryEntry::employees()->where('school_id', $schoolId)->where('college_id', $college->id)->whereNull('claimed_at');
        $record = ($lock ? $query->lockForUpdate() : $query)->first();

        if (! $record || User::whereKey($schoolId)->exists()) {
            throw ValidationException::withMessages(['registry_school_id' => ['That person is not in the school records of your college, or already has an account.']]);
        }

        return $record;
    }

    /** users.school_id is the primary key, so a person with no student or employee number still needs one. Internal numbers start high so they never meet real ones. */
    private function nextInternalId(): int
    {
        $highest = DB::table('users')->where('school_id', '>=', self::INTERNAL_ID_START)->max('school_id');
        $next = $highest ? (int) $highest + 1 : self::INTERNAL_ID_START;
        abort_if($next > self::MAX_ID, 500, 'No internal account numbers are left.');

        return $next;
    }
}
