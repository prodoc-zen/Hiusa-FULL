<?php

namespace App\Services\Dashboard;

use App\Models\ApprovalRequest;
use App\Models\User;
use App\Services\ApprovalEntityLabel;
use App\Services\Compliance\AccreditationStatusService;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Builds the single role-aware payload behind GET /api/dashboard/briefing.
 * Every query here is either a bounded aggregate (COUNT/SUM/GROUP BY that
 * does not grow with total record volume) or capped with a LIMIT before any
 * per-row fan-out, so the endpoint's query count stays flat as an
 * organization's history grows. See docs/api/dashboard-briefing.md for the
 * response contract.
 */
class DashboardBriefingService
{
    private const ATTENTION_LIMIT = 8;

    private const AGENDA_LIMIT = 5;

    private const ACTIVITY_LIMIT = 8;

    /**
     * Grievance urgency is stored exactly as GrievanceController's
     * classifier writes it (both its AI-backed path and its
     * localClassification() fallback, mirrored in
     * ai-service/app/engines/grievance_classification.py): 'Low', 'Medium',
     * 'High', 'Critical' - capitalized. MariaDB's default collation is
     * case-insensitive so a lowercase comparison here used to pass there and
     * silently undercount on SQLite/case-sensitive collations. Compare
     * against this constant, never a re-typed literal.
     */
    private const URGENT_GRIEVANCE_URGENCIES = ['High', 'Critical'];

    private const TYPE_LABELS = [
        'approval' => ['approval', 'approvals'],
        'election_closing' => ['closing election', 'closing elections'],
        'election_open' => ['election to vote in', 'elections to vote in'],
        'budget_utilization' => ['budget nearing its limit', 'budgets nearing their limit'],
        'task_overdue' => ['overdue task', 'overdue tasks'],
        'task_due_soon' => ['task due soon', 'tasks due soon'],
        'financial_report_returned' => ['returned financial report', 'returned financial reports'],
        'financial_report_due' => ['financial report due', 'financial reports due'],
        'order_verification' => ['order to verify', 'orders to verify'],
        'order_ready_to_claim' => ['order ready to claim', 'orders ready to claim'],
        'event_attendance_due' => ['event needing attendance', 'events needing attendance'],
        'event_today' => ['event today', 'events today'],
        'event_needs_closing' => ['event to close', 'events to close'],
        'venue_bookings_pending' => ['venue booking to review', 'venue bookings to review'],
        'compliance_submissions_pending' => ['compliance submission to review', 'compliance submissions to review'],
        'grievances_urgent' => ['urgent grievance', 'urgent grievances'],
        'clearance_sao_pending' => ['clearance to sign', 'clearances to sign'],
    ];

    public function __construct(
        private readonly ApprovalEntityLabel $entityLabels,
        private readonly DashboardInsightEngine $insightEngine,
        private readonly ClientRouteAccess $routeAccess,
        private readonly AccreditationStatusService $accreditation,
        private readonly SetupChecklistService $setup,
    ) {}

    public function build(User $user): array
    {
        return match ($user->role) {
            'SUPER_ADMIN' => $this->buildSuperAdmin($user),
            'ADMIN' => $this->buildAdmin($user),
            'SBO_OFFICER' => $this->buildOfficer($user),
            'DEPARTMENT_HEAD' => $this->buildDepartmentHead($user),
            'STUDENT' => $this->buildStudent($user),
            default => abort(403, 'This role does not have a dashboard briefing.'),
        };
    }

    // ---------------------------------------------------------------
    // Per-role assembly
    // ---------------------------------------------------------------

    private function buildAdmin(User $user): array
    {
        $orgId = (int) $user->organization_id;
        $role = $user->role;

        $attention = $this->prioritize(array_merge(
            $this->approvalsAttention('ADMIN', $orgId, $user->id, $this->routeAccess->hrefFor($role, '/dashboard/approvals')),
            $this->electionsClosingAttention($orgId, $this->routeAccess->hrefFor($role, '/dashboard/elections/manage-elections')),
            $this->budgetUtilizationAttention($orgId, $this->routeAccess->hrefFor($role, '/dashboard/finance/budget-allocation')),
            $this->overdueTasksAttention($orgId, $this->routeAccess->hrefFor($role, '/dashboard/tasks/task-board')),
            $this->financialReportsAttention($orgId, $this->routeAccess->hrefFor($role, '/dashboard/finance/transaction-history')),
            $this->staleEventsAttention($orgId, $this->routeAccess->hrefFor($role, '/dashboard/events/manage-events')),
        ));

        return [
            'user' => $this->userBlock($user),
            'setup' => $this->setup->forUser($user),
            'summary' => $this->summary($attention),
            'attention' => $attention,
            'pillars' => [
                'finance' => $this->financePillar($orgId),
                'events' => $this->eventsPillar($orgId),
                'tasks' => $this->tasksPillar($orgId),
                'elections' => $this->electionsPillar($orgId),
                'merchandise' => $this->merchandisePillar($orgId),
                'communication' => $this->communicationPillar($orgId, $user->id, $user->mutedNotificationTypes()),
            ],
            'insights' => array_slice($this->insightEngine->forOrganization($orgId, $role), 0, 3),
            'agenda' => $this->agenda($orgId, $this->routeAccess->hrefFor($role, '/dashboard/events/manage-events'), $this->routeAccess->hrefFor($role, '/dashboard/elections/manage-elections')),
            'activity' => $this->activityFeed($role, $orgId),
        ];
    }

    private function buildOfficer(User $user): array
    {
        $orgId = (int) $user->organization_id;
        $role = $user->role;

        $attention = $this->prioritize(array_merge(
            $this->ordersToVerifyAttention($orgId, $this->routeAccess->hrefFor($role, '/dashboard/merchandise/manage-orders')),
            $this->dueSoonTasksAttention($orgId, $user->id, $this->routeAccess->hrefFor($role, '/dashboard/tasks/assigned-tasks')),
            $this->overdueTasksAttention($orgId, $this->routeAccess->hrefFor($role, '/dashboard/tasks/assigned-tasks'), $user->id),
            $this->eventsTodayAttention($orgId, $this->routeAccess->hrefFor($role, '/dashboard/events/check-in')),
        ));

        return [
            'user' => $this->userBlock($user),
            'setup' => $this->setup->forUser($user),
            'summary' => $this->summary($attention),
            'attention' => $attention,
            'pillars' => [
                'events' => $this->eventsPillar($orgId),
                'tasks' => $this->tasksPillar($orgId, $user->id),
                'merchandise' => $this->merchandisePillar($orgId),
                'communication' => $this->communicationPillar($orgId, $user->id, $user->mutedNotificationTypes()),
                'finance' => $this->financePillar($orgId),
            ],
            'insights' => array_slice($this->insightEngine->forOrganization($orgId, $role), 0, 3),
            'agenda' => $this->agenda($orgId, $this->routeAccess->hrefFor($role, '/dashboard/events/check-in'), null),
            'activity' => $this->activityFeed($role, $orgId, $user->id),
        ];
    }

