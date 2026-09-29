<?php

namespace App\Http\Controllers;

use App\Models\ApprovalRequest;
use App\Models\Attendance;
use App\Models\AuditLog;
use App\Models\Event;
use App\Models\EventRegistration;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class EventRegistrationController extends Controller
{
    public function store(Request $request, $id)
    {
        $user = $request->user();
        $event = Event::where('organization_id', $user->organization_id)->find($id);

        if (! $event) {
            return response()->json(['message' => 'Event not found.'], 404);
        }

        if (! $this->isVisible($event, $user)) {
            return response()->json(['message' => 'Event not available.'], 403);
        }

        if (! $this->isRegistrable($event)) {
            return response()->json(['message' => 'This event is not open for registration.'], 422);
        }

        return DB::transaction(function () use ($event, $user, $request) {
            $existing = EventRegistration::where('event_id', $event->id)
                ->where('user_id', $user->school_id)
                ->lockForUpdate()
                ->first();

            if ($existing && $existing->status === 'attended') {
                return response()->json(['message' => 'You have already attended this event.'], 409);
            }
            if ($existing && $existing->status === 'registered') {
                return response()->json(['message' => 'You are already registered for this event.'], 409);
            }

            $capacity = $this->capacityFor($event);
            $activeCount = null;
            if ($capacity !== null) {
                $activeCount = EventRegistration::where('event_id', $event->id)
                    ->whereIn('status', ['registered', 'attended'])
                    ->lockForUpdate()
                    ->count();

                if ($activeCount >= $capacity) {
                    return response()->json([
                        'message' => 'This event has reached its registration capacity. Please check back in case a spot opens up.',
                    ], 409);
                }
            }

            if ($existing) {
                $existing->forceFill(['status' => 'registered', 'registered_at' => now(), 'cancelled_at' => null])->save();
                $registration = $existing;
            } else {
                $registration = EventRegistration::create([
                    'event_id' => $event->id,
                    'organization_id' => $event->organization_id,
                    'user_id' => $user->school_id,
                    'status' => 'registered',
                    'registered_at' => now(),
                ]);
            }

            AuditLog::create([
                'organization_id' => $event->organization_id,
                'user_id' => $user->school_id,
                'module' => 'event_registrations',
                'action' => 'registered',
                'record_type' => EventRegistration::class,
                'record_id' => $registration->id,
                'new_values' => ['event_id' => $event->id, 'status' => 'registered'],
                'ip_address' => $request->ip(),
                'created_at' => now(),
            ]);

            if ($capacity !== null && $activeCount + 1 >= $capacity) {
                $this->notifyOrganizersOfCapacity($event, $capacity);
            }

            return response()->json($registration->load('event:id,title,start_time,end_time,location'), 201);
        });
    }

    public function destroyMine(Request $request, $id)
    {
        $user = $request->user();
        $event = Event::where('organization_id', $user->organization_id)->find($id);

        if (! $event) {
            return response()->json(['message' => 'Event not found.'], 404);
        }

        $registration = EventRegistration::where('event_id', $event->id)
            ->where('user_id', $user->school_id)
            ->first();

        if (! $registration || $registration->status === 'cancelled') {
            return response()->json(['message' => 'You are not registered for this event.'], 404);
        }

        if ($registration->status === 'attended') {
            return response()->json(['message' => 'You have already attended this event and cannot cancel your registration.'], 422);
        }

        if (! $event->start_time->isFuture()) {
            return response()->json(['message' => 'This event has already started; registration can no longer be cancelled.'], 422);
        }

        $registration->forceFill(['status' => 'cancelled', 'cancelled_at' => now()])->save();

        AuditLog::create([
            'organization_id' => $event->organization_id,
            'user_id' => $user->school_id,
            'module' => 'event_registrations',
            'action' => 'cancelled',
            'record_type' => EventRegistration::class,
            'record_id' => $registration->id,
            'new_values' => ['event_id' => $event->id, 'status' => 'cancelled'],
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);

        return response()->json($registration->fresh());
    }

    public function index(Request $request, $id)
    {
        $event = Event::where('organization_id', $request->user()->organization_id)->find($id);

        if (! $event) {
            return response()->json(['message' => 'Event not found.'], 404);
        }

        $filters = $request->validate([
            'status' => ['nullable', 'in:registered,cancelled,attended,no_show'],
            'page' => ['nullable', 'integer', 'min:1'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $counts = EventRegistration::where('event_id', $event->id)
            ->selectRaw('status, count(*) as total')
            ->groupBy('status')
            ->pluck('total', 'status');
        $capacity = $this->capacityFor($event);
        $activeCount = ($counts['registered'] ?? 0) + ($counts['attended'] ?? 0);

        $query = EventRegistration::with('user:school_id,first_name,last_name,email,role,position_title,department,program,major,year_level,section')
            ->where('event_id', $event->id);

        if (! empty($filters['status'])) {
            $query->where('status', $filters['status']);
        }

        $registrations = $query->orderByDesc('registered_at')->orderByDesc('id')->paginate($filters['per_page'] ?? 20);

        $attendanceByUser = Attendance::where('event_id', $event->id)
            ->whereIn('user_id', collect($registrations->items())->pluck('user_id'))
            ->get()
            ->keyBy('user_id');

        $registrations->getCollection()->transform(function (EventRegistration $registration) use ($attendanceByUser) {
            $attendance = $attendanceByUser->get($registration->user_id);
            $registration->setAttribute('attendance', $attendance ? [
                'status' => $attendance->status,
                'check_in_time' => $attendance->check_in_time,
                'check_out_time' => $attendance->check_out_time,
            ] : null);

            return $registration;
        });

        return response()->json([
            'event' => $event->only(['id', 'title', 'start_time', 'end_time', 'status']),
            'summary' => [
                'capacity' => $capacity,
                'registered' => $counts['registered'] ?? 0,
                'attended' => $counts['attended'] ?? 0,
                'cancelled' => $counts['cancelled'] ?? 0,
                'no_show' => $counts['no_show'] ?? 0,
                'remaining' => $capacity !== null ? max(0, $capacity - $activeCount) : null,
            ],
            'registrations' => $registrations->items(),
            'pagination' => [
                'current_page' => $registrations->currentPage(),
                'last_page' => $registrations->lastPage(),
                'per_page' => $registrations->perPage(),
                'total' => $registrations->total(),
            ],
        ]);
    }

    public function mine(Request $request)
    {
        $user = $request->user();

        $registrations = EventRegistration::with('event:id,title,start_time,end_time,location,status')
            ->where('organization_id', $user->organization_id)
            ->where('user_id', $user->school_id)
            ->whereHas('event')
            ->get();

        $upcoming = $registrations
            ->filter(fn (EventRegistration $registration) => $registration->status === 'registered' && $registration->event->start_time->isFuture())
            ->sortBy(fn (EventRegistration $registration) => $registration->event->start_time)
            ->values();

        $past = $registrations
            ->reject(fn (EventRegistration $registration) => $upcoming->contains('id', $registration->id))
            ->sortByDesc(fn (EventRegistration $registration) => $registration->event->start_time)
            ->values();

        return response()->json([
            'upcoming' => $upcoming,
            'past' => $past,
        ]);
    }

    private function isVisible(Event $event, User $user): bool
    {
        if ($user->role === 'ADMIN') {
            return true;
        }

        if (in_array($event->status, ['approved', 'ongoing', 'completed'], true)) {
            return true;
        }

        return $user->role === 'DEPARTMENT_HEAD'
            && ApprovalRequest::where('entity_type', 'event')->where('entity_id', $event->id)->exists();
    }

    private function isRegistrable(Event $event): bool
    {
        return $event->status === 'approved' && $event->start_time->isFuture();
    }

    private function capacityFor(Event $event): ?int
    {
        $capacity = data_get($event->planning_details, 'expected_participants');

        return $capacity !== null ? (int) $capacity : null;
    }

    private function notifyOrganizersOfCapacity(Event $event, int $capacity): void
    {
        $organizers = User::whereHas('accountProfiles', fn ($profiles) => $profiles
            ->where('organization_id', $event->organization_id)
            ->whereIn('role', ['ADMIN', 'SBO_OFFICER'])
            ->where('account_status', 'active'))
            ->get(['school_id']);

        foreach ($organizers as $organizer) {
            Notification::firstOrCreate([
                'organization_id' => $event->organization_id,
                'user_id' => $organizer->school_id,
                'title' => 'Event at Capacity',
                'reference_type' => Event::class,
                'reference_id' => $event->id,
            ], [
                'message' => "\"{$event->title}\" has reached its registration capacity of {$capacity}.",
                'notification_type' => 'event',
                'is_read' => false,
                'sent_at' => now(),
            ]);
        }
    }
}
