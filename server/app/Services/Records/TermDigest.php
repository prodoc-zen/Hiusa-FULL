<?php

namespace App\Services\Records;

use App\Models\AcademicSemester;
use App\Models\AccountProfile;
use App\Models\Announcement;
use App\Models\Event;
use App\Models\Order;
use App\Models\Organization;
use App\Models\OrganizationSemesterRecord;
use App\Models\Transaction;
use App\Support\SemesterScope;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * What an organization recorded in one semester, as plain counts, dates and amounts: the single source behind the
 * dashboard briefing's pillars and the language drafters that write the semester narrative and the handover notes.
 * Nothing here carries a person's contact details, an attendee, a payer or an uploaded file; officer names and
 * positions are the only people in it.
 */
final class TermDigest
{
    private const EVENT_LIMIT = 50;

    private const UPCOMING_LIMIT = 8;

    private const OFFICER_LIMIT = 30;

    private const OPEN_LIMIT = 15;

    /**
     * @return array{
     *     organization: string, semester: string,
     *     events: list<array{title: string, date: string, status: string, attendance: ?int, budget_allocated: ?float, budget_used: ?float}>,
     *     tasks: array{completed: int, overdue: int, open: int},
     *     elections: list<array{title: string, voters: int, ballots: int}>,
     *     merchandise: array{orders: int, claimed: int},
     *     announcements: array{posted: int},
     *     finance: array{income: float, expense: float, closing_balance: float},
     *     upcoming_events: list<array{title: string, date: string}>,
     *     officers: list<array{name: string, position: string}>
     * }
     */
    public static function forOrganization(int $organizationId, int $semesterId): array
    {
        $semester = AcademicSemester::with('academicYear:id,label')->findOrFail($semesterId);
        $organization = Organization::findOrFail($organizationId, ['id', 'name']);

        return [
            'organization' => $organization->name,
            'semester' => self::semesterLabel($semester),
            'events' => self::events($organizationId, $semester),
            'tasks' => self::taskCounts($organizationId, null, $semester->id),
            'elections' => self::elections($organizationId, $semester),
            'merchandise' => self::merchandise($organizationId, $semester),
            'announcements' => ['posted' => Announcement::where('organization_id', $organizationId)
                ->where('academic_semester_id', $semester->id)->where('is_published', true)->count()],
            'finance' => self::finance($organizationId, $semester),
            'upcoming_events' => self::upcomingEvents($organizationId, self::UPCOMING_LIMIT)
                ->map(fn ($event) => ['title' => $event->title, 'date' => Carbon::parse($event->start_time)->format('Y-m-d')])->values()->all(),
            'officers' => self::officers($organizationId, $semester),
        ];
    }

    /**
     * What an outgoing administration still owes the incoming one, as of now: open tasks and who holds them, money not
     * yet settled, events already scheduled, where the election stands and the semester's requirements not yet submitted.
     * Payers, borrowers and notes typed on a record never appear; an unsettled item carries a fixed description.
     *
     * @return array{
     *     pending_tasks: list<array{title: string, owner: string, deadline: string}>,
     *     unsettled: list<array{kind: string, amount: float, note: string}>,
     *     scheduled_events: list<array{title: string, date: string}>,
     *     election_state: string,
     *     missing_compliance: list<string>
     * }
     */
    public static function openItems(int $organizationId, int $semesterId): array
    {
        $election = DB::table('elections')->where('organization_id', $organizationId)->orderByDesc('end_time')->orderByDesc('id')->first(['status', 'finalized_at']);

        return [
            'pending_tasks' => DB::table('tasks')->leftJoin('users', 'users.school_id', '=', 'tasks.assigned_to')
                ->where('tasks.organization_id', $organizationId)->whereIn('tasks.status', ['pending', 'in_progress', 'overdue'])
                ->orderBy('tasks.deadline')->orderBy('tasks.id')->limit(self::OPEN_LIMIT)
                ->get(['tasks.title', 'tasks.deadline', 'users.first_name', 'users.last_name'])
                ->map(fn ($task) => [
                    'title' => $task->title,
                    'owner' => trim($task->first_name.' '.$task->last_name) ?: 'not assigned',
                    'deadline' => Carbon::parse($task->deadline)->format('Y-m-d'),
                ])->values()->all(),
            'unsettled' => self::unsettled($organizationId),
            'scheduled_events' => self::upcomingEvents($organizationId, self::OPEN_LIMIT)
                ->map(fn ($event) => ['title' => $event->title, 'date' => Carbon::parse($event->start_time)->format('Y-m-d')])->values()->all(),
            'election_state' => match (true) {
                $election === null => 'none',
                $election->finalized_at !== null => 'finalized',
                $election->status === 'active' => 'open',
                $election->status === 'closed' => 'closed',
                default => 'scheduled',
            },
            'missing_compliance' => DB::table('compliance_requirement_types')->where('is_active', true)->where('academic_semester_id', $semesterId)
                ->whereNotExists(fn ($query) => $query->from('organization_compliance_submissions')
                    ->whereColumn('organization_compliance_submissions.requirement_type_id', 'compliance_requirement_types.id')
                    ->where('organization_compliance_submissions.organization_id', $organizationId)
                    ->whereIn('organization_compliance_submissions.status', ['submitted', 'approved']))
                ->orderBy('id')->limit(self::OPEN_LIMIT)->pluck('name')->all(),
        ];
    }

