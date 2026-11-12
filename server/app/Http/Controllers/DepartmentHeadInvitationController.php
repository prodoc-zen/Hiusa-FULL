<?php

namespace App\Http\Controllers;

use App\Mail\DeanInvitationMail;
use App\Models\AccountProfile;
use App\Models\AuditLog;
use App\Models\College;
use App\Models\DepartmentHeadInvitation;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\StudentRegistryEntry;
use App\Models\User;
use App\Services\PasswordResetService;
use App\Support\AdviserPosition;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Account links for the people who run a college: one Department Head per college
 * and any number of office staff, the faculty and other non-students the dean gives access to.
 * A plain link carries no identity: the person types their own name, School ID, email and password.
 * For office staff the dean may give an email, and the link then only works for that email and is
 * emailed when mail is set up. A link made from an employee record in the school records carries
 * that record's number and name instead. An employee who already has an account signs in and
 * accepts the link (claim); an employee without one sets an email and password. Nothing attaches
 * to an account until the person accepts, and the link is always handed back for the inviter to copy.
 * The SAO adds the people who help run the SAO the same way: a plain link that belongs to no college, and accepting
 * it makes a SUPER_ADMIN account on the SAO organization.
 */
class DepartmentHeadInvitationController extends Controller
{
    private const NOT_STUDENTS = 'Students cannot be office staff. Pick someone from the employee records.';

    private const ALREADY_STAFF = 'This person is already on the college office staff.';

    private const ACTIVE_HEAD_EXISTS = 'This college already has an active Department Head. Deactivate the current one first.';

    private const STAFF = 'COLLEGE_STAFF';

    private const HEAD = 'DEPARTMENT_HEAD';

    private const SAO = 'SAO_STAFF';

    private const SAO_POSITION = 'SAO staff';

    private const DEFAULT_POSITION = 'Office staff';

    /** Numbers from here up were generated for accounts made before a typed School ID was required; a typed one stays below. */
    private const INTERNAL_ID_START = 95000000;

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

        // With the log mail driver a sent mail goes nowhere, so the answer must not claim it was emailed.
        $mailIsOff = app(PasswordResetService::class)->mailIsOff();
        $emailed = ! $mailIsOff && $this->sendLink($data['email'] ?? null, $college, 'Department Head', $magicLink);