    private function buildDepartmentHead(User $user): array
    {
        $orgId = (int) $user->organization_id;
        $role = $user->role;

        $attention = $this->prioritize(
            $this->approvalsAttention('DEPARTMENT_HEAD', $orgId, $user->id, $this->routeAccess->hrefFor($role, '/dashboard/approvals'))
        );

        return [
            'user' => $this->userBlock($user),
            'setup' => $this->setup->forUser($user),
            'summary' => $this->summary($attention),
            'attention' => $attention,
            'pillars' => [
                'finance' => $this->financePillar($orgId),
                'events' => $this->eventsPillar($orgId),
                'elections' => $this->electionsPillar($orgId),
                'communication' => $this->communicationPillar($orgId, $user->id, $user->mutedNotificationTypes()),
            ],
            'insights' => array_slice($this->insightEngine->forOrganization($orgId, $role, includeTaskWorkload: false), 0, 3),
            'agenda' => $this->agenda($orgId, $this->routeAccess->hrefFor($role, '/dashboard/events/activity-calendar'), $this->routeAccess->hrefFor($role, '/dashboard/elections/election-results')),
            'activity' => $this->activityFeed($role, $orgId, $user->id),
        ];
    }

    private function buildStudent(User $user): array
    {
        $orgId = (int) $user->organization_id;
        $role = $user->role;

        $attention = $this->prioritize(array_merge(
            $this->unvotedElectionAttention($orgId, $user->id, $this->routeAccess->hrefFor($role, '/dashboard/elections/cast-vote')),
            $this->ordersReadyToClaimAttention($orgId, $user->id, $this->routeAccess->hrefFor($role, '/dashboard/merchandise/my-orders')),
            $this->overdueTasksAttention($orgId, $this->routeAccess->hrefFor($role, '/dashboard/tasks/assigned-tasks'), $user->id),
            $this->dueSoonTasksAttention($orgId, $user->id, $this->routeAccess->hrefFor($role, '/dashboard/tasks/assigned-tasks')),
            $this->eventsTodayAttention($orgId, $this->routeAccess->hrefFor($role, '/dashboard/events/activity-calendar')),
        ));

        return [
            'user' => $this->userBlock($user),
            'setup' => $this->setup->forUser($user),
            'summary' => $this->summary($attention),
            'attention' => $attention,
            'pillars' => [
                'elections' => $this->electionsPillar($orgId),
                'events' => $this->eventsPillar($orgId),
                'merchandise' => $this->myMerchandisePillar($orgId, $user->id),
                'tasks' => $this->tasksPillar($orgId, $user->id),
                'communication' => $this->communicationPillar($orgId, $user->id, $user->mutedNotificationTypes()),
            ],
            'insights' => [],
            'agenda' => $this->agenda($orgId, $this->routeAccess->hrefFor($role, '/dashboard/events/activity-calendar'), $this->routeAccess->hrefFor($role, '/dashboard/elections/cast-vote')),
            'activity' => $this->activityFeed($role, $orgId, $user->id),
        ];
    }

    private function buildSuperAdmin(User $user): array
    {
        $role = $user->role;
        $organizationIds = DB::table('organizations')
            ->where('organization_type', 'STUDENT_ORGANIZATION')
            ->pluck('id');

        $attention = $this->prioritize(array_merge(
            $this->approvalsAttention('SUPER_ADMIN', null, $user->id, $this->routeAccess->hrefFor($role, '/dashboard/super-admin/approvals')),
            $this->orgsOverdueReportsAttention($organizationIds, $this->routeAccess->hrefFor($role, '/dashboard/super-admin/financial-reports')),
            $this->saoQueuesAttention(),
        ));

        return [
            'user' => $this->userBlock($user),
            'setup' => $this->setup->forUser($user),
            'summary' => $this->summary($attention),
            'attention' => $attention,
            'pillars' => [
                'finance' => $this->universityFinancePillar($organizationIds),
                'elections' => $this->universityElectionsPillar($organizationIds),
                'events' => $this->universityEventsPillar($organizationIds),
                'communication' => $this->universityCommunicationPillar(),
            ],
            'insights' => array_slice($this->insightEngine->forUniversity($organizationIds), 0, 3),
            'agenda' => $this->universityAgenda($organizationIds),
            'activity' => $this->activityFeed($role, null),
            'organizations' => $this->organizationsOverview($organizationIds),
        ];
    }

    // ---------------------------------------------------------------
    // Shared blocks
    // ---------------------------------------------------------------

    private function userBlock(User $user): array
    {
        $organization = $user->organization;

        return [
            'first_name' => $user->first_name,
            'role' => $user->role,
            'organization' => $organization ? [
                'id' => $organization->id,
                'name' => $organization->name,
                'abbreviation' => $organization->acronym,
                'logo_url' => $organization->logo_url,
            ] : null,
        ];
    }

    private function summary(array $attention): array
    {
        return [
            'attention_count' => count($attention),
            'headline' => $this->headline($attention),
        ];
    }

    private function prioritize(array $items): array
    {
        $order = ['high' => 0, 'medium' => 1, 'low' => 2];

        usort($items, function (array $a, array $b) use ($order) {
            $severityCompare = ($order[$a['severity']] ?? 3) <=> ($order[$b['severity']] ?? 3);
            if ($severityCompare !== 0) {
                return $severityCompare;
            }

            $aDue = $a['due_at'];
            $bDue = $b['due_at'];
            if ($aDue === $bDue) {
                return 0;
            }
            if ($aDue === null) {
                return 1;
            }
            if ($bDue === null) {
                return -1;
            }

            return strcmp($aDue, $bDue);
        });

        return array_slice($items, 0, self::ATTENTION_LIMIT);
    }

