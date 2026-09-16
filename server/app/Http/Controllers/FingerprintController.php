<?php

namespace App\Http\Controllers;

use App\Contracts\FingerprintMatcher;
use App\Exceptions\FingerprintMatcherRejected;
use App\Exceptions\FingerprintMatcherUnavailable;
use App\Models\Attendance;
use App\Models\AuditLog;
use App\Models\Event;
use App\Models\Fingerprint;
use App\Models\FingerprintVerification;
use App\Models\User;
use App\Services\FingerprintTemplateService;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use JsonException;
use RuntimeException;

class FingerprintController extends Controller
{
    public function __construct(
        private readonly FingerprintMatcher $matcher,
        private readonly FingerprintTemplateService $templates,
    ) {}

    public function store(Request $request, $id): JsonResponse
    {
        $user = User::where('organization_id', $request->user()->organization_id)->find($id);
        if (! $user) {
            return response()->json(['message' => 'User not found.'], 404);
        }
        if ($denial = $this->fingerprintManagementDenial($request->user(), $user)) {
            return $denial;
        }

        $data = $request->validate([
            'samples' => ['required', 'array', 'min:4', 'max:8'],
            'samples.*' => ['required', 'string', 'max:2097152'],
            'sample_format' => ['required', 'integer', 'in:5'],
            'finger_index' => ['nullable', 'integer', 'between:0,9'],
            'consent_confirmed' => ['required', 'accepted'],
        ]);

        try {
            $enrollment = $this->matcher->enroll($data['samples'], $data['sample_format']);
        } catch (FingerprintMatcherUnavailable $exception) {
            return response()->json(['message' => $exception->getMessage(), 'code' => 'matcher_unavailable'], 503);
        } catch (FingerprintMatcherRejected $exception) {
            return response()->json(['message' => $exception->getMessage(), 'code' => 'capture_rejected'], 422);
        } catch (RuntimeException) {
            return response()->json(['message' => 'Fingerprint enrollment failed in the matching engine.'], 502);
        }

        $fingerIndex = $data['finger_index'] ?? 0;
        $fingerprint = Fingerprint::updateOrCreate(
            [
                'organization_id' => $request->user()->organization_id,
                'user_id' => $user->school_id,
                'finger_index' => $fingerIndex,
            ],
            [
                'template' => $this->templates->encrypt($enrollment['template']),
                'template_format' => $enrollment['template_format'],
                'enrolled_by' => $request->user()->school_id,
                'enrolled_at' => now(),
            ],
        );

        $this->audit($request, 'fingerprint_enrolled', $user, [
            'finger_index' => $fingerIndex,
            'consent_confirmed' => true,
        ]);

        return response()->json([
            'message' => 'Fingerprint enrolled successfully.',
            'fingerprint' => $fingerprint->makeHidden('template'),
        ], 201);
    }

    public function destroy(Request $request, $id): JsonResponse
    {
        $user = User::where('organization_id', $request->user()->organization_id)->find($id);
        if (! $user) {
            return response()->json(['message' => 'User not found.'], 404);
        }
        if ($denial = $this->fingerprintManagementDenial($request->user(), $user)) {
            return $denial;
        }

        $deleted = Fingerprint::where('organization_id', $request->user()->organization_id)
            ->where('user_id', $user->school_id)
            ->delete();

        if ($deleted === 0) {
            return response()->json(['message' => 'This user has no enrolled fingerprint.'], 404);
        }

        $this->audit($request, 'fingerprint_removed', $user);

        return response()->json(['message' => 'Fingerprint removed.']);
    }

    public function identify(Request $request): JsonResponse
    {
        $data = $this->validateIdentification($request);
        $result = $this->matchWithinOrganization($request, $data);

        if ($result instanceof JsonResponse) {
            return $result;
        }

        return response()->json($result);
    }