        return response()->json([
            'message' => 'The link is ready.',
            'invitation' => $invitation->load('college:id,name,code'),
            'magic_link' => $magicLink,
            'emailed' => $emailed,
            'mail_is_off' => $mailIsOff,
        ], 201);
    }

    public function inviteStaff(Request $request): JsonResponse
    {
        [$college, $home] = $this->staffCollege($request);

        $data = $request->validate([
            'registry_school_id' => ['nullable', 'integer', 'min:1'],
            'position_title' => ['nullable', 'string', 'max:100'],
            'email' => ['nullable', 'email', 'max:100'],
        ]);

        $email = null;
        [$invitation, $magicLink] = DB::transaction(function () use ($request, $college, $home, $data, &$email) {
            $position = isset($data['position_title']) && trim($data['position_title']) !== '' ? trim($data['position_title']) : null;
            $description = "Created an office staff invitation link for {$college->name}.";

            if (! empty($data['registry_school_id'])) {
                $record = $this->staffRecord($home, $college, (int) $data['registry_school_id']);
                DepartmentHeadInvitation::where('registry_school_id', $record->school_id)->whereNull('accepted_at')->delete();

                return $this->createInvitation($request, $college, $home, self::STAFF, $position ?: $record->position, 'college_staff_invited', $description, $record->school_id);
            }

            $email = isset($data['email']) && trim($data['email']) !== '' ? Str::lower(trim($data['email'])) : null;
            if ($email === null) {
                return $this->createInvitation($request, $college, $home, self::STAFF, $position, 'college_staff_invited', $description);
            }

            $existing = User::where('email', $email)->first();
            if ($existing) {
                throw ValidationException::withMessages(['email' => [$this->isStudentAccount($existing) ? self::NOT_STUDENTS : 'That email already has an account. Pick them from the employee records.']]);
            }
            DepartmentHeadInvitation::where('college_id', $college->id)->where('role', self::STAFF)->where('email', $email)->whereNull('accepted_at')->delete();

            return $this->createInvitation($request, $college, $home, self::STAFF, $position, 'college_staff_invited', $description, null, ['email' => $email]);
        });

        // With the log mail driver a sent mail goes nowhere, so the answer must not claim it was emailed.
        $mailIsOff = app(PasswordResetService::class)->mailIsOff();
        $emailed = ! $mailIsOff && $this->sendLink($email, $college, 'office staff', $magicLink);

        return response()->json([
            'message' => 'The link is ready.',
            'invitation' => $invitation->load('college:id,name,code'),
            'magic_link' => $magicLink,
            'emailed' => $emailed,
            'mail_is_off' => $mailIsOff,
        ], 201);
    }

    public function inviteSao(Request $request): JsonResponse
    {
        $home = $this->saoHome();
        $data = $request->validate(['email' => ['nullable', 'email', 'max:100']]);
        $email = isset($data['email']) && trim($data['email']) !== '' ? Str::lower(trim($data['email'])) : null;

        [$invitation, $magicLink] = DB::transaction(function () use ($request, $home, $email) {
            if ($email === null) {
                return $this->createInvitation($request, null, $home, self::SAO, self::SAO_POSITION, 'sao_staff_invited', 'Created an SAO staff invitation link.');
            }

            if (User::where('email', $email)->exists()) {
                throw ValidationException::withMessages(['email' => ['That email already has an account.']]);
            }
            DepartmentHeadInvitation::where('role', self::SAO)->where('email', $email)->whereNull('accepted_at')->delete();

            return $this->createInvitation($request, null, $home, self::SAO, self::SAO_POSITION, 'sao_staff_invited', 'Created an SAO staff invitation link.', null, ['email' => $email]);
        });

        // With the log mail driver a sent mail goes nowhere, so the answer must not claim it was emailed.
        $mailIsOff = app(PasswordResetService::class)->mailIsOff();
        $emailed = ! $mailIsOff && $this->sendLink($email, null, self::SAO_POSITION, $magicLink);

        return response()->json([
            'message' => 'The link is ready.',
            'invitation' => $invitation,
            'magic_link' => $magicLink,
            'emailed' => $emailed,
            'mail_is_off' => $mailIsOff,
        ], 201);
    }

    public function pendingSao(): JsonResponse
    {
        $invitations = DepartmentHeadInvitation::where('role', self::SAO)->pending()->orderByDesc('id')->get();

        return response()->json(['data' => $invitations->map(fn (DepartmentHeadInvitation $invitation) => [
            'id' => $invitation->id,
            'name' => $invitation->email ?: 'Open link',
            'email' => $invitation->email,
            'position_title' => $invitation->position_title,
            'expires_at' => $invitation->expires_at,
        ])->values()])->header('Cache-Control', 'no-store, private');
    }

    /** Replaces the link of a pending SAO invitation with a new one that lasts 48 hours; the old link stops working. */
    public function relinkSao(Request $request, int $invitation): JsonResponse
    {
        $home = $this->saoHome();

        [$row, $magicLink] = DB::transaction(function () use ($request, $home, $invitation) {
            $row = DepartmentHeadInvitation::where('role', self::SAO)->whereNull('accepted_at')->lockForUpdate()->findOrFail($invitation);
            $plainToken = Str::random(64);
            $row->update(['token_hash' => hash('sha256', $plainToken), 'expires_at' => now()->addHours(48)]);
            $this->audit($request, $home, 'sao_staff_link_renewed', $row, 'Made a new SAO staff link.');

            return [$row, $this->linkFor($plainToken)];
        });

        return response()->json(['message' => 'The link is ready.', 'invitation' => $row, 'magic_link' => $magicLink]);
    }

    public function revokeSao(Request $request, int $invitation): JsonResponse
    {
        $home = $this->saoHome();

        DB::transaction(function () use ($request, $home, $invitation) {
            $row = DepartmentHeadInvitation::where('role', self::SAO)->whereNull('accepted_at')->lockForUpdate()->findOrFail($invitation);
            $row->delete();
            $this->audit($request, $home, 'sao_staff_invitation_revoked', $row, 'Revoked an SAO staff invitation link.');
        });

        return response()->json(['message' => 'The link no longer works.']);
    }

    /** The links nobody has used yet. The link itself is never stored, so Copy link makes a fresh one. */
    public function pendingStaff(Request $request): JsonResponse
    {
        [$college] = $this->staffCollege($request);

        $invitations = DepartmentHeadInvitation::where('college_id', $college->id)->where('role', self::STAFF)->pending()->orderByDesc('id')->get();
        $records = StudentRegistryEntry::employees()->whereIn('school_id', $invitations->pluck('registry_school_id')->filter()->all())->get()->keyBy('school_id');

        return response()->json(['data' => $invitations->map(function (DepartmentHeadInvitation $invitation) use ($records) {
            $record = $invitation->registry_school_id ? $records->get($invitation->registry_school_id) : null;

            return [
                'id' => $invitation->id,
                'name' => $record ? $record->full_name : (trim("{$invitation->first_name} {$invitation->last_name}") ?: ($invitation->email ?: 'Open link')),
                'email' => $invitation->email,
                'position_title' => $invitation->position_title,
                'expires_at' => $invitation->expires_at,
            ];
        })->values()])->header('Cache-Control', 'no-store, private');
    }

    /** Replaces the link of a pending invitation with a new one that lasts 48 hours; the old link stops working. */
    public function relinkStaff(Request $request, int $invitation): JsonResponse
    {
        [$college, $home] = $this->staffCollege($request);

        [$row, $magicLink] = DB::transaction(function () use ($request, $college, $home, $invitation) {
            $row = DepartmentHeadInvitation::where('college_id', $college->id)->where('role', self::STAFF)->whereNull('accepted_at')->lockForUpdate()->findOrFail($invitation);
            $plainToken = Str::random(64);
            $row->update(['token_hash' => hash('sha256', $plainToken), 'expires_at' => now()->addHours(48)]);
            $this->audit($request, $home, 'college_staff_link_renewed', $row, "Made a new office staff link for {$college->name}.");

            return [$row, $this->linkFor($plainToken)];
        });

        return response()->json(['message' => 'The link is ready.', 'invitation' => $row, 'magic_link' => $magicLink]);
    }

    public function revokeStaff(Request $request, int $invitation): JsonResponse
    {
        [$college, $home] = $this->staffCollege($request);

        DB::transaction(function () use ($request, $college, $home, $invitation) {
            $row = DepartmentHeadInvitation::where('college_id', $college->id)->where('role', self::STAFF)->whereNull('accepted_at')->lockForUpdate()->findOrFail($invitation);
            $row->delete();
            $this->audit($request, $home, 'college_staff_invitation_revoked', $row, "Revoked an office staff invitation link for {$college->name}.");
        });

        return response()->json(['message' => 'The link no longer works.']);
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

        if ($invitation->isExpired() || $this->collegeGone($invitation)) {
            return response()->json(['message' => 'This link has expired. Ask for a new one.'], 410);
        }

        $inviter = $invitation->inviter;

        $record = $invitation->registry_school_id ? StudentRegistryEntry::employees()->where('school_id', $invitation->registry_school_id)->first() : null;

        return response()->json([
            'invitation' => [
                'role' => $invitation->role,
                'position_title' => $invitation->position_title,
                'expires_at' => $invitation->expires_at,
                // An employee who already has an account signs in and accepts; nobody makes a second account.
                'existing_account' => $invitation->registry_school_id !== null && User::whereKey($invitation->registry_school_id)->exists(),
                // The email the link was made for, if any; the page fills it in and locks it. The person types their own name.
                'prefill' => $invitation->email ? ['email' => $invitation->email] : null,
                // The name only: the page says who invited you, and the link holder gets no email or ID.
                'inviter' => $inviter ? ['name' => trim("{$inviter->first_name} {$inviter->last_name}")] : null,
                'record' => $record ? [
                    'school_id' => $record->school_id,
                    'first_name' => $record->first_name,
                    'last_name' => $record->last_name,
                ] : null,
            ],
            'college' => $invitation->college?->only(['id', 'name', 'code']),
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

        if ($invitation->isExpired() || $this->collegeGone($invitation)) {
            return response()->json(['message' => 'This link has expired. Ask for a new one.'], 410);
        }

        $fromRecord = $invitation->registry_school_id !== null;
        if ($fromRecord && User::whereKey($invitation->registry_school_id)->exists()) {
            return response()->json(['message' => 'This person already has an account. Sign in and accept the link.'], 409);
        }

        $request->merge(['email' => is_string($request->input('email')) ? Str::lower(trim($request->input('email'))) : $request->input('email')]);
        $validated = $request->validate([
            'first_name' => [$fromRecord ? 'prohibited' : 'required', 'string', 'max:60'],
            'last_name' => [$fromRecord ? 'prohibited' : 'required', 'string', 'max:60'],
            'email' => ['required', 'email', 'max:100', 'unique:users,email', ...($invitation->email ? [Rule::in([$invitation->email])] : [])],
            'school_id' => ['bail', $fromRecord ? 'prohibited' : 'required', 'integer', 'min:1', 'max:'.(self::INTERNAL_ID_START - 1), 'unique:users,school_id', fn ($attribute, $value, $fail) => StudentRegistryEntry::students()->where('school_id', $value)->exists() && $fail('That school ID belongs to a student record. Enter your employee number.')],
            'password' => ['required', 'string', 'min:8', 'confirmed'],
        ], [
            'email.in' => 'Use the email this invitation was made for.',
            'school_id.required' => 'Enter your school ID.',
            'school_id.integer' => 'Enter your school ID using numbers only.',
            'school_id.min' => 'Enter your school ID using numbers only.',
            'school_id.max' => 'Enter your school ID using numbers only.',
            'school_id.unique' => 'This school ID already has an account. Sign in, or reset your password.',
        ]);

        try {
            $user = DB::transaction(fn () => $this->createAccount($request, $invitation->id, $validated));
        } catch (UniqueConstraintViolationException) {
            throw ValidationException::withMessages([$fromRecord ? 'email' : 'school_id' => ['That school ID or email already has an account. Sign in, or reset your password.']]);
        }

        $sanctumToken = $user->createToken('auth_token');

        return response()->json([
            'message' => 'Your account is ready.',
            'token' => $sanctumToken->plainTextToken,
            'user' => $user->load('organization:id,name,acronym,organization_type'),
        ], 200);
    }

    /** A signed-in employee takes up a link made from their own record. Only now does the office staff profile attach. */
    public function claim(Request $request, string $token): JsonResponse
    {
        $invitation = $this->find($token);

        if (! $invitation) {
            return response()->json(['message' => 'This link is not valid.'], 404);
        }

        if ($invitation->isAccepted()) {
            return response()->json(['message' => 'This link was already used.'], 410);
        }

        if ($invitation->isExpired() || $this->collegeGone($invitation)) {
            return response()->json(['message' => 'This link has expired. Ask for a new one.'], 410);
        }

        $user = $request->user();
        if ($invitation->role !== self::STAFF || $invitation->registry_school_id === null || (int) $invitation->registry_school_id !== (int) $user->school_id) {
            return response()->json(['message' => 'This link was made for someone else.'], 403);
        }

        $profile = DB::transaction(function () use ($request, $invitation, $user) {
            $invitation = DepartmentHeadInvitation::whereKey($invitation->id)->lockForUpdate()->first();
            abort_if(! $invitation || $invitation->isAccepted(), 410, 'This link was already used.');
            abort_if($invitation->isExpired(), 410, 'This link has expired. Ask for a new one.');

            $college = College::whereKey($invitation->college_id)->lockForUpdate()->first();
            abort_if(! $college || ! $college->is_active, 410, 'This link has expired. Ask for a new one.');
            $home = $this->collegeHome($college);
            abort_if(! $home, 404, 'College organization home not found.');

            $record = $this->staffRecord($home, $college, (int) $user->school_id);
            $positionTitle = $invitation->position_title ?: ($record->position ?: self::DEFAULT_POSITION);

            $profile = AccountProfile::updateOrCreate(
                ['user_school_id' => $user->school_id, 'organization_id' => $home->id],
                ['role' => 'ADMIN', 'position_title' => $positionTitle, 'account_status' => 'active']
            );
            $record->update(['claimed_at' => $record->claimed_at ?? now()]);
            $invitation->update(['accepted_at' => now(), 'school_id' => $user->school_id]);

            AuditLog::create([
                'organization_id' => $home->id,
                'user_id' => $user->school_id,
                'actor_role' => 'ADMIN',
                'module' => 'users',
                'action' => 'college_staff_invitation_accepted',
                'record_type' => AccountProfile::class,
                'record_id' => $profile->id,
                'new_values' => ['user_school_id' => $user->school_id, 'college_id' => $college->id, 'role' => 'ADMIN', 'position_title' => $positionTitle],
                'description' => "Office staff invitation accepted by {$user->first_name} {$user->last_name}.",
                'ip_address' => $request->ip(),
                'created_at' => now(),
            ]);

            Notification::create([
                'organization_id' => $home->id,
                'user_id' => $user->school_id,
                'notification_type' => 'general',
                'title' => 'College Office Role Assigned',
                'message' => "You are now {$positionTitle} for {$college->name}. Switch to this profile to work as office staff.",
                'is_read' => false,
                'sent_at' => now(),
            ]);

            return $profile;
        });

        return response()->json(['message' => 'You are now on the college office staff.', 'profile_id' => $profile->id, 'position_title' => $profile->position_title]);
    }

    /** A college link dies with its college; an SAO link belongs to none. */
    private function collegeGone(DepartmentHeadInvitation $invitation): bool
    {
        return $invitation->college_id !== null && ! $invitation->college?->is_active;
    }

    private function saoHome(): Organization
    {
        $home = Organization::where('organization_type', 'SYSTEM_ADMINISTRATION')->orderBy('id')->first();
        abort_if(! $home, 404, 'The SAO organization was not found.');

        return $home;
    }

    private function find(string $token): ?DepartmentHeadInvitation
    {
        return DepartmentHeadInvitation::where('token_hash', hash('sha256', $token))->with('college')->first();
    }

    private function createInvitation(Request $request, ?College $college, Organization $home, string $role, ?string $positionTitle, string $action, string $description, ?int $registrySchoolId = null, array $identity = []): array
    {
        $plainToken = Str::random(64);

        $invitation = DepartmentHeadInvitation::create([
            ...$identity,
            'college_id' => $college?->id,
            'role' => $role,
            'position_title' => $positionTitle,
            'registry_school_id' => $registrySchoolId,
            'token_hash' => hash('sha256', $plainToken),
            'invited_by' => $request->user()->school_id,
            'expires_at' => now()->addHours(48),
        ]);

        $this->audit($request, $home, $action, $invitation, $description, ['college_id' => $college?->id, 'role' => $role, 'position_title' => $positionTitle, 'registry_school_id' => $registrySchoolId]);

        return [$invitation, $this->linkFor($plainToken)];
    }

    private function linkFor(string $plainToken): string
    {
        return rtrim((string) config('app.frontend_url', 'http://localhost:5173'), '/').'/accept-invitation?token='.$plainToken;
    }

    private function audit(Request $request, Organization $home, string $action, DepartmentHeadInvitation $invitation, string $description, ?array $newValues = null): void
    {
        AuditLog::create([
            'organization_id' => $home->id,
            'user_id' => $request->user()->school_id,
            'actor_role' => $request->user()->role,
            'module' => 'users',
            'action' => $action,
            'record_type' => DepartmentHeadInvitation::class,
            'record_id' => $invitation->id,
            'new_values' => $newValues,
            'description' => $description,
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);
    }

    private function sendLink(?string $email, ?College $college, string $roleLabel, string $magicLink): bool
    {
        if (! $email) {
            return false;
        }

        try {
            Mail::to(Str::lower(trim($email)))->send(new DeanInvitationMail($college?->name ?? 'the Student Affairs Office', $roleLabel, $magicLink, 48));

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

        $isSao = $invitation->role === self::SAO;
        if ($isSao) {
            $college = null;
            $home = $this->saoHome();
        } else {
            $college = College::whereKey($invitation->college_id)->lockForUpdate()->first();
            abort_if(! $college || ! $college->is_active, 410, 'This link has expired. Ask for a new one.');

            $home = $this->collegeHome($college);
            abort_if(! $home, 404, 'College organization home not found.');
        }

        $isHead = $invitation->role === self::HEAD;
        abort_if($isHead && $this->collegeHasActiveHead($home->id), 409, self::ACTIVE_HEAD_EXISTS);

        $role = $isSao ? 'SUPER_ADMIN' : ($isHead ? 'DEPARTMENT_HEAD' : 'ADMIN');
        $positionTitle = $isHead ? null : ($isSao ? self::SAO_POSITION : ($invitation->position_title ?: self::DEFAULT_POSITION));

        if ($invitation->registry_school_id !== null) {
            $record = $this->availableEmployeeRecord($college, $invitation->registry_school_id, lock: true);
            $record->update(['claimed_at' => now()]);
            $identity = ['school_id' => $record->school_id, 'first_name' => $record->first_name, 'last_name' => $record->last_name];
        } else {
            $identity = [
                'school_id' => (int) $validated['school_id'],
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
            'department' => $college?->name,
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
            'action' => $isSao ? 'sao_staff_invitation_accepted' : ($isHead ? 'department_head_invitation_accepted' : 'college_staff_invitation_accepted'),
            'record_type' => User::class,
            'record_id' => $user->school_id,
            'new_values' => ['school_id' => $user->school_id, 'college_id' => $college?->id, 'role' => $role],
            'description' => ($isSao ? 'SAO staff' : ($isHead ? 'Department Head' : 'Office staff'))." invitation accepted by {$user->first_name} {$user->last_name}.",
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);

        return $user;
    }

    /** The dean's own college and its home organization; office staff and everyone else are refused by the route. */
    private function staffCollege(Request $request): array
    {
        $home = Organization::whereKey($request->user()->organization_id)->first();
        $college = $home && $home->organization_type === 'COLLEGE' && $home->college_id ? College::find($home->college_id) : null;
        abort_if(! $college || ! $college->is_active, 403, 'Your account is not assigned to a college.');

        return [$college, $home];
    }

    /**
     * The employee record a staff link may be made from, locked so two links cannot claim it at once. A person who
     * already has an account stays eligible (they accept while signed in); a student never is, and neither is
     * someone who is already on the dean's office.
     */
    private function staffRecord(Organization $home, College $college, int $schoolId): StudentRegistryEntry
    {
        $user = User::whereKey($schoolId)->lockForUpdate()->first();
        if (StudentRegistryEntry::students()->where('school_id', $schoolId)->exists() || ($user && $this->isStudentAccount($user))) {
            throw ValidationException::withMessages(['registry_school_id' => [self::NOT_STUDENTS]]);
        }

        $record = StudentRegistryEntry::employees()->where('school_id', $schoolId)->where('college_id', $college->id)->lockForUpdate()->first();
        if (! $record) {
            throw ValidationException::withMessages(['registry_school_id' => ['That person is not in the employee records of your college.']]);
        }

        if ($user) {
            if ($this->isOnStaff($user, $home)) {
                throw ValidationException::withMessages(['registry_school_id' => [self::ALREADY_STAFF]]);
            }
            if ($user->getRawOriginal('account_status') !== 'active' || $user->getRawOriginal('role') === 'SUPER_ADMIN') {
                throw ValidationException::withMessages(['registry_school_id' => ['That person does not have an active account.']]);
            }
        } elseif ($record->claimed_at !== null) {
            throw ValidationException::withMessages(['registry_school_id' => ['That record was already used for an account.']]);
        }

        return $record;
    }

    /**
     * A student account: the STUDENT role, an enrolled student's record, a student or officer profile anywhere, or
     * any active place in a student organization (an active profile there, or the organization the account sits on)
     * unless the title is an adviser's. A president with the ADMIN role is still a student; a faculty adviser is not.
     */
    private function isStudentAccount(User $user): bool
    {
        if ($user->getRawOriginal('role') === 'STUDENT' || StudentRegistryEntry::students()->where('school_id', $user->school_id)->exists()) {
            return true;
        }

        $profiles = $user->accountProfiles()->where('account_status', 'active');
        if ((clone $profiles)->whereIn('role', ['STUDENT', 'SBO_OFFICER'])->exists()) {
            return true;
        }

        $inStudentOrganization = (clone $profiles)
            ->whereHas('organization', fn ($organization) => $organization->where('organization_type', 'STUDENT_ORGANIZATION'))
            ->where(fn ($title) => AdviserPosition::whereNot($title, 'account_profiles.position_title'));
        if ($inStudentOrganization->exists()) {
            return true;
        }

        return $user->getRawOriginal('account_status') === 'active'
            && ! AdviserPosition::is($user->getRawOriginal('position_title'))
            && Organization::student()->whereKey($user->getRawOriginal('organization_id'))->exists();
    }

    /** Only an active office staff or Department Head account of this college's home organization is already on staff. */
    private function isOnStaff(User $user, Organization $home): bool
    {
        $roles = ['ADMIN', 'DEPARTMENT_HEAD'];

        return $user->accountProfiles()->where('organization_id', $home->id)->where('account_status', 'active')->whereIn('role', $roles)->exists()
            || ((int) $user->getRawOriginal('organization_id') === (int) $home->id && $user->getRawOriginal('account_status') === 'active' && in_array($user->getRawOriginal('role'), $roles, true));
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
}