    private function headline(array $attention): string
    {
        if ($attention === []) {
            return "You're all caught up.";
        }

        $bySeverity = collect($attention)
            ->groupBy('type')
            ->sortBy(fn ($items) => match ($items->first()['severity']) {
                'high' => 0,
                'medium' => 1,
                default => 2,
            });

        $weight = fn ($items) => $items->sum(fn (array $item) => $item['count'] ?? 1);
        $clauses = [];
        $named = 0;
        foreach ($bySeverity as $type => $items) {
            if ($named >= 2) {
                break;
            }
            $count = $weight($items);
            [$singular, $plural] = self::TYPE_LABELS[$type] ?? [str_replace('_', ' ', $type), str_replace('_', ' ', $type)];
            $clauses[] = $this->numberWord($count).' '.($count === 1 ? $singular : $plural);
            $named++;
        }

        $total = $weight(collect($attention));
        $remaining = $total - $bySeverity->take(2)->sum($weight);

        $sentence = count($clauses) > 1
            ? ucfirst($clauses[0]).' and '.$clauses[1]
            : ucfirst($clauses[0] ?? '');

        if ($remaining > 0) {
            $sentence .= ' (and '.$remaining.' more)';
        }

        $verb = $total === 1 ? 'needs' : 'need';

        return $sentence.' '.$verb.' you today.';
    }

    private function numberWord(int $count): string
    {
        $words = [1 => 'one', 2 => 'two', 3 => 'three', 4 => 'four', 5 => 'five', 6 => 'six', 7 => 'seven', 8 => 'eight', 9 => 'nine', 10 => 'ten'];

        return $words[$count] ?? (string) $count;
    }

    // ---------------------------------------------------------------
    // Attention builders (each capped at ATTENTION_LIMIT before any
    // per-row work, so the query count never grows with total history)
    // ---------------------------------------------------------------

    private function approvalsAttention(string $requiredRole, ?int $organizationId, int $assignedApproverUserId, ?string $href): array
    {
        $query = ApprovalRequest::with('requester:school_id,first_name,last_name')
            ->where('required_role', $requiredRole)
            ->where('status', 'pending')
            ->where(fn ($q) => $q->whereNull('assigned_approver')->orWhere('assigned_approver', $assignedApproverUserId));

        if ($organizationId !== null) {
            $query->where('organization_id', $organizationId);
        }

        $approvals = $query->orderBy('requested_at')->limit(self::ATTENTION_LIMIT)->get();

        return $approvals->map(function (ApprovalRequest $approval) use ($href) {
            $ageHours = now()->diffInHours($approval->requested_at);
            $requesterName = trim(($approval->requester->first_name ?? '').' '.($approval->requester->last_name ?? ''));

            return [
                'id' => 'approval-'.$approval->id,
                'type' => 'approval',
                'severity' => $ageHours >= 48 ? 'high' : ($ageHours >= 24 ? 'medium' : 'low'),
                'title' => $this->entityLabels->for($approval),
                'detail' => Str::headline($approval->entity_type).' requested by '.($requesterName ?: 'a member').' '.$approval->requested_at->diffForHumans(),
                'due_at' => null,
                'href' => $href,
            ];
        })->all();
    }

    private function electionsClosingAttention(int $organizationId, ?string $href): array
    {
        $rows = DB::table('elections')->where('organization_id', $organizationId)
            ->where('status', 'active')
            ->whereBetween('end_time', [now(), now()->addHours(72)])
            ->orderBy('end_time')->limit(self::ATTENTION_LIMIT)->get(['id', 'title', 'end_time']);

        return $rows->map(function ($row) use ($href) {
            $endTime = Carbon::parse($row->end_time);
            $hoursLeft = ($endTime->timestamp - now()->timestamp) / 3600;

            return [
                'id' => 'election-'.$row->id,
                'type' => 'election_closing',
                'severity' => $hoursLeft <= 24 ? 'high' : 'medium',
                'title' => 'Election closing soon',
                'detail' => "\"{$row->title}\" closes ".$endTime->diffForHumans(),
                'due_at' => $endTime->toIso8601String(),
                'href' => $href,
            ];
        })->all();
    }

    private function budgetUtilizationAttention(int $organizationId, ?string $href): array
    {
        $rows = DB::table('budgets')->where('organization_id', $organizationId)
            ->where('allocated_amount', '>', 0)
            ->get(['id', 'title', 'allocated_amount', 'remaining_amount']);

        $flagged = $rows->map(function ($row) {
            $allocated = (float) $row->allocated_amount;
            $remaining = $row->remaining_amount !== null ? (float) $row->remaining_amount : $allocated;
            $utilization = (($allocated - $remaining) / $allocated) * 100;

            return $utilization >= 80 ? ['row' => $row, 'utilization' => $utilization] : null;
        })->filter()->sortByDesc('utilization')->take(self::ATTENTION_LIMIT);

        return $flagged->map(function (array $item) use ($href) {
            $row = $item['row'];

            return [
                'id' => 'budget-'.$row->id,
                'type' => 'budget_utilization',
                'severity' => $item['utilization'] >= 90 ? 'high' : 'medium',
                'title' => 'Budget nearing its limit',
                'detail' => "\"{$row->title}\" has used ".round($item['utilization'], 1).'% of its allocation',
                'due_at' => null,
                'href' => $href,
            ];
        })->values()->all();
    }

    private function overdueTasksAttention(int $organizationId, ?string $href, ?int $assignedTo = null): array
    {
        $query = DB::table('tasks')->where('organization_id', $organizationId)->where('status', 'overdue');
        if ($assignedTo !== null) {
            $query->where('assigned_to', $assignedTo);
        }
        $rows = $query->orderBy('deadline')->limit(self::ATTENTION_LIMIT)->get(['id', 'title', 'deadline']);

        return $rows->map(function ($row) use ($href) {
            $deadline = Carbon::parse($row->deadline);

            return [
                'id' => 'task-'.$row->id,
                'type' => 'task_overdue',
                'severity' => 'high',
                'title' => 'Task overdue',
                'detail' => "\"{$row->title}\" was due ".$deadline->diffForHumans(),
                'due_at' => $deadline->toIso8601String(),
                'href' => $href,
            ];
        })->all();
    }

