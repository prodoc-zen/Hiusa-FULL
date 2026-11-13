<?php

namespace App\Http\Controllers;

use App\Models\AccountProfile;
use App\Models\ApprovalRequest;
use App\Models\AuditLog;
use App\Models\Election;
use App\Models\Notification;
use App\Models\User;
use App\Services\OfficerAppointmentService;
use App\Services\OrganizationRecipients;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * The exceptional states of an election (suspended, resumed, cancelled) and the trail of its approval decisions.
 * Phases themselves move through the phase engine; this controller only halts and releases them.
 */
class ElectionGovernanceController extends Controller
{
    private const HISTORY_APPROVAL_ACTIONS = ['submitted', 'resubmitted', 'reviewed_approved', 'reviewed_rejected'];

    public function __construct(
        private readonly OrganizationRecipients $recipients,
        private readonly OfficerAppointmentService $appointments,
    ) {}

    public function suspend(Request $request, $id)
    {
        $data = $request->validate(['reason' => ['required', 'string', 'max:500']]);

        return $this->transition($request, $id, 'suspended', function (Election $election): ?string {
            return match (true) {
                $election->cancelled_at !== null => 'This election was cancelled.',
                $this->isFinished($election) => 'A finished election cannot be suspended.',
                $election->suspended_at !== null => 'This election is already suspended.',
                $election->approved_at === null => 'Only an approved election can be suspended.',
                default => null,
            };
        }, fn (Election $election) => $election->update(['suspended_at' => now(), 'halt_reason' => $data['reason']]), $data['reason']);
    }

    public function resume(Request $request, $id)
    {
        return $this->transition($request, $id, 'resumed', function (Election $election): ?string {
            return match (true) {
                $election->cancelled_at !== null => 'This election was cancelled.',
                $election->suspended_at === null => 'This election is not suspended.',
                default => null,
            };
        }, fn (Election $election) => $election->update(['suspended_at' => null, 'halt_reason' => null]), null);
    }

    public function cancel(Request $request, $id)
    {
        $data = $request->validate(['reason' => ['required', 'string', 'max:500']]);

        return $this->transition($request, $id, 'cancelled', function (Election $election): ?string {
            return match (true) {
                $election->cancelled_at !== null => 'This election is already cancelled.',
                $this->isFinished($election) => 'A completed election cannot be cancelled.',
                default => null,
            };
        }, function (Election $election) use ($data, $request) {
            $election->update([
                'cancelled_at' => now(),
                'halt_reason' => $data['reason'],
                'status' => 'closed',
                'results_visible' => false,
                'phase' => 'cancelled',
            ]);
            // Winners already prepared from a released result must never receive the role, nor the officers they replace lose it.
            $this->appointments->voidForCancelled($election, $request->user()->school_id, $request->ip());
        }, $data['reason']);
    }

    /** Oldest first: what the Admin submitted, what the reviewer decided and when approval was reopened. */
    public function approvalHistory(Request $request, $id)
    {
        $user = $request->user();
        $election = Election::with('organization:id,is_university_wide')->find($id);
        if (! $election || ! $this->canReadHistory($user, $election)) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        $approvalIds = ApprovalRequest::where('organization_id', $election->organization_id)
            ->where('entity_type', 'election')
            ->where('entity_id', $election->id)
            ->pluck('id');

        // A reviewer never sees a draft the Admin has not submitted.
        if ($approvalIds->isEmpty() && $election->submitted_at === null && in_array($user->role, ['DEPARTMENT_HEAD', 'SUPER_ADMIN'], true)) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        // Submissions and decisions come from the approval trail; the election trail adds only the reopenings.
        $rows = AuditLog::query()
            ->where(function ($trail) use ($approvalIds, $election) {
                $trail->where(fn ($approvals) => $approvals->where('module', 'approvals')
                    ->where('record_type', ApprovalRequest::class)
                    ->whereIn('record_id', $approvalIds)
                    ->whereIn('action', self::HISTORY_APPROVAL_ACTIONS))
                    ->orWhere(fn ($reopened) => $reopened->where('module', 'elections')
                        ->where('record_type', Election::class)
                        ->where('record_id', $election->id)
                        ->where('action', 'approval_reopened'));
            })
            ->orderBy('created_at')
            ->orderBy('id')
            ->get();

        $names = User::whereIn('school_id', $rows->pluck('user_id')->filter()->unique())
            ->get(['school_id', 'first_name', 'last_name', 'role'])
            ->keyBy('school_id');

        return response()->json($rows->map(function (AuditLog $row) use ($names) {
            $actor = $names->get($row->user_id);
            $values = $row->new_values ?? [];

            return [
                'action' => $this->historyAction($row),
                'actor_name' => $actor ? trim($actor->first_name.' '.$actor->last_name) : null,
                'actor_role' => $row->actor_role ?? $actor?->role,
                'remarks' => $values['remarks'] ?? null,
                'at' => $row->created_at?->toISOString(),
                'rules_version' => $values['rules_version'] ?? null,
            ];
        })->values());
    }

