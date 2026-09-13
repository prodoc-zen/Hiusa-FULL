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
use Illuminate\Support\Facades\DB;
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

        try {
            $record = DB::transaction(function () use ($event, $user, $request) {
                if (Attendance::where('event_id', $event->id)->where('user_id', $user->school_id)->exists()) {
                    return null;
                }

                return Attendance::create([
                    'event_id' => $event->id,
                    'user_id' => $user->school_id,
                    'method' => 'biometric',
                    'status' => 'present',
                    'check_in_time' => now(),
                    'recorded_by' => $request->user()->school_id,
                    'remarks' => 'Identified with a single fingerprint scan.',
                ]);
            });
        } catch (UniqueConstraintViolationException) {
            $record = null;
        }

        if (! $record) {
            return response()->json([
                'message' => $user->first_name.' '.$user->last_name.' is already checked in for this event.',
                'user' => $result['user'],
            ], 409);
        }

        $this->audit($request, 'biometric_attendance_recorded', $user, ['event_id' => $event->id]);

        return response()->json([
            ...$result,
            'message' => $user->first_name.' '.$user->last_name.' was identified and checked in.',
            'attendance' => $record->load([
                'user:school_id,first_name,last_name',
                'recorder:school_id,first_name,last_name',
            ]),
        ], 201);
    }

    private function validateIdentification(Request $request): array
    {
        return $request->validate([
            // Identification deliberately accepts exactly one probe capture.
            'samples' => ['required', 'array', 'size:1'],
            'samples.0' => ['required', 'string', 'max:2097152'],
            'sample_format' => ['required', 'integer', 'in:5'],
        ]);
    }

    private function matchWithinOrganization(Request $request, array $data, ?int $eventId = null): array|JsonResponse
    {
        $templateFormat = config('fingerprint.http.template_format');
        $fingerprints = Fingerprint::query()
            ->where('organization_id', $request->user()->organization_id)
            ->where('template_format', $templateFormat)
            ->whereHas('user', fn ($query) => $query->where('account_status', 'active'))
            ->with('user:school_id,first_name,last_name,email,role,position_title,department,program,year_level,section,account_status')
            ->get();

        if ($fingerprints->isEmpty()) {
            return response()->json([
                'message' => 'No active users in this organization have a compatible enrolled fingerprint.',
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
        $identified = (bool) ($best['matched'] ?? false);

        FingerprintVerification::create([
            'organization_id' => $request->user()->organization_id,
            'user_id' => $identified ? $best['user']->school_id : null,
            'performed_by' => $request->user()->school_id,
            'event_id' => $eventId,
            'result' => $identified ? 'matched' : 'not_matched',
            'score' => $best['score'] ?? null,
            'threshold' => $best['threshold'] ?? null,
            'verified_at' => now(),
        ]);

        if (! $identified) {
            return response()->json([
                'message' => 'No enrolled user matched this fingerprint. Try again with the finger flat and centered.',
                'code' => 'no_match',
                'best' => $best ? ['score' => $best['score'], 'threshold' => $best['threshold']] : null,
            ], 422);
        }

        return [
            'identified' => true,
            'user' => $best['user'],
            'match' => [
                'score' => $best['score'],
                'threshold' => $best['threshold'],
                'matcher_ms' => $matches['elapsed_ms'] ?? null,
            ],
        ];
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
        if ($target->role === 'SUPER_ADMIN' && $actor->school_id !== $target->school_id) {
            return response()->json([
                'message' => 'A super administrator fingerprint can only be changed by that account.',
            ], 403);
        }

        return null;
    }
}