    /** Events whose end has passed but that are still marked approved or ongoing, so attendance and reports never close. */
    private function staleEventsAttention(int $organizationId, ?string $href): array
    {
        $rows = DB::table('events')->where('organization_id', $organizationId)
            ->whereIn('status', ['approved', 'ongoing'])
            ->where('end_time', '<', now())
            ->orderBy('end_time')
            ->limit(self::ATTENTION_LIMIT)
            ->get(['id', 'title', 'status', 'end_time']);

        return $rows->map(function ($row) use ($href) {
            $endedAt = Carbon::parse($row->end_time);

            return [
                'id' => 'event-stale-'.$row->id,
                'type' => 'event_needs_closing',
                'severity' => 'medium',
                'title' => 'Event ended but is still open',
                'detail' => "\"{$row->title}\" ended ".$endedAt->diffForHumans().' and is still marked '.Str::headline($row->status).'. Mark it completed to close its attendance and reports.',
                'due_at' => $endedAt->toIso8601String(),
                'href' => $href,
            ];
        })->all();
    }

    private function dueSoonTasksAttention(int $organizationId, int $assignedTo, ?string $href): array
    {
        $rows = DB::table('tasks')->where('organization_id', $organizationId)->where('assigned_to', $assignedTo)
            ->whereIn('status', ['pending', 'in_progress'])
            ->whereBetween('deadline', [now(), now()->addDays(3)])
            ->orderBy('deadline')->limit(self::ATTENTION_LIMIT)->get(['id', 'title', 'deadline']);

        return $rows->map(function ($row) use ($href) {
            $deadline = Carbon::parse($row->deadline);

            return [
                'id' => 'task-'.$row->id,
                'type' => 'task_due_soon',
                'severity' => $deadline->lessThanOrEqualTo(now()->addDay()) ? 'high' : 'medium',
                'title' => 'Task due soon',
                'detail' => "\"{$row->title}\" is due ".$deadline->diffForHumans(),
                'due_at' => $deadline->toIso8601String(),
                'href' => $href,
            ];
        })->all();
    }

    private function financialReportsAttention(int $organizationId, ?string $href): array
    {
        $items = [];

        $rejected = DB::table('financial_reports')->where('organization_id', $organizationId)
            ->where('submission_status', 'rejected')
            ->orderByDesc('generated_at')->limit(self::ATTENTION_LIMIT)->get(['id', 'title']);
        foreach ($rejected as $row) {
            $items[] = [
                'id' => 'financial_report-'.$row->id,
                'type' => 'financial_report_returned',
                'severity' => 'high',
                'title' => 'Financial report returned',
                'detail' => "\"{$row->title}\" was returned and needs revision",
                'due_at' => null,
                'href' => $href,
            ];
        }

        $deadline = DB::table('financial_report_deadlines')->orderByDesc('id')->first();
        if ($deadline) {
            $deadlineAt = Carbon::parse($deadline->deadline_at);
            if ($deadlineAt->lessThanOrEqualTo(now()->addDays(7))) {
                $submitted = DB::table('financial_reports')->where('organization_id', $organizationId)
                    ->where('deadline_id', $deadline->id)
                    ->whereIn('submission_status', ['pending_department_head', 'pending_sao', 'approved'])
                    ->exists();
                if (! $submitted) {
                    $items[] = [
                        'id' => 'financial_report_deadline-'.$deadline->id,
                        'type' => 'financial_report_due',
                        'severity' => $deadlineAt->isPast() ? 'high' : 'medium',
                        'title' => $deadlineAt->isPast() ? 'Financial report overdue' : 'Financial report due soon',
                        'detail' => 'Submit the required financial report by '.$deadlineAt->format('M j, Y g:i A'),
                        'due_at' => $deadlineAt->toIso8601String(),
                        'href' => $href,
                    ];
                }
            }
        }

        return array_slice($items, 0, self::ATTENTION_LIMIT);
    }

    private function ordersToVerifyAttention(int $organizationId, ?string $href): array
    {
        $rows = DB::table('orders')->where('organization_id', $organizationId)
            ->where('status', 'pending')->where('officer_review_status', 'pending')
            ->whereNotNull('payment_proof_url')
            ->orderBy('updated_at')->limit(self::ATTENTION_LIMIT)->get(['id', 'total_price']);

        return $rows->map(fn ($row) => [
            'id' => 'order-'.$row->id,
            'type' => 'order_verification',
            'severity' => 'medium',
            'title' => 'Order awaiting payment verification',
            'detail' => 'Order ORD-'.$row->id.' (₱'.number_format((float) $row->total_price, 2).') is awaiting review',
            'due_at' => null,
            'href' => $href,
        ])->all();
    }

    private function eventsTodayAttention(int $organizationId, ?string $href): array
    {
        $rows = DB::table('events')->where('organization_id', $organizationId)
            ->whereIn('status', ['approved', 'ongoing'])
            ->whereBetween('start_time', [now()->startOfDay(), now()->endOfDay()])
            ->orderBy('start_time')->limit(self::ATTENTION_LIMIT)->get(['id', 'title', 'start_time']);

        return $rows->map(function ($row) use ($href) {
            $startTime = Carbon::parse($row->start_time);

            return [
                'id' => 'event-'.$row->id,
                'type' => 'event_today',
                'severity' => 'medium',
                'title' => 'Event today',
                'detail' => "\"{$row->title}\" starts ".$startTime->format('g:i A'),
                'due_at' => $startTime->toIso8601String(),
                'href' => $href,
            ];
        })->all();
    }

    private function unvotedElectionAttention(int $organizationId, int $studentId, ?string $href): array
    {
        $election = DB::table('elections')->where('organization_id', $organizationId)
            ->where('status', 'active')->orderBy('end_time')->first(['id', 'title', 'end_time']);

        if (! $election) {
            return [];
        }

        $voted = DB::table('votes')->where('election_id', $election->id)->where('voter_id', $studentId)->exists();
        if ($voted) {
            return [];
        }

        $endTime = Carbon::parse($election->end_time);

        return [[
            'id' => 'election-'.$election->id,
            'type' => 'election_open',
            'severity' => $endTime->lessThanOrEqualTo(now()->addDay()) ? 'high' : 'medium',
            'title' => 'Vote now',
            'detail' => "\"{$election->title}\" closes ".$endTime->diffForHumans(),
            'due_at' => $endTime->toIso8601String(),
            'href' => $href,
        ]];
    }

    private function ordersReadyToClaimAttention(int $organizationId, int $studentId, ?string $href): array
    {
        $rows = DB::table('orders')->where('organization_id', $organizationId)->where('student_id', $studentId)
            ->where('status', 'paid')->orderBy('updated_at')->limit(self::ATTENTION_LIMIT)->get(['id']);

        return $rows->map(fn ($row) => [
            'id' => 'order-'.$row->id,
            'type' => 'order_ready_to_claim',
            'severity' => 'low',
            'title' => 'Order ready to claim',
            'detail' => 'Order ORD-'.$row->id.' is ready. Bring your claim token.',
            'due_at' => null,
            'href' => $href,
        ])->all();
    }