    public function attend(Request $request, $eventId): JsonResponse
    {
        $event = Event::where('organization_id', $request->user()->organization_id)->find($eventId);
        if (! $event) {
            return response()->json(['message' => 'Event not found.'], 404);
        }
        if (! in_array($event->status, ['approved', 'ongoing'], true)) {
            return response()->json(['message' => 'Only approved or ongoing events can accept attendance.'], 422);
        }

        $data = $this->validateIdentification($request);
        $result = $this->matchWithinOrganization($request, $data, $event->id);
        if ($result instanceof JsonResponse) {
            return $result;
        }

        $user = User::where('organization_id', $request->user()->organization_id)
            ->where('school_id', $result['user']['school_id'])
            ->firstOrFail();

        $action = $this->attendanceAction(
            Attendance::where('event_id', $event->id)->where('user_id', $user->school_id)->first()
        );
        if ($action === 'already_checked_out') {
            return response()->json([
                'message' => $user->first_name.' '.$user->last_name.' is already checked out from this event.',
                'user' => $result['user'],
            ], 409);
        }

        $confirmationTtl = min(300, max(30, (int) config('fingerprint.identification.confirmation_ttl_seconds', 120)));
        $expiresAt = now()->addSeconds($confirmationTtl);
        $confirmationToken = Crypt::encryptString(json_encode([
            'actor_id' => $request->user()->school_id,
            'organization_id' => $request->user()->organization_id,
            'event_id' => $event->id,
            'user_id' => $user->school_id,
            'action' => $action,
            'score' => $result['match']['score'],
            'threshold' => $result['match']['threshold'],
            'expires_at' => $expiresAt->timestamp,
        ], JSON_THROW_ON_ERROR));

        return response()->json([
            ...$result,
            'action' => $action,
            'confirmation_token' => $confirmationToken,
            'confirmation_expires_at' => $expiresAt->toISOString(),
            'message' => 'Confirm the identified student before recording '.($action === 'check_out' ? 'checkout.' : 'check-in.'),
        ]);
    }

    public function confirmAttendance(Request $request, $eventId): JsonResponse
    {
        $event = Event::where('organization_id', $request->user()->organization_id)->find($eventId);
        if (! $event) {
            return response()->json(['message' => 'Event not found.'], 404);
        }
        if (! in_array($event->status, ['approved', 'ongoing'], true)) {
            return response()->json(['message' => 'Only approved or ongoing events can accept attendance.'], 422);
        }

        $data = $request->validate([
            'confirmation_token' => ['required', 'string', 'max:8192'],
        ]);

        try {
            $confirmation = json_decode(Crypt::decryptString($data['confirmation_token']), true, flags: JSON_THROW_ON_ERROR);
        } catch (DecryptException|JsonException) {
            return response()->json(['message' => 'This fingerprint confirmation is invalid. Scan the finger again.'], 422);
        }

        $validContext = is_array($confirmation)
            && (int) ($confirmation['actor_id'] ?? 0) === (int) $request->user()->school_id
            && (int) ($confirmation['organization_id'] ?? 0) === (int) $request->user()->organization_id
            && (int) ($confirmation['event_id'] ?? 0) === (int) $event->id
            && in_array($confirmation['action'] ?? null, ['check_in', 'check_out'], true);
        if (! $validContext) {
            return response()->json(['message' => 'This fingerprint confirmation does not belong to this operator or event. Scan again.'], 403);
        }
        if ((int) ($confirmation['expires_at'] ?? 0) < now()->timestamp) {
            return response()->json(['message' => 'This fingerprint confirmation expired. Scan the finger again.'], 422);
        }

        $user = User::where('organization_id', $request->user()->organization_id)
            ->where('school_id', $confirmation['user_id'] ?? null)
            ->where('account_status', 'active')
            ->first();
        if (! $user) {
            return response()->json(['message' => 'The identified user is no longer available. Scan again.'], 422);
        }

        try {
            $attendanceResult = DB::transaction(function () use ($confirmation, $event, $user, $request) {
                $existingRecord = Attendance::where('event_id', $event->id)
                    ->where('user_id', $user->school_id)
                    ->lockForUpdate()
                    ->first();

                $currentAction = $this->attendanceAction($existingRecord);
                if ($currentAction !== $confirmation['action']) {
                    return ['action' => 'stale', 'record' => $existingRecord];
                }

                if ($currentAction === 'check_out') {
                    $existingRecord->forceFill(['check_out_time' => now()])->save();

                    return ['action' => 'checked_out', 'record' => $existingRecord];
                }

                return ['action' => 'checked_in', 'record' => Attendance::create([
                    'event_id' => $event->id,
                    'user_id' => $user->school_id,
                    'method' => 'biometric',
                    'status' => 'present',
                    'check_in_time' => now(),
                    'recorded_by' => $request->user()->school_id,
                    'remarks' => 'Identified with a single fingerprint scan.',
                ])];
            });
        } catch (UniqueConstraintViolationException) {
            return response()->json([
                'message' => 'Attendance changed before confirmation. Scan the finger again.',
                'user' => $user,
            ], 409);
        }

        if ($attendanceResult['action'] === 'stale') {
            return response()->json([
                'message' => 'Attendance changed before confirmation. Scan the finger again.',
                'user' => $user,
            ], 409);
        }

        $checkedOut = $attendanceResult['action'] === 'checked_out';
        $record = $attendanceResult['record'];
        $this->audit($request, $checkedOut ? 'biometric_attendance_checked_out' : 'biometric_attendance_recorded', $user, [
            'event_id' => $event->id,
            'attendance_id' => $record->id,
        ]);

        return response()->json([
            'identified' => true,
            'user' => $user,
            'match' => [
                'score' => (float) ($confirmation['score'] ?? 0),
                'threshold' => (float) ($confirmation['threshold'] ?? config('fingerprint.identification.minimum_score', 60)),
            ],
            'action' => $attendanceResult['action'],
            'message' => $user->first_name.' '.$user->last_name.' was identified and '.($checkedOut ? 'checked out.' : 'checked in.'),
            'attendance' => $record->load([
                'user:school_id,first_name,last_name',
                'recorder:school_id,first_name,last_name',
            ]),
        ], $checkedOut ? 200 : 201);
    }

