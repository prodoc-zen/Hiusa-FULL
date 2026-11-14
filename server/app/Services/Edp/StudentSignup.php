<?php

namespace App\Services\Edp;

use App\Models\AuditLog;
use App\Models\College;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Validation\ValidationException;

class StudentSignup
{
    /** One message for a missing record and a wrong birth date, so it never says which school IDs exist. It tells the student what to check and who fixes a record. */
    public const MISMATCH = "We couldn't match that school ID and birth date with the school records. Check both. If they are right, your record may be missing or have a typing mistake. Show your school ID at your Department Head's office or the Student Affairs Office, and they can add or correct it.";

    private const FAILURE_LIMIT = 5;

    private const FAILURE_WINDOW_SECONDS = 900;

    public function __construct(private readonly StudentRegistry $registry) {}

    /** @return array{record: StudentRecord, college: College, home: Organization} */
    public function match(int $schoolId, string $birthDate): array
    {
        $failureKey = 'signup-failures:'.$schoolId;

        if (RateLimiter::tooManyAttempts($failureKey, self::FAILURE_LIMIT)) {
            throw new HttpResponseException(response()->json([
                'message' => 'Too many tries for this school ID. Please wait a few minutes, then try again.',
            ], 429, ['Retry-After' => RateLimiter::availableIn($failureKey)]));
        }

        try {
            $record = $this->registry->find($schoolId);
        } catch (StudentRegistryUnavailable) {
            throw new HttpResponseException(response()->json([
                'message' => "The school records can't be reached right now. Please try again later.",
            ], 503));
        }

        if (! $record || ! hash_equals($record->birthDate, $birthDate)) {
            RateLimiter::hit($failureKey, self::FAILURE_WINDOW_SECONDS);

            throw ValidationException::withMessages(['school_id' => [self::MISMATCH]]);
        }

        if ($record->claimed || User::whereKey($schoolId)->exists()) {
            throw ValidationException::withMessages(['school_id' => ['This school ID already has an account. Sign in, or reset your password.']]);
        }

        $college = College::where('is_active', true)->find($record->collegeId);
        $home = $college?->homeOrganization()->where('is_active', true)->first();

        if (! $college || ! $home) {
            throw ValidationException::withMessages(['school_id' => ["Sign-up isn't open for your college yet. Ask the Student Affairs Office."]]);
        }

        return ['record' => $record, 'college' => $college, 'home' => $home];
    }

    public function register(int $schoolId, string $birthDate, string $email, string $password, Request $request): User
    {
        ['record' => $record, 'college' => $college, 'home' => $home] = $this->match($schoolId, $birthDate);

        return DB::transaction(function () use ($record, $college, $home, $email, $password, $request) {
            if (! $this->registry->markClaimed($record->schoolId)) {
                throw ValidationException::withMessages(['school_id' => ['This school ID already has an account. Sign in, or reset your password.']]);
            }

            $user = User::create([
                'organization_id' => $home->id,
                'school_id' => $record->schoolId,
                'first_name' => $record->firstName,
                'last_name' => $record->lastName,
                'email' => $email,
                'password_hash' => $password,
                'must_change_password' => false,
                'role' => 'STUDENT',
                'account_status' => 'active',
                'is_member' => true,
                'department' => $college->name,
                'program' => $record->program,
                'year_level' => $record->yearLevel,
                'section' => $record->section,
            ]);

            AuditLog::create([
                'organization_id' => $home->id, 'user_id' => $user->school_id,
                'module' => 'users', 'action' => 'student_signed_up', 'record_type' => User::class,
                'record_id' => $user->school_id, 'new_values' => ['school_id' => $user->school_id, 'college_id' => $college->id],
                'ip_address' => $request->ip(), 'created_at' => now(),
            ]);

            return $user;
        });
    }
}