    private function orgsOverdueReportsAttention(Collection $organizationIds, ?string $href): array
    {
        $deadline = DB::table('financial_report_deadlines')->orderByDesc('id')->first();
        if (! $deadline) {
            return [];
        }

        $deadlineAt = Carbon::parse($deadline->deadline_at);
        if ($deadlineAt->greaterThan(now()->addDays(7))) {
            return [];
        }

        $covered = DB::table('financial_reports')->whereIn('organization_id', $organizationIds)
            ->where('deadline_id', $deadline->id)
            ->whereIn('submission_status', ['pending_department_head', 'pending_sao', 'approved'])
            ->pluck('organization_id')->unique();

        $orgs = DB::table('organizations')->whereIn('id', $organizationIds)->whereNotIn('id', $covered)
            ->orderBy('name')->limit(self::ATTENTION_LIMIT)->get(['id', 'name']);

        return $orgs->map(fn ($org) => [
            'id' => 'org_report-'.$org->id,
            'type' => 'financial_report_due',
            'severity' => $deadlineAt->isPast() ? 'high' : 'medium',
            'title' => 'Financial report not yet submitted',
            'detail' => "{$org->name} has not submitted its financial report".($deadlineAt->isPast() ? ' and the deadline has passed' : ''),
            'due_at' => $deadlineAt->toIso8601String(),
            'href' => $href,
        ])->all();
    }

    // ---------------------------------------------------------------
    // Pillars
    // ---------------------------------------------------------------

    private function financePillar(int $organizationId): array
    {
        ['allocated' => $allocated, 'remaining' => $remaining, 'spent' => $spent, 'income' => $income] = $this->approvedBudgetTotals([$organizationId]);

        $now = now();
        $currentNet = $this->netTransactions($organizationId, $now->copy()->subDays(30), $now);
        $previousNet = $this->netTransactions($organizationId, $now->copy()->subDays(60), $now->copy()->subDays(30));

        return [
            'value' => round($remaining, 2),
            'unit' => 'currency',
            'label' => 'Available budget',
            'context' => $this->budgetContext($allocated, $remaining, $spent, $income, ''),
            'delta' => [
                'value' => round($currentNet - $previousNet, 2),
                'period' => 'vs last 30 days',
                'direction' => $this->direction($currentNet, $previousNet),
            ],
            'meter' => ['value' => round($spent, 2), 'limit' => round($allocated, 2)],
        ];
    }

    /**
     * Only approved budgets are money an organization can use. Income posted
     * against a budget raises its remaining amount above what was allocated,
     * so spending is summed per budget, never netted across budgets.
     */
    private function approvedBudgetTotals(iterable $organizationIds): array
    {
        $approved = DB::table('budgets')->whereIn('organization_id', collect($organizationIds)->all())->where('submission_status', 'approved');
        $budgets = (clone $approved)->selectRaw('COALESCE(SUM(allocated_amount),0) as allocated, COALESCE(SUM(remaining_amount),0) as remaining')->first();
        // Spending and income come from the entries recorded against the budgets, not from
        // allocation minus remaining, which hides spending whenever income was added too.
        $linked = DB::table('transactions')->whereIn('budget_id', (clone $approved)->select('id'))
            ->selectRaw("COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END),0) as spent, COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END),0) as income")
            ->first();

        return ['allocated' => (float) $budgets->allocated, 'remaining' => (float) $budgets->remaining, 'spent' => (float) $linked->spent, 'income' => (float) $linked->income];
    }

    private function budgetContext(float $allocated, float $remaining, float $spent, float $income, string $scope): string
    {
        if ($allocated <= 0) {
            return 'No approved budgets yet.';
        }
        if ($income > 0.004) {
            return sprintf('Includes ₱%s in income added to ₱%s allocated%s; ₱%s spent so far.', number_format($income, 2), number_format($allocated, 2), $scope, number_format($spent, 2));
        }

        return sprintf('₱%s left of ₱%s allocated%s (%s%% used).', number_format($remaining, 2), number_format($allocated, 2), $scope, round(($spent / $allocated) * 100, 1));
    }

    private function netTransactions(int $organizationId, Carbon $from, Carbon $to): float
    {
        $row = DB::table('transactions')->where('organization_id', $organizationId)
            ->whereBetween('transaction_date', [$from, $to])
            ->selectRaw("COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0) as income, COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) as expense")
            ->first();

        return (float) $row->income - (float) $row->expense;
    }

    private function direction(float $current, float $previous): string
    {
        if (abs($current - $previous) < 0.01) {
            return 'flat';
        }

        return $current > $previous ? 'up' : 'down';
    }

    private function eventsPillar(int $organizationId): array
    {
        $now = now();
        $upcoming = DB::table('events')->where('organization_id', $organizationId)
            ->whereIn('status', ['approved', 'ongoing'])->where('end_time', '>=', $now)->count();
        $next = DB::table('events')->where('organization_id', $organizationId)
            ->whereIn('status', ['approved', 'ongoing'])->where('start_time', '>=', $now)
            ->orderBy('start_time')->first(['title', 'start_time']);

        $lastCompleted = DB::table('events')->where('organization_id', $organizationId)
            ->where('status', 'completed')->orderByDesc('end_time')->first(['id']);
        $meter = null;
        if ($lastCompleted) {
            $attended = DB::table('attendance')->where('event_id', $lastCompleted->id)->count();
            $memberCount = DB::table('users')->where('organization_id', $organizationId)->where('account_status', 'active')->count();
            if ($memberCount > 0) {
                $meter = ['value' => $attended, 'limit' => $memberCount];
            }
        }

        return [
            'value' => $upcoming,
            'unit' => 'count',
            'label' => 'Upcoming events',
            'context' => $next
                ? "Next: \"{$next->title}\" on ".Carbon::parse($next->start_time)->format('M j, g:i A')
                : 'No upcoming events scheduled.',
            'meter' => $meter,
        ];
    }