    /** @return list<array{kind: string, amount: float, note: string}> */
    private static function unsettled(int $organizationId): array
    {
        $items = [];

        $advances = DB::table('cash_advances')->where('organization_id', $organizationId)->whereIn('status', ['released', 'partially_repaid'])
            ->orderBy('id')->limit(self::OPEN_LIMIT)->get(['id', 'amount']);
        $repaid = DB::table('cash_advance_repayments')->whereIn('cash_advance_id', $advances->pluck('id'))
            ->select('cash_advance_id')->selectRaw('SUM(amount) as repaid')->groupBy('cash_advance_id')->pluck('repaid', 'cash_advance_id');
        foreach ($advances as $advance) {
            $items[] = ['kind' => 'cash_advance', 'amount' => round((float) $advance->amount - (float) ($repaid[$advance->id] ?? 0), 2), 'note' => 'A cash advance is not fully repaid.'];
        }

        $collections = DB::table('collections')->where('organization_id', $organizationId)->whereIn('status', ['pending', 'verified'])
            ->orderBy('id')->limit(self::OPEN_LIMIT)->get(['id', 'status', 'amount_collected']);
        $remitted = DB::table('remittances')->whereIn('collection_id', $collections->pluck('id'))->where('status', 'recorded')
            ->select('collection_id')->selectRaw('SUM(amount) as remitted')->groupBy('collection_id')->pluck('remitted', 'collection_id');
        foreach ($collections as $collection) {
            $left = round((float) $collection->amount_collected - (float) ($remitted[$collection->id] ?? 0), 2);
            if ($collection->status === 'pending') {
                $items[] = ['kind' => 'collection', 'amount' => round((float) $collection->amount_collected, 2), 'note' => 'A collection is waiting to be verified.'];
            } elseif ($left > 0.004) {
                $items[] = ['kind' => 'collection', 'amount' => $left, 'note' => 'A verified collection is not fully remitted.'];
            }
        }

        $open = DB::table('invoices')->where('organization_id', $organizationId)->whereNotIn('status', ['paid', 'cancelled', 'waived']);
        $due = (float) (clone $open)->sum('amount_due');
        if ($due > 0.004) {
            $paid = (float) DB::table('invoice_payments')->whereIn('invoice_id', (clone $open)->select('id'))->where('status', 'approved')->sum('amount');
            $items[] = ['kind' => 'invoice', 'amount' => round($due - $paid, 2), 'note' => 'Student invoices are still unpaid.'];
        }

        return $items;
    }

    public static function semesterLabel(AcademicSemester $semester): string
    {
        return trim(($semester->number === 1 ? '1st' : '2nd').' Semester '.($semester->academicYear?->label ?? ''));
    }

    /**
     * Tasks by state. A task counts as completed whenever it was, or only since $completedSince when that is given
     * (the briefing's "this week"). $assignedTo narrows to one officer, $semesterId to one semester.
     *
     * @return array{completed: int, overdue: int, open: int}
     */
    public static function taskCounts(int $organizationId, ?int $assignedTo = null, ?int $semesterId = null, ?Carbon $completedSince = null): array
    {
        $base = DB::table('tasks')->where('organization_id', $organizationId);
        if ($assignedTo !== null) {
            $base->where('assigned_to', $assignedTo);
        }
        if ($semesterId !== null) {
            $base->where('academic_semester_id', $semesterId);
        }

        return [
            'completed' => (clone $base)->where('status', 'completed')->when($completedSince, fn ($query) => $query->where('completed_at', '>=', $completedSince))->count(),
            'overdue' => (clone $base)->where('status', 'overdue')->count(),
            'open' => (clone $base)->whereIn('status', ['pending', 'in_progress'])->count(),
        ];
    }

    /**
     * Voters on the roll and first-round ballots cast for one election row (id, organization_id, finalized_at).
     *
     * @return array{voters: int, ballots: int}
     */
    public static function electionTurnout(object $election): array
    {
        return [
            'voters' => AccountProfile::onVoterRoll($election->finalized_at)->where('account_profiles.organization_id', $election->organization_id)->count(),
            'ballots' => DB::table('election_ballots')->where('election_id', $election->id)->where('round', 1)->count(),
        ];
    }

    /** The organization's next approved or ongoing events, soonest first. */
    public static function upcomingEvents(int $organizationId, int $limit): Collection
    {
        return DB::table('events')->where('organization_id', $organizationId)
            ->whereIn('status', ['approved', 'ongoing'])->where('start_time', '>=', now())
            ->orderBy('start_time')->limit($limit)->get(['title', 'start_time']);
    }

