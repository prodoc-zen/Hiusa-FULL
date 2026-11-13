<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\Election;
use App\Models\Notification;
use App\Models\OfficerAppointment;
use App\Models\OfficerHandover;
use App\Models\Organization;
use App\Models\OrganizationComplianceSubmission;
use App\Models\User;
use App\Support\NotFound;
use App\Support\RenewalDeadline;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * Officer Transition: the directory and history of officers, the six handover items between the outgoing and the
 * incoming administration, and the renewal tracker. Everything is read from live data; nothing here stores a deadline.
 */
class OfficerTransitionController extends Controller
{
    private const CATEGORY_LABELS = [
        'finance' => 'Finance',
        'events' => 'Events',
        'tasks' => 'Tasks',
        'organization' => 'Organization records',
        'election' => 'Election results',
        'compliance' => 'Compliance',
    ];

    private const ACKNOWLEDGE_MESSAGE = 'Receipt acknowledged. Acknowledging confirms receipt only; it does not accept responsibility for anything that was not handed over.';

    public function officers(Request $request)
    {
        $filters = $request->validate([
            'academic_year' => ['nullable', 'string', 'max:20'],
            'position' => ['nullable', 'string', 'max:100'],
            'status' => ['nullable', 'in:upcoming,active,former'],
        ]);
        $scope = $this->scope($request);

        $appointments = OfficerAppointment::query()
            ->with(['user:school_id,first_name,last_name', 'organization:id,name', 'election:id,title'])
            ->when($scope !== null, fn ($query) => $query->whereIn('organization_id', $scope))
            ->when($filters['academic_year'] ?? null, fn ($query, $year) => $query->where('academic_year', $year))
            ->when($filters['position'] ?? null, fn ($query, $title) => $query->where('position_title', 'like', '%'.addcslashes($title, '%_\\').'%'))
            ->when($filters['status'] ?? null, fn ($query, $status) => $query->where('status', $status === 'former' ? 'ended' : $status))
            ->orderByDesc('id')
            ->paginate(20)
            ->through(fn (OfficerAppointment $appointment) => [
                'id' => $appointment->id,
                'school_id' => $appointment->user_school_id,
                'name' => $this->personName($appointment->user),
                'position_title' => $appointment->position_title,
                'is_executive' => $appointment->is_executive,
                'role' => $appointment->role,
                'organization' => $appointment->organization?->name,
                'academic_year' => $appointment->academic_year,
                'term_starts_on' => $appointment->term_starts_on?->toDateString(),
                'term_ends_on' => $appointment->term_ends_on?->toDateString(),
                'status' => $appointment->status,
                'kind' => $appointment->kind,
                'flag' => $appointment->flag,
                'election' => $appointment->election ? ['id' => $appointment->election->id, 'title' => $appointment->election->title] : null,
            ]);

        return response()->json($appointments);
    }

    public function handover(Request $request)
    {
        $scope = $this->scope($request);

        // The handover in force belongs to the election that closed last among those that have items.
        $electionId = OfficerHandover::query()
            ->join('elections', 'elections.id', '=', 'officer_handovers.election_id')
            ->when($scope !== null, fn ($query) => $query->whereIn('officer_handovers.organization_id', $scope))
            ->orderByDesc('elections.end_time')
            ->orderByDesc('elections.id')
            ->value('officer_handovers.election_id');

        if (! $electionId) {
            return response()->json(['election' => null, 'organization' => null, 'my_side' => null, 'can_prepare' => false, 'can_acknowledge' => false, 'items' => []]);
        }

        $election = Election::query()->findOrFail($electionId, ['id', 'title', 'organization_id']);
        $user = $request->user();
        $items = OfficerHandover::where('election_id', $election->id)->orderBy('id')->get();
        $people = User::whereIn('school_id', $items->pluck('prepared_by')->merge($items->pluck('acknowledged_by'))->filter()->unique())
            ->get(['school_id', 'first_name', 'last_name'])->keyBy('school_id');

        return response()->json([
            'election' => ['id' => $election->id, 'title' => $election->title],
            'organization' => ['id' => $election->organization_id, 'name' => Organization::whereKey($election->organization_id)->value('name')],
            'my_side' => OfficerAppointment::sideOf($user->school_id, $election->id),
            'can_prepare' => $this->mayPrepare($user, $election->organization_id, $election->id),
            'can_acknowledge' => $this->mayAcknowledge($user, $election->organization_id, $election->id),
            'items' => $items->map(fn (OfficerHandover $item) => [
                ...$this->itemResponse($item),
                'prepared_by' => $this->personName($people->get($item->prepared_by)),
                'acknowledged_by' => $this->personName($people->get($item->acknowledged_by)),
            ])->values(),
        ]);
    }