    private function tasksPillar(int $organizationId, ?int $assignedTo = null): array
    {
        $base = DB::table('tasks')->where('organization_id', $organizationId);
        if ($assignedTo !== null) {
            $base->where('assigned_to', $assignedTo);
        }

        $open = (clone $base)->whereIn('status', ['pending', 'in_progress'])->count();
        $overdue = (clone $base)->where('status', 'overdue')->count();
        $completedThisWeek = (clone $base)->where('status', 'completed')->where('completed_at', '>=', now()->startOfWeek())->count();

        return [
            'value' => $open,
            'unit' => 'count',
            'label' => $assignedTo !== null ? 'My open tasks' : 'Open tasks',
            'context' => "{$overdue} overdue · {$completedThisWeek} completed this week",
        ];
    }

    private function electionsPillar(int $organizationId): array
    {
        $election = DB::table('elections')->where('organization_id', $organizationId)
            ->where('status', 'active')->orderBy('end_time')->first(['id', 'title', 'end_time']);

        if (! $election) {
            $upcoming = DB::table('elections')->where('organization_id', $organizationId)->where('status', 'upcoming')->count();

            return [
                'value' => $upcoming,
                'unit' => 'count',
                'label' => 'Upcoming elections',
                'context' => $upcoming > 0 ? 'No election is active right now.' : 'No election is active or scheduled.',
            ];
        }

        $eligibleTotal = DB::table('users')->where('organization_id', $organizationId)->where('account_status', 'active')
            ->whereIn('role', ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD', 'STUDENT'])->count();
        $votedCount = DB::table('votes')->where('election_id', $election->id)->distinct()->count('voter_id');
        $turnout = $eligibleTotal > 0 ? round(($votedCount / $eligibleTotal) * 100, 1) : 0.0;

        return [
            'value' => $turnout,
            'unit' => 'percent',
            'label' => 'Turnout · '.$election->title,
            'context' => 'Closes '.Carbon::parse($election->end_time)->format('M j, g:i A'),
            'meter' => ['value' => $votedCount, 'limit' => $eligibleTotal],
        ];
    }

    private function merchandisePillar(int $organizationId): array
    {
        $pending = DB::table('orders')->where('organization_id', $organizationId)->where('status', 'pending')->count();
        $readyToClaim = DB::table('orders')->where('organization_id', $organizationId)->where('status', 'paid')->count();
        $revenue = (float) DB::table('orders')->where('organization_id', $organizationId)
            ->where('status', 'claimed')
            ->whereYear('claimed_at', now()->year)->whereMonth('claimed_at', now()->month)
            ->sum('total_price');

        return [
            'value' => $pending,
            'unit' => 'count',
            'label' => 'Orders pending verification',
            'context' => "{$readyToClaim} ready to claim · ₱".number_format($revenue, 2).' revenue this month',
        ];
    }

    private function myMerchandisePillar(int $organizationId, int $studentId): array
    {
        $readyToClaim = DB::table('orders')->where('organization_id', $organizationId)->where('student_id', $studentId)
            ->where('status', 'paid')->count();
        $awaitingReview = DB::table('orders')->where('organization_id', $organizationId)->where('student_id', $studentId)
            ->where('status', 'pending')->count();

        return [
            'value' => $readyToClaim,
            'unit' => 'count',
            'label' => 'Ready to claim',
            'context' => $awaitingReview > 0 ? "{$awaitingReview} order(s) awaiting review" : 'No orders awaiting review.',
        ];
    }

    private function communicationPillar(int $organizationId, int $userId, array $mutedTypes): array
    {
        $publishedThisMonth = DB::table('announcements')->where('organization_id', $organizationId)
            ->where('is_published', true)
            ->whereYear('published_at', now()->year)->whereMonth('published_at', now()->month)
            ->count();
        $unread = DB::table('notifications')->where('organization_id', $organizationId)->where('user_id', $userId)
            ->when($mutedTypes !== [], fn ($query) => $query->whereNotIn('notification_type', $mutedTypes))
            ->where('is_read', false)->count();
        $last = DB::table('announcements')->where('organization_id', $organizationId)->where('is_published', true)
            ->orderByDesc('published_at')->first(['title']);

        return [
            'value' => $publishedThisMonth,
            'unit' => 'count',
            'label' => 'Announcements published',
            'context' => $last
                ? "{$unread} unread notification(s) · last: \"{$last->title}\""
                : "{$unread} unread notification(s)",
        ];
    }

    private function universityFinancePillar(Collection $organizationIds): array
    {
        ['allocated' => $allocated, 'remaining' => $remaining, 'spent' => $spent, 'income' => $income] = $this->approvedBudgetTotals($organizationIds);
        $pendingReports = DB::table('financial_reports')->whereIn('organization_id', $organizationIds)
            ->whereIn('submission_status', ['pending_department_head', 'pending_sao'])->count();
        $scope = sprintf(' across %d organization(s)', $organizationIds->count());

        return [
            'value' => round($remaining, 2),
            'unit' => 'currency',
            'label' => 'University-wide available budget',
            'context' => sprintf('%s %d financial report(s) pending final approval.', $this->budgetContext($allocated, $remaining, $spent, $income, $scope), $pendingReports),
            'meter' => ['value' => round($spent, 2), 'limit' => round($allocated, 2)],
        ];
    }

    private function universityElectionsPillar(Collection $organizationIds): array
    {
        $active = DB::table('elections')->whereIn('organization_id', $organizationIds)->where('status', 'active')->count();

        return [
            'value' => $active,
            'unit' => 'count',
            'label' => 'Active elections',
            'context' => $active > 0
                ? "{$active} organization(s) currently have an election open"
                : 'No organization currently has an open election.',
        ];
    }

    private function universityEventsPillar(Collection $organizationIds): array
    {
        $upcoming = DB::table('events')->whereIn('organization_id', $organizationIds)
            ->whereIn('status', ['approved', 'ongoing'])->where('start_time', '>=', now())->count();

        return [
            'value' => $upcoming,
            'unit' => 'count',
            'label' => 'Upcoming events university-wide',
            'context' => "{$upcoming} event(s) scheduled across all organizations",
        ];
    }

    private function universityCommunicationPillar(): array
    {
        $sao = DB::table('organizations')->where('organization_type', 'SYSTEM_ADMINISTRATION')->first(['id']);
        $publishedThisMonth = $sao
            ? DB::table('announcements')->where('organization_id', $sao->id)->where('is_published', true)
                ->whereYear('published_at', now()->year)->whereMonth('published_at', now()->month)->count()
            : 0;

        return [
            'value' => $publishedThisMonth,
            'unit' => 'count',
            'label' => 'University announcements published',
            'context' => "{$publishedThisMonth} university-wide announcement(s) published this month",
        ];
    }

    // ---------------------------------------------------------------
    // Agenda / activity / organizations
    // ---------------------------------------------------------------

    private function agenda(int $organizationId, ?string $eventsHref, ?string $electionHref): array
    {
        $items = collect();

        DB::table('events')->where('organization_id', $organizationId)
            ->whereIn('status', ['approved', 'ongoing'])->where('start_time', '>=', now())
            ->orderBy('start_time')->limit(self::AGENDA_LIMIT)->get(['id', 'title', 'start_time', 'location'])
            ->each(fn ($row) => $items->push([
                'id' => 'event-'.$row->id,
                'title' => $row->title,
                'starts_at' => Carbon::parse($row->start_time)->toIso8601String(),
                'location' => $row->location,
                'href' => $eventsHref,
            ]));

        if ($electionHref !== null) {
            DB::table('elections')->where('organization_id', $organizationId)->where('status', 'active')
                ->where('end_time', '>=', now())->orderBy('end_time')->limit(self::AGENDA_LIMIT)->get(['id', 'title', 'end_time'])
                ->each(fn ($row) => $items->push([
                    'id' => 'election-'.$row->id,
                    'title' => 'Voting closes: '.$row->title,
                    'starts_at' => Carbon::parse($row->end_time)->toIso8601String(),
                    'location' => null,
                    'href' => $electionHref,
                ]));
        }

        return $items->sortBy('starts_at')->take(self::AGENDA_LIMIT)->values()->all();
    }

    private function universityAgenda(Collection $organizationIds): array
    {
        $items = collect();
        $href = $this->routeAccess->hrefFor('SUPER_ADMIN', '/dashboard/super-admin/organizations');

        DB::table('events')->whereIn('organization_id', $organizationIds)
            ->whereIn('status', ['approved', 'ongoing'])->where('start_time', '>=', now())
            ->orderBy('start_time')->limit(self::AGENDA_LIMIT)->get(['id', 'title', 'start_time', 'location'])
            ->each(fn ($row) => $items->push([
                'id' => 'event-'.$row->id,
                'title' => $row->title,
                'starts_at' => Carbon::parse($row->start_time)->toIso8601String(),
                'location' => $row->location,
                'href' => $href,
            ]));

        DB::table('elections')->whereIn('organization_id', $organizationIds)->where('status', 'active')
            ->where('end_time', '>=', now())->orderBy('end_time')->limit(self::AGENDA_LIMIT)->get(['id', 'title', 'end_time'])
            ->each(fn ($row) => $items->push([
                'id' => 'election-'.$row->id,
                'title' => 'Voting closes: '.$row->title,
                'starts_at' => Carbon::parse($row->end_time)->toIso8601String(),
                'location' => null,
                'href' => $href,
            ]));

        return $items->sortBy('starts_at')->take(self::AGENDA_LIMIT)->values()->all();
    }

    /**
     * Only ADMIN (their own org) and SUPER_ADMIN (organizationId null, no
     * scope) get the full org audit stream, and even then never the
     * 'grievances' module - a filer's identity must not leak through this
     * feed to anyone but SUPER_ADMIN, mirroring the same rule /audit-logs
     * enforces. Every other role gets only their own recent actions plus
     * safe public items (published announcements, approved events), never
     * another member's activity.
     */
    private function activityFeed(string $role, ?int $organizationId, ?int $userId = null, int $limit = self::ACTIVITY_LIMIT): array
    {
        if ($userId !== null && $role !== 'ADMIN') {
            return $this->personalAndPublicActivityFeed($role, (int) $organizationId, $userId, $limit);
        }

        $query = DB::table('audit_logs')
            ->leftJoin('users', 'audit_logs.user_id', '=', 'users.school_id')
            ->select('audit_logs.id', 'audit_logs.action', 'audit_logs.module', 'audit_logs.description', 'audit_logs.created_at', 'users.first_name', 'users.last_name');

        if ($organizationId !== null) {
            $query->where('audit_logs.organization_id', $organizationId);
        }
        if ($role !== 'SUPER_ADMIN') {
            $query->where('audit_logs.module', '!=', 'grievances');
        }

        $rows = $query->orderByDesc('audit_logs.created_at')->limit($limit)->get();

        return $rows->map(fn ($row) => $this->activityItem($row, $role))->all();
    }

    private function personalAndPublicActivityFeed(string $role, int $organizationId, int $userId, int $limit): array
    {
        $own = DB::table('audit_logs')
            ->leftJoin('users', 'audit_logs.user_id', '=', 'users.school_id')
            ->select('audit_logs.id', 'audit_logs.action', 'audit_logs.module', 'audit_logs.description', 'audit_logs.created_at', 'users.first_name', 'users.last_name')
            ->where('audit_logs.organization_id', $organizationId)
            ->where('audit_logs.user_id', $userId)
            ->where('audit_logs.module', '!=', 'grievances')
            ->orderByDesc('audit_logs.created_at')
            ->limit($limit)
            ->get()
            ->map(fn ($row) => $this->activityItem($row, $role));

        $announcementsHref = $this->routeAccess->hrefFor($role, '/dashboard/announcements/view-announcements');
        $announcements = DB::table('announcements')
            ->where('organization_id', $organizationId)
            ->where('is_published', true)
            ->orderByDesc('published_at')
            ->limit($limit)
            ->get(['id', 'title', 'published_at'])
            ->map(fn ($row) => [
                'id' => 'announcement-'.$row->id,
                'actor' => 'System',
                'action' => 'Announcement Published',
                'subject' => $row->title,
                'at' => Carbon::parse($row->published_at)->toIso8601String(),
                'href' => $announcementsHref,
            ]);

        $eventsHref = $this->routeAccess->hrefFor($role, '/dashboard/events/activity-calendar');
        $events = DB::table('events')
            ->where('organization_id', $organizationId)
            ->where('status', 'approved')
            ->whereNotNull('approved_at')
            ->orderByDesc('approved_at')
            ->limit($limit)
            ->get(['id', 'title', 'approved_at'])
            ->map(fn ($row) => [
                'id' => 'event-'.$row->id,
                'actor' => 'System',
                'action' => 'Event Approved',
                'subject' => $row->title,
                'at' => Carbon::parse($row->approved_at)->toIso8601String(),
                'href' => $eventsHref,
            ]);

        return $own->concat($announcements)->concat($events)
            ->sortByDesc('at')
            ->take($limit)
            ->values()
            ->all();
    }

    private function activityItem($row, string $role): array
    {
        $actor = trim(($row->first_name ?? '').' '.($row->last_name ?? ''));

        return [
            'id' => 'audit-'.$row->id,
            'actor' => $actor !== '' ? $actor : 'System',
            'action' => Str::headline($row->action),
            'subject' => $row->description ?: Str::headline($row->module),
            'at' => Carbon::parse($row->created_at)->toIso8601String(),
            'href' => $this->activityHref($role, $row->module),
        ];
    }

    private function activityHref(string $role, string $module): ?string
    {
        $path = match ($module) {
            'budgets' => '/dashboard/finance/budget-allocation',
            'approvals' => '/dashboard/approvals',
            'financial_forecasts' => '/dashboard/finance/financial-insights',
            'system_administration' => '/dashboard/super-admin/organizations',
            default => null,
        };

        return $path !== null ? $this->routeAccess->hrefFor($role, $path) : null;
    }

    /**
     * SUPER_ADMIN's own queues that never surface for anyone else: pending
     * venue bookings, compliance submissions awaiting review, unresolved
     * high/critical urgency grievances (count only, no identities - the
     * grievance identity leak this briefing must never repeat), and pending
     * SAO clearance lines. Each is one item standing for a whole queue, so it
     * carries its count for the headline.
     */
    private function saoQueuesAttention(): array
    {
        $items = [];

        $pendingVenueBookings = DB::table('venue_bookings')->where('status', 'pending')->count();
        if ($pendingVenueBookings > 0) {
            $items[] = [
                'id' => 'sao_queue-venue_bookings',
                'type' => 'venue_bookings_pending',
                'count' => $pendingVenueBookings,
                'severity' => 'medium',
                'title' => 'Venue bookings awaiting review',
                'detail' => "{$pendingVenueBookings} venue booking(s) are awaiting SAO review",
                'due_at' => null,
                'href' => $this->routeAccess->hrefFor('SUPER_ADMIN', '/dashboard/super-admin/venues'),
            ];
        }

        $pendingCompliance = DB::table('organization_compliance_submissions')->where('status', 'submitted')->count();
        if ($pendingCompliance > 0) {
            $items[] = [
                'id' => 'sao_queue-compliance',
                'type' => 'compliance_submissions_pending',
                'count' => $pendingCompliance,
                'severity' => 'medium',
                'title' => 'Compliance submissions awaiting review',
                'detail' => "{$pendingCompliance} compliance submission(s) are awaiting review",
                'due_at' => null,
                'href' => $this->routeAccess->hrefFor('SUPER_ADMIN', '/dashboard/super-admin/compliance'),
            ];
        }

        $urgentGrievances = DB::table('grievances')
            ->whereNotIn('status', ['resolved', 'dismissed'])
            ->whereIn('urgency', self::URGENT_GRIEVANCE_URGENCIES)
            ->count();
        if ($urgentGrievances > 0) {
            $items[] = [
                'id' => 'sao_queue-grievances',
                'type' => 'grievances_urgent',
                'count' => $urgentGrievances,
                'severity' => 'high',
                'title' => 'Urgent grievances unresolved',
                'detail' => "{$urgentGrievances} high or critical urgency grievance(s) remain unresolved",
                'due_at' => null,
                'href' => $this->routeAccess->hrefFor('SUPER_ADMIN', '/dashboard/super-admin/grievances'),
            ];
        }

        $pendingSaoClearances = DB::table('clearance_signatures')->where('required_role', 'sao')->where('status', 'pending')->count();
        if ($pendingSaoClearances > 0) {
            $items[] = [
                'id' => 'sao_queue-clearance',
                'type' => 'clearance_sao_pending',
                'count' => $pendingSaoClearances,
                'severity' => 'medium',
                'title' => 'SAO clearance lines pending',
                'detail' => "{$pendingSaoClearances} SAO clearance line(s) are pending your signature",
                'due_at' => null,
                'href' => $this->routeAccess->hrefFor('SUPER_ADMIN', '/dashboard/super-admin/clearances'),
            ];
        }

        return $items;
    }

    private function organizationsOverview(Collection $organizationIds): array
    {
        $orgs = DB::table('organizations')->whereIn('id', $organizationIds)->orderBy('name')->get(['id', 'name', 'acronym']);

        $budgetTotals = DB::table('budgets')->whereIn('organization_id', $organizationIds)
            ->select('organization_id')
            ->selectRaw('COALESCE(SUM(allocated_amount),0) as allocated, COALESCE(SUM(remaining_amount),0) as remaining')
            ->groupBy('organization_id')->get()->keyBy('organization_id');

        $reportsPending = DB::table('financial_reports')->whereIn('organization_id', $organizationIds)
            ->whereIn('submission_status', ['pending_department_head', 'pending_sao'])
            ->select('organization_id')->selectRaw('COUNT(*) as total')->groupBy('organization_id')->pluck('total', 'organization_id');

        $openElections = DB::table('elections')->whereIn('organization_id', $organizationIds)->where('status', 'active')
            ->select('organization_id')->selectRaw('COUNT(*) as total')->groupBy('organization_id')->pluck('total', 'organization_id');

        $lastActivity = DB::table('audit_logs')->whereIn('organization_id', $organizationIds)
            ->select('organization_id')->selectRaw('MAX(created_at) as last_at')->groupBy('organization_id')->pluck('last_at', 'organization_id');

        $accreditationStatuses = $this->accreditation->forOrganizations($organizationIds);

        return $orgs->map(function ($org) use ($budgetTotals, $reportsPending, $openElections, $lastActivity, $accreditationStatuses) {
            $budget = $budgetTotals->get($org->id);
            $allocated = $budget ? (float) $budget->allocated : 0.0;
            $remaining = $budget ? (float) $budget->remaining : 0.0;
            $utilization = $allocated > 0 ? round((($allocated - $remaining) / $allocated) * 100, 1) : 0.0;

            return [
                'id' => $org->id,
                'name' => $org->name,
                'abbreviation' => $org->acronym,
                'accreditation_status' => $accreditationStatuses[$org->id] ?? 'not_applicable',
                'budget_utilization_percent' => $utilization,
                'financial_reports_pending' => (int) ($reportsPending[$org->id] ?? 0),
                'open_elections' => (int) ($openElections[$org->id] ?? 0),
                'last_activity_at' => isset($lastActivity[$org->id]) ? Carbon::parse($lastActivity[$org->id])->toIso8601String() : null,
            ];
        })->values()->all();
    }
}