    private function validateIdentification(Request $request): array
    {
        return $request->validate([
            // Identification deliberately accepts exactly one probe capture.
            'samples' => ['required', 'array', 'size:1'],
            'samples.0' => ['required', 'string', 'max:2097152'],
            'sample_format' => ['required', 'integer', 'in:5'],
            'year_levels' => ['nullable', 'array', 'max:4'],
            'year_levels.*' => ['required', 'string', 'distinct', 'in:1st Year,2nd Year,3rd Year,4th Year'],
            'programs' => ['nullable', 'array', 'max:20'],
            'programs.*' => ['required', 'string', 'distinct', 'max:120'],
            'sections' => ['nullable', 'array', 'max:20'],
            'sections.*' => ['required', 'string', 'distinct', 'max:60'],
        ]);
    }

    private function matchWithinOrganization(Request $request, array $data, ?int $eventId = null): array|JsonResponse
    {
        $templateFormat = config('fingerprint.http.template_format');
        $department = trim((string) $request->user()->organization?->college);
        $fingerprints = Fingerprint::query()
            ->where('organization_id', $request->user()->organization_id)
            ->where('template_format', $templateFormat)
            ->whereHas('user', function ($query) use ($data, $department, $eventId) {
                $query->where('account_status', 'active');
                if ($eventId !== null) {
                    $query->where('role', 'STUDENT');
                    if ($department !== '') {
                        $query->where('department', $department);
                    }
                    if (! empty($data['year_levels'])) {
                        $query->whereIn('year_level', $data['year_levels']);
                    }
                    if (! empty($data['programs'])) {
                        $query->whereIn('program', $data['programs']);
                    }
                    if (! empty($data['sections'])) {
                        $query->whereIn('section', $data['sections']);
                    }
                }
            })
            ->with('user:school_id,first_name,last_name,email,role,position_title,department,program,year_level,section,account_status')
            ->get();

        if ($fingerprints->isEmpty()) {
            return response()->json([
                'message' => $eventId === null
                    ? 'No active users in this organization have a compatible enrolled fingerprint.'
                    : 'No active Students match the required organization/department scope and optional academic filters.',
                'code' => 'no_enrollments',
            ], 422);
        }

        $usableFingerprints = collect();
        $candidates = [];
        foreach ($fingerprints as $fingerprint) {
            try {
                $template = $this->templates->decrypt($fingerprint->template);
            } catch (DecryptException) {
                continue;
            }

            $usableFingerprints->push($fingerprint);
            $candidates[] = [
                'id' => $fingerprint->id,
                'template' => $template,
                'template_format' => $fingerprint->template_format,
            ];
        }

        if ($usableFingerprints->isEmpty()) {
            return response()->json([
                'message' => 'No usable fingerprint enrollments are available. Re-enroll the affected users.',
                'code' => 'no_usable_enrollments',
            ], 422);
        }

        try {
            $matches = $this->matcher->identify(
                $candidates,
                $data['samples'],
                $data['sample_format'],
            );
        } catch (FingerprintMatcherUnavailable $exception) {
            return response()->json(['message' => $exception->getMessage(), 'code' => 'matcher_unavailable'], 503);
        } catch (FingerprintMatcherRejected $exception) {
            return response()->json(['message' => $exception->getMessage(), 'code' => 'capture_rejected'], 422);
        } catch (RuntimeException) {
            return response()->json(['message' => 'Fingerprint identification failed in the matching engine.'], 502);
        }

        $fingerprintsById = $usableFingerprints->keyBy('id');
        $candidates = collect($matches['candidates'])
            ->map(function (array $match) use ($fingerprintsById) {
                $fingerprint = $fingerprintsById->get($match['id']);
                if (! $fingerprint) {
                    return null;
                }

                return [
                    'matched' => $match['matched'],
                    'score' => (float) ($match['score'] ?? 0),
                    'threshold' => isset($match['threshold']) ? (float) $match['threshold'] : null,
                    'user' => $fingerprint->user,
                ];
            })
            ->filter()
            ->sortByDesc('score')
            ->values();

        $best = $candidates->first();
        $secondBest = $candidates->get(1);
        $minimumScore = max(60, (float) config('fingerprint.identification.minimum_score', 60));
        $effectiveThreshold = max($minimumScore, (float) ($best['threshold'] ?? 0));
        $minimumMargin = max(10, (float) config('fingerprint.identification.minimum_margin', 10));
        $scoreMargin = $best ? (float) $best['score'] - (float) ($secondBest['score'] ?? 0) : null;
        $ambiguous = $secondBest && $scoreMargin < $minimumMargin;
        $identified = (bool) ($best['matched'] ?? false)
            && (float) ($best['score'] ?? 0) >= $effectiveThreshold
            && ! $ambiguous;

        FingerprintVerification::create([
            'organization_id' => $request->user()->organization_id,
            'user_id' => $identified ? $best['user']->school_id : null,
            'performed_by' => $request->user()->school_id,
            'event_id' => $eventId,
            'result' => $identified ? 'matched' : 'not_matched',
            'score' => $best['score'] ?? null,
            'threshold' => $best ? $effectiveThreshold : null,
            'verified_at' => now(),
        ]);

        if (! $identified) {
            return response()->json([
                'message' => $ambiguous
                    ? 'The scan is too close to another enrolled fingerprint. Narrow the academic filters or scan again.'
                    : 'No enrolled user met the required fingerprint score. Try again with the finger flat and centered.',
                'code' => $ambiguous ? 'ambiguous_match' : 'no_match',
                'best' => $best ? ['score' => $best['score'], 'threshold' => $effectiveThreshold, 'margin' => $scoreMargin] : null,
            ], 422);
        }

        return [
            'identified' => true,
            'user' => $best['user'],
            'match' => [
                'score' => $best['score'],
                'threshold' => $effectiveThreshold,
                'margin' => $scoreMargin,
                'matcher_ms' => $matches['elapsed_ms'] ?? null,
            ],
        ];
    }

    private function attendanceAction(?Attendance $record): string
    {
        if (! $record) {
            return 'check_in';
        }

        return $record->check_out_time ? 'already_checked_out' : 'check_out';
    }

    private function audit(Request $request, string $action, User $user, array $values = []): void
    {
        AuditLog::create([
            'organization_id' => $request->user()->organization_id,
            'user_id' => $request->user()->school_id,
            'module' => 'biometrics',
            'action' => $action,
            'record_type' => User::class,
            'record_id' => $user->school_id,
            'old_values' => null,
            'new_values' => ['user_id' => $user->school_id, ...$values],
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);
    }

    private function fingerprintManagementDenial(User $actor, User $target): ?JsonResponse
    {
        if ($actor->role === 'SBO_OFFICER' && $target->role !== 'STUDENT') {
            return response()->json([
                'message' => 'SBO Officers can manage Student fingerprints only.',
            ], 403);
        }

        if ($target->role === 'SUPER_ADMIN' && $actor->school_id !== $target->school_id) {
            return response()->json([
                'message' => 'A super administrator fingerprint can only be changed by that account.',
            ], 403);
        }

        return null;
    }
}