    public function prepare(Request $request, $handover)
    {
        $user = $request->user();
        $item = $this->itemInScope($request, $handover);

        abort_unless($this->mayPrepare($user, $item->organization_id, $item->election_id), 403, 'Only the outgoing administration prepares a handover item.');
        abort_if($item->status === 'acknowledged', 409, 'This item was acknowledged and is now read only.');

        $data = $request->validate([
            'remarks' => ['nullable', 'string', 'max:2000'],
            'reference_url' => ['nullable', 'string', 'max:255', 'starts_with:/dashboard/'],
            'attachment' => ['nullable', 'file', 'mimes:pdf,doc,docx,xls,xlsx,jpg,jpeg,png', 'extensions:pdf,doc,docx,xls,xlsx,jpg,jpeg,png', 'max:10240'],
        ]);

        $incoming = OfficerAppointment::where('election_id', $item->election_id)->where('kind', 'incoming');
        $underReview = (clone $incoming)->where('status', 'active')->exists();
        $oldPath = $item->attachment_path;

        DB::transaction(function () use ($request, $user, $item, $data, $underReview) {
            $item->fill([
                'remarks' => array_key_exists('remarks', $data) ? $data['remarks'] : $item->remarks,
                'reference_url' => ! empty($data['reference_url']) ? $data['reference_url'] : $item->reference_url,
                'status' => $underReview ? 'under_review' : 'prepared',
                'prepared_by' => $user->school_id,
                'prepared_at' => now(),
            ]);

            if ($request->hasFile('attachment')) {
                $file = $request->file('attachment');
                $item->attachment_path = Storage::disk('local')->putFile('officer-handovers/'.$item->organization_id, $file);
                $item->attachment_name = $file->getClientOriginalName();
            }

            $item->save();
            $this->audit($request, 'handover_prepared', $item, ['election_id' => $item->election_id, 'category' => $item->category, 'status' => $item->status]);
        });

        if ($oldPath && $oldPath !== $item->attachment_path) {
            Storage::disk('local')->delete($oldPath);
        }

        $label = self::CATEGORY_LABELS[$item->category] ?? $item->category;
        $recipients = (clone $incoming)->whereIn('status', ['upcoming', 'active'])->pluck('user_school_id')->unique();
        $this->notify($item, $recipients, 'Handover prepared: '.$label, 'The outgoing officers prepared the '.strtolower($label).' handover item. Open Officer Transition to read it.');

        return response()->json(['message' => 'Handover item saved.', 'item' => $this->itemResponse($item->fresh())]);
    }