    private function historyAction(AuditLog $row): string
    {
        return match ($row->action) {
            'reviewed_approved' => 'approved',
            'reviewed_rejected' => ($row->new_values['final'] ?? false) ? 'declined' : 'returned',
            default => $row->action,
        };
    }

    private function canReadHistory(User $user, Election $election): bool
    {
        if ($user->role === 'SUPER_ADMIN') {
            return (bool) $election->organization?->is_university_wide;
        }

        return in_array((int) $election->organization_id, array_map('intval', $user->scopedOrganizationIds()), true);
    }

    /** Done for good, or closed before phases existed: nothing is left to halt or cancel. */
    private function isFinished(Election $election): bool
    {
        return $election->completed_at !== null
            || $election->phase === 'completed'
            || ($election->status === 'closed' && $election->phase === null);
    }

    /**
     * One state change under a row lock: refuse it when the guard names a reason, otherwise apply it, write the audit row and
     * tell the reviewer and the other Admins.
     */
    private function transition(Request $request, $id, string $action, callable $guard, callable $apply, ?string $reason)
    {
        $user = $request->user();
        $election = Election::where('organization_id', $user->organization_id)->find($id);
        if (! $election) {
            return response()->json(['message' => 'Election not found'], 404);
        }

        $refusal = null;
        $old = null;
        DB::transaction(function () use ($election, $guard, $apply, &$refusal, &$old) {
            $locked = Election::whereKey($election->id)->lockForUpdate()->firstOrFail();
            $refusal = $guard($locked);
            if ($refusal !== null) {
                return;
            }
            $old = $this->stateOf($locked);
            $apply($locked);
        });
        if ($refusal !== null) {
            return response()->json(['message' => $refusal], 409);
        }

        $election->refresh();
        AuditLog::create([
            'organization_id' => $election->organization_id,
            'user_id' => $user->school_id,
            'actor_role' => $user->role,
            'module' => 'elections',
            'action' => $action,
            'description' => 'Election '.$action.' by the Admin.',
            'record_type' => Election::class,
            'record_id' => $election->id,
            'old_values' => $old,
            'new_values' => array_filter(['reason' => $reason, ...$this->stateOf($election)], fn ($value) => $value !== null),
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);
        $this->notifyHalt($election, $action, $reason, $user->school_id);

        return response()->json($election->fresh());
    }

    private function stateOf(Election $election): array
    {
        return [
            'status' => $election->status,
            'phase' => $election->phase,
            'suspended_at' => $election->suspended_at?->toISOString(),
            'cancelled_at' => $election->cancelled_at?->toISOString(),
        ];
    }

    /** The organization's reviewer and its active Admins, except the person who acted. */
    private function notifyHalt(Election $election, string $action, ?string $reason, int $actorSchoolId): void
    {
        $title = 'Election '.$action;
        $message = '"'.$election->title.'" was '.$action.($reason !== null ? ': '.$reason : '.');
        $now = now();

        $recipients = $this->reviewers($election)
            ->concat($this->recipients->administrators($election->organization_id))
            ->reject(fn ($recipient) => (int) $recipient->user_school_id === $actorSchoolId)
            ->unique(fn ($recipient) => $recipient->user_school_id.'-'.$recipient->organization_id);

        foreach ($recipients->chunk(500) as $chunk) {
            Notification::insert($chunk->map(fn ($recipient) => [
                'organization_id' => $recipient->organization_id,
                'user_id' => $recipient->user_school_id,
                'title' => $title,
                'message' => $message,
                'notification_type' => 'election',
                'reference_type' => 'election',
                'reference_id' => $election->id,
                'is_read' => false,
                'sent_at' => $now,
                'created_at' => $now,
                'updated_at' => $now,
            ])->all());
        }
    }

    /** Who decides this organization's elections: the college's Department Heads, or the SAO for a university-wide organization. */
    private function reviewers(Election $election): Collection
    {
        $organization = $election->organization()->first(['id', 'college_id', 'is_university_wide']);
        $role = $organization->approvalRole(config('approvals.routes.election'));

        return AccountProfile::query()
            ->where('role', $role)
            ->where('account_status', 'active')
            ->whereHas('organization', function ($home) use ($role, $organization) {
                if ($role === 'SUPER_ADMIN') {
                    $home->where('organization_type', 'SYSTEM_ADMINISTRATION');
                } else {
                    $home->where('organization_type', 'COLLEGE')->where('college_id', $organization->college_id);
                }
            })
            ->get(['user_school_id', 'organization_id']);
    }
}
