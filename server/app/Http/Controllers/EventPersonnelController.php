<?php

namespace App\Http\Controllers;

use App\Models\AccountProfile;
use App\Models\ApprovalRequest;
use App\Models\AuditLog;
use App\Models\Event;
use App\Models\EventPersonnel;
use App\Models\Notification;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class EventPersonnelController extends Controller
{
    private const AVAILABLE_LIMIT = 50;

    public function index(Request $request, $id): JsonResponse
    {
        $event = $this->readableEvent($request, $id);
        if (! $event instanceof Event) {
            return $event;
        }

        return response()->json(
            EventPersonnel::with('user:school_id,first_name,last_name')
                ->where('event_id', $event->id)
                ->orderBy('created_at')
                ->orderBy('id')
                ->get()
                ->map(fn (EventPersonnel $member) => $this->present($event, $member))
                ->values()
        );
    }

    /** Step 4.1: the active members of the event's organization who are not on its team yet. */
    public function available(Request $request, $id): JsonResponse
    {
        $event = $this->readableEvent($request, $id);
        if (! $event instanceof Event) {
            return $event;
        }

        $data = $request->validate(['q' => ['nullable', 'string', 'max:100']]);
        $term = trim((string) ($data['q'] ?? ''));
        $onTeam = EventPersonnel::where('event_id', $event->id)->pluck('user_school_id');

        $profiles = $this->memberProfiles($event)
            ->whereNotIn('account_profiles.user_school_id', $onTeam)
            ->when($term !== '', fn ($query) => $query->whereHas('user', fn ($user) => $user->where(function ($match) use ($term) {
                $like = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $term).'%';
                $match->where('first_name', 'like', $like)
                    ->orWhere('last_name', 'like', $like)
                    ->orWhere('email', 'like', $like);
            })))
            ->with('user:school_id,first_name,last_name,email')
            ->get()
            ->filter(fn (AccountProfile $profile) => $profile->user !== null)
            ->map(fn (AccountProfile $profile) => [
                'school_id' => $profile->user_school_id,
                'name' => trim($profile->user->first_name.' '.$profile->user->last_name),
                'email' => $profile->user->email,
                'position_title' => $profile->position_title,
            ])
            ->sortBy(fn (array $person) => Str::lower($person['name']))
            ->take(self::AVAILABLE_LIMIT)
            ->values();

        return response()->json($profiles);
    }

    public function store(Request $request, $id): JsonResponse
    {
        $event = Event::where('organization_id', $request->user()->organization_id)->find($id);
        if (! $event) {
            return response()->json(['message' => 'Event not found.'], 404);
        }

        $data = $request->validate([
            'user_school_id' => ['required', 'integer'],
            'role_label' => ['required', 'string', 'max:80'],
        ]);
        $roleLabel = trim($data['role_label']);
        if ($roleLabel === '') {
            return response()->json(['message' => 'Enter the role this person will have on the event.', 'errors' => ['role_label' => ['Enter the role this person will have on the event.']]], 422);
        }

        if ($blocked = $this->lockedMessage($event)) {
            return response()->json(['message' => $blocked], 409);
        }

        $profile = $this->memberProfiles($event)->where('account_profiles.user_school_id', $data['user_school_id'])->first();
        if (! $profile) {
            return response()->json(['message' => 'That person is not an active member of this organization.', 'errors' => ['user_school_id' => ['That person is not an active member of this organization.']]], 422);
        }

        $alreadyOnTeam = ['message' => 'That person is already on the event team.', 'errors' => ['user_school_id' => ['That person is already on the event team.']]];
        if (EventPersonnel::where('event_id', $event->id)->where('user_school_id', $data['user_school_id'])->exists()) {
            return response()->json($alreadyOnTeam, 422);
        }

        try {
            $member = DB::transaction(function () use ($request, $event, $data, $roleLabel) {
                $member = EventPersonnel::create([
                    'event_id' => $event->id,
                    'user_school_id' => $data['user_school_id'],
                    'role_label' => $roleLabel,
                    'assigned_by' => $request->user()->school_id,
                ]);
                $this->audit($request, $event, 'event_personnel_added', null, ['user_school_id' => $member->user_school_id, 'role_label' => $roleLabel]);
                $this->notifyAssigned($request, $event, $member);

                return $member;
            });
        } catch (UniqueConstraintViolationException) {
            return response()->json($alreadyOnTeam, 422);
        }

        return response()->json($this->present($event, $member->load('user:school_id,first_name,last_name')), 201);
    }

    public function destroy(Request $request, $id, $personnel): JsonResponse
    {
        $event = Event::where('organization_id', $request->user()->organization_id)->find($id);
        if (! $event) {
            return response()->json(['message' => 'Event not found.'], 404);
        }

        $member = EventPersonnel::where('event_id', $event->id)->find($personnel);
        if (! $member) {
            return response()->json(['message' => 'That person is not on the event team.'], 404);
        }

        if ($blocked = $this->lockedMessage($event)) {
            return response()->json(['message' => $blocked], 409);
        }

        DB::transaction(function () use ($request, $event, $member) {
            $member->delete();
            $this->audit($request, $event, 'event_personnel_removed', ['user_school_id' => $member->user_school_id, 'role_label' => $member->role_label], null);
        });

        return response()->json(['message' => 'Removed from the event team.']);
    }

    /** The event, or the error response to send: the same reach as the event details, so nobody reads a team the event hides from them. */
    private function readableEvent(Request $request, $id): Event|JsonResponse
    {
        $event = Event::whereIn('organization_id', $request->user()->contentOrganizationIds())->find($id);
        if (! $event) {
            return response()->json(['message' => 'Event not found.'], 404);
        }

        if ($request->user()->role === 'DEPARTMENT_HEAD' && ! in_array($event->status, ['approved', 'ongoing', 'completed'], true)
            && ! ApprovalRequest::where('entity_type', 'event')->where('entity_id', $event->id)->exists()) {
            return response()->json(['message' => 'Event not available.'], 403);
        }

        return $event;
    }

    private function lockedMessage(Event $event): ?string
    {
        return in_array($event->status, ['cancelled', 'completed'], true)
            ? "The event team cannot change once an event is {$event->status}."
            : null;
    }

    /** Active members of the event's organization who can be given a part: students, officers and administrators on an active account. */
    private function memberProfiles(Event $event)
    {
        return AccountProfile::where('account_profiles.organization_id', $event->organization_id)
            ->where('account_profiles.account_status', 'active')
            ->whereIn('account_profiles.role', AccountProfile::VOTER_ROLES)
            ->whereHas('user', fn ($user) => $user->where('users.account_status', 'active'));
    }

    private function present(Event $event, EventPersonnel $member): array
    {
        return [
            'id' => $member->id,
            'event_id' => $event->id,
            'user_school_id' => $member->user_school_id,
            'name' => $member->user ? trim($member->user->first_name.' '.$member->user->last_name) : (string) $member->user_school_id,
            'role_label' => $member->role_label,
            'created_at' => $member->created_at,
        ];
    }

    private function audit(Request $request, Event $event, string $action, ?array $old, ?array $new): void
    {
        AuditLog::create([
            'organization_id' => $event->organization_id,
            'user_id' => $request->user()->school_id,
            'actor_role' => $request->user()->profileRole(),
            'module' => 'events',
            'action' => $action,
            'record_type' => Event::class,
            'record_id' => $event->id,
            'old_values' => $old,
            'new_values' => $new,
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);
    }

    /** Tells the member they were put on the team, unless they put themselves there. */
    private function notifyAssigned(Request $request, Event $event, EventPersonnel $member): void
    {
        if ((int) $member->user_school_id === (int) $request->user()->school_id) {
            return;
        }

        Notification::create([
            'organization_id' => $event->organization_id,
            'user_id' => $member->user_school_id,
            'title' => 'Added to an Event Team',
            'message' => 'You are on the team for "'.Str::limit($event->title, 200).'" as '.$member->role_label.'.',
            'notification_type' => 'event',
            'reference_type' => Event::class,
            'reference_id' => $event->id,
            'is_read' => false,
            'sent_at' => now(),
        ]);
    }
}