    public function acknowledge(Request $request, $handover)
    {
        $user = $request->user();
        $item = $this->itemInScope($request, $handover);

        abort_unless($this->mayAcknowledge($user, $item->organization_id, $item->election_id), 403, 'Only an incoming officer whose term has started acknowledges a handover item.');
        abort_unless(in_array($item->status, ['prepared', 'under_review'], true), 409, 'Only a prepared item can be acknowledged, and only once.');

        DB::transaction(function () use ($request, $user, $item) {
            $item->update(['status' => 'acknowledged', 'acknowledged_by' => $user->school_id, 'acknowledged_at' => now()]);
            $this->audit($request, 'handover_acknowledged', $item, ['election_id' => $item->election_id, 'category' => $item->category]);
        });

        if ($item->prepared_by) {
            $label = self::CATEGORY_LABELS[$item->category] ?? $item->category;
            $this->notify($item, collect([$item->prepared_by]), 'Handover acknowledged: '.$label, $this->personName($user).' confirmed receipt of the '.strtolower($label).' handover item.');
        }

        return response()->json(['message' => self::ACKNOWLEDGE_MESSAGE, 'item' => $this->itemResponse($item->fresh())]);
    }

    public function attachment(Request $request, $handover)
    {
        $item = $this->itemInScope($request, $handover);
        $path = $item->attachment_path;

        if (! $path || ! Storage::disk('local')->exists($path)) {
            return response()->json(['message' => 'Attachment not found.'], 404);
        }

        $extension = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        $response = response()->file(Storage::disk('local')->path($path), [
            'Content-Type' => [
                'pdf' => 'application/pdf',
                'png' => 'image/png',
                'jpg' => 'image/jpeg',
                'jpeg' => 'image/jpeg',
                'doc' => 'application/msword',
                'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'xls' => 'application/vnd.ms-excel',
                'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            ][$extension] ?? 'application/octet-stream',
            'X-Content-Type-Options' => 'nosniff',
        ]);
        $response->setContentDisposition('inline', 'handover-'.$item->id.'.'.$extension);
        $response->setPrivate();
        $response->headers->addCacheControlDirective('no-store');

        return $response;
    }

    public function renewal(Request $request)
    {
        $scope = $this->scope($request);
        $organization = Organization::student()
            ->when($scope !== null, fn ($query) => $query->whereIn('id', $scope))
            ->orderBy('name')
            ->first(['id', 'name']);

        if (! $organization) {
            return response()->json(['organization' => null, 'deadline_at' => null, 'requirements' => [], 'progress' => ['done' => 0, 'total' => 0], 'assigned_officers' => [], 'last_updated' => null]);
        }

        $types = RenewalDeadline::types($organization->id);
        $submissions = OrganizationComplianceSubmission::where('organization_id', $organization->id)
            ->whereIn('requirement_type_id', $types->pluck('id'))
            ->orderBy('id')
            ->get()
            ->keyBy('requirement_type_id');

        $requirements = $types->map(function ($type) use ($submissions) {
            $submission = $submissions->get($type->id);
            $status = $submission->status ?? 'not_submitted';

            return [
                'id' => $type->id,
                'name' => $type->name,
                'description' => $type->description,
                'deadline_at' => $type->deadline_at,
                'status' => $status,
                'submitted_at' => $submission?->submitted_at,
                'overdue' => $type->deadline_at !== null && $type->deadline_at->isPast() && ! $this->isSubmitted($status),
            ];
        })->values();

        $officers = OfficerAppointment::where('organization_id', $organization->id)
            ->where('kind', 'incoming')
            ->where('role', 'ADMIN')
            ->whereIn('status', ['active', 'upcoming'])
            ->with('user:school_id,first_name,last_name')
            ->orderBy('id')
            ->get();

        return response()->json([
            'organization' => ['id' => $organization->id, 'name' => $organization->name],
            'deadline_at' => RenewalDeadline::for($organization->id),
            'requirements' => $requirements,
            'progress' => ['done' => $requirements->filter(fn (array $row) => $this->isSubmitted($row['status']))->count(), 'total' => $requirements->count()],
            'assigned_officers' => $officers->map(fn (OfficerAppointment $appointment) => [
                'name' => $this->personName($appointment->user),
                'position' => $appointment->position_title,
                'status' => $appointment->status,
            ])->values(),
            'last_updated' => $submissions->flatMap(fn ($submission) => [$submission->submitted_at, $submission->reviewed_at])->filter()->max(),
        ]);
    }

    /**
     * The organizations the caller may read, or null for every one. An Admin or an officer reads their own, a Department
     * Head the college, a Super Admin any; `organization_id` narrows inside that and anything outside it is not found.
     *
     * @return array<int, int>|null
     */
    private function scope(Request $request): ?array
    {
        $user = $request->user();
        $filter = $request->validate(['organization_id' => ['nullable', 'integer']]);
        $scope = $user->profileRole() === 'SUPER_ADMIN' ? null : $user->scopedOrganizationIds();

        if (isset($filter['organization_id'])) {
            $requested = (int) $filter['organization_id'];
            NotFound::unless($scope === null ? Organization::whereKey($requested)->exists() : in_array($requested, $scope, true));

            return [$requested];
        }

        return $scope;
    }

    private function itemInScope(Request $request, $handover): OfficerHandover
    {
        $item = OfficerHandover::query()->find($handover);
        $scope = $this->scope($request);
        NotFound::unless($item !== null && ($scope === null || in_array((int) $item->organization_id, $scope, true)));

        return $item;
    }

    /** The outgoing administration prepares: its active officers, or the organization's Admin when that Admin is not an incoming appointee. */
    private function mayPrepare(User $user, int $organizationId, int $electionId): bool
    {
        $appointments = OfficerAppointment::where('election_id', $electionId)->where('user_school_id', $user->school_id);

        if ((clone $appointments)->where('kind', 'incoming')->exists()) {
            return false;
        }

        if ((clone $appointments)->where('kind', 'outgoing')->where('status', 'active')->where('organization_id', $organizationId)->exists()) {
            return true;
        }

        return $user->isOrganizationAdmin() && (int) $user->organization_id === $organizationId;
    }

    /** Only an incoming officer whose term has started acknowledges. */
    private function mayAcknowledge(User $user, int $organizationId, int $electionId): bool
    {
        return OfficerAppointment::where('election_id', $electionId)
            ->where('organization_id', $organizationId)
            ->where('user_school_id', $user->school_id)
            ->where('kind', 'incoming')
            ->where('status', 'active')
            ->exists();
    }

    private function isSubmitted(string $status): bool
    {
        return in_array($status, ['submitted', 'approved'], true);
    }

    private function personName(?User $person): ?string
    {
        return $person ? trim($person->first_name.' '.$person->last_name) : null;
    }

    private function itemResponse(OfficerHandover $item): array
    {
        return [
            'id' => $item->id,
            'category' => $item->category,
            'label' => self::CATEGORY_LABELS[$item->category] ?? ucfirst($item->category),
            'reference_url' => $item->reference_url,
            'remarks' => $item->remarks,
            'attachment_name' => $item->attachment_path ? $item->attachment_name : null,
            'open_url' => $item->attachment_path ? '/officer-transition/handover/'.$item->id.'/attachment' : null,
            'status' => $item->status,
            'prepared_at' => $item->prepared_at,
            'acknowledged_at' => $item->acknowledged_at,
        ];
    }

    private function notify(OfficerHandover $item, $schoolIds, string $title, string $message): void
    {
        foreach ($schoolIds as $schoolId) {
            Notification::create([
                'organization_id' => $item->organization_id,
                'user_id' => $schoolId,
                'title' => $title,
                'message' => $message,
                'notification_type' => 'election',
                'reference_type' => 'election',
                'reference_id' => $item->election_id,
                'is_read' => false,
                'sent_at' => now(),
            ]);
        }
    }

    private function audit(Request $request, string $action, OfficerHandover $item, array $values): void
    {
        AuditLog::create([
            'organization_id' => $item->organization_id,
            'user_id' => $request->user()->school_id,
            'module' => 'records',
            'action' => $action,
            'record_type' => 'officer_handover',
            'record_id' => $item->id,
            'old_values' => null,
            'new_values' => $values,
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);
    }
}