    /**
     * Expense entries recorded against the given budgets (ids or a subquery), summed per budget id. Spending is kept
     * per budget because income posted against a budget raises its remaining amount instead of cancelling spending.
     */
    public static function expenseByBudget(mixed $budgetIds): Collection
    {
        return DB::table('transactions')->whereIn('budget_id', $budgetIds)->where('type', 'expense')
            ->select('budget_id')->selectRaw('SUM(amount) as spent')->groupBy('budget_id')->pluck('spent', 'budget_id');
    }

    /** @return list<array{title: string, date: string, status: string, attendance: ?int, budget_allocated: ?float, budget_used: ?float}> */
    private static function events(int $organizationId, AcademicSemester $semester): array
    {
        // A planning event was never approved, so it is neither an accomplishment nor a plan.
        $events = Event::where('organization_id', $organizationId)->where('academic_semester_id', $semester->id)
            ->whereIn('status', ['approved', 'ongoing', 'completed', 'cancelled'])
            ->orderBy('start_time')->orderBy('id')->limit(self::EVENT_LIMIT)->get(['id', 'title', 'start_time', 'status']);
        if ($events->isEmpty()) {
            return [];
        }

        $attendance = DB::table('attendance')->whereIn('event_id', $events->pluck('id'))
            ->select('event_id')->selectRaw('COUNT(*) as total')->groupBy('event_id')->pluck('total', 'event_id');
        $budgets = DB::table('budgets')->whereIn('event_id', $events->pluck('id'))->where('submission_status', 'approved')
            ->get(['id', 'event_id', 'allocated_amount'])->groupBy('event_id');
        $spent = self::expenseByBudget($budgets->flatten(1)->pluck('id')->all());

        return $events->map(function (Event $event) use ($attendance, $budgets, $spent) {
            $linked = $budgets->get($event->id);
            $recorded = (int) ($attendance[$event->id] ?? 0);

            return [
                'title' => $event->title,
                'date' => $event->start_time->format('Y-m-d'),
                'status' => $event->status,
                // A cancelled event was not held, so any attendance row left on it is not an attendance figure.
                'attendance' => $recorded > 0 && $event->status !== 'cancelled' ? $recorded : null,
                'budget_allocated' => $linked ? round((float) $linked->sum('allocated_amount'), 2) : null,
                'budget_used' => $linked ? round((float) $linked->sum(fn ($budget) => (float) ($spent[$budget->id] ?? 0)), 2) : null,
            ];
        })->values()->all();
    }

    /** @return list<array{title: string, voters: int, ballots: int}> */
    private static function elections(int $organizationId, AcademicSemester $semester): array
    {
        return DB::table('elections')->where('organization_id', $organizationId)->where('academic_semester_id', $semester->id)
            ->whereIn('status', ['active', 'closed'])->orderBy('start_time')->orderBy('id')
            ->get(['id', 'title', 'organization_id', 'finalized_at'])
            ->map(fn ($election) => ['title' => $election->title, ...self::electionTurnout($election)])->values()->all();
    }

    /** @return array{orders: int, claimed: int} */
    private static function merchandise(int $organizationId, AcademicSemester $semester): array
    {
        $orders = SemesterScope::dated(Order::where('organization_id', $organizationId)->where('status', '!=', 'cancelled'), 'created_at', [$semester]);

        return ['orders' => (clone $orders)->count(), 'claimed' => (clone $orders)->where('status', 'claimed')->count()];
    }

    /** @return array{income: float, expense: float, closing_balance: float} */
    private static function finance(int $organizationId, AcademicSemester $semester): array
    {
        $net = "SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as income, SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as expense";
        $term = SemesterScope::dated(Transaction::where('organization_id', $organizationId), 'transaction_date', [$semester])->selectRaw($net)->first();
        $toDate = Transaction::where('organization_id', $organizationId)->where('transaction_date', '<=', $semester->ends_on->endOfDay())->selectRaw($net)->first();

        return [
            'income' => round((float) $term->income, 2),
            'expense' => round((float) $term->expense, 2),
            'closing_balance' => round((float) $toDate->income - (float) $toDate->expense, 2),
        ];
    }

    /**
     * Who led the organization that semester: the frozen record when the semester was snapshotted, otherwise the
     * organization's active Admin and officers now.
     *
     * @return list<array{name: string, position: string}>
     */
    private static function officers(int $organizationId, AcademicSemester $semester): array
    {
        $frozen = OrganizationSemesterRecord::where('organization_id', $organizationId)->where('academic_semester_id', $semester->id)->value('officers');
        $rows = $frozen ?? app(SemesterSnapshotService::class)->officerRows(
            AccountProfile::where('organization_id', $organizationId)->whereIn('role', ['ADMIN', 'SBO_OFFICER'])->where('account_status', 'active')
                ->with(['user' => fn ($query) => $query->without('organization')->select('school_id', 'first_name', 'last_name')])->get()
        );

        return collect($rows)->take(self::OFFICER_LIMIT)->map(fn (array $row) => [
            'name' => (string) $row['name'],
            'position' => (string) (($row['position_title'] ?? null) ?: (($row['role'] ?? null) === 'ADMIN' ? 'Admin' : 'Officer')),
        ])->values()->all();
    }
}
