<?php

namespace App\Services\Ai;

use App\Models\ApprovalRequest;
use App\Models\Attendance;
use App\Models\College;
use App\Models\Order;
use App\Models\OrganizationApplication;
use App\Models\StudentRegistryEntry;
use App\Models\User;
use App\Models\VenueBooking;
use App\Services\ApprovalEntityLabel;
use App\Services\Dashboard\ClientRouteAccess;
use App\Services\Finance\ApprovedFeeUsage;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use InvalidArgumentException;

/**
 * Questions the roles ask every day that the older Ask AI intents cannot route: the applications waiting on the
 * SAO or the Department Head, where an organization's own submissions stand, what an AI tool does and where it lives,
 * where a student's membership fees went, which students have not signed up yet, a person's own attendance and claim
 * token, and what a HIUSA word means. Every answer is read from the same records the pages read, scoped to the
 * person asking, and never approves, assigns or publishes anything.
 */
class AskAiRoleIntents
{
    public const INTENTS = ['applications_queue', 'my_submissions', 'ai_tools', 'fee_usage', 'unclaimed_students', 'my_attendance', 'claim_token', 'glossary'];

    private const ROW_LIMIT = 12;

    private const ROLES = [
        'applications_queue' => ['SUPER_ADMIN', 'DEPARTMENT_HEAD'],
        'my_submissions' => ['ADMIN'],
        'ai_tools' => ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD'],
        'fee_usage' => ['STUDENT'],
        'unclaimed_students' => ['SUPER_ADMIN', 'DEPARTMENT_HEAD'],
        'my_attendance' => ['STUDENT'],
        'claim_token' => ['ADMIN', 'SBO_OFFICER', 'STUDENT'],
        'glossary' => ['SUPER_ADMIN', 'DEPARTMENT_HEAD', 'ADMIN', 'SBO_OFFICER', 'STUDENT'],
    ];

    private const APPROVAL_TYPES = ['event', 'budget', 'election', 'announcement', 'financial_report'];

    private const SUBMISSION_LABELS = [
        'event' => 'Event proposal',
        'budget' => 'Budget request',
        'election' => 'Election request',
        'announcement' => 'Announcement',
        'financial_report' => 'Financial report',
        'venue' => 'Venue booking',
    ];

    private const SUBMISSION_PAGES = [
        'event' => '/dashboard/events/manage-events',
        'budget' => '/dashboard/finance/budget-allocation',
        'election' => '/dashboard/elections/manage-elections',
        'announcement' => '/dashboard/announcements/manage-announcements',
        'financial_report' => '/dashboard/finance/transaction-history',
        'venue' => '/dashboard/venues',
    ];

    private const REVIEWER_NAMES = [
        'DEPARTMENT_HEAD' => 'the Department Head',
        'SUPER_ADMIN' => 'SAO',
        'ADMIN' => 'you',
    ];

    private const TOOLS = [
        'forecast' => [
            'title' => 'Financial forecast',
            'does' => 'The forecast reads your past income and spending and estimates the coming months, and it is only an estimate that people weigh before planning around it.',
            'owner' => "your organization's Admin",
            'access' => [
                'ADMIN' => ['/dashboard/finance/financial-insights', 'Make one on the Financial insights page, then read it before you plan around it.', 'Open Financial insights'],
                'SBO_OFFICER' => ['/dashboard/finance/financial-insights', 'Your Admin makes the forecast, and you can read it on the Financial insights page.', 'Read the forecast'],
                'DEPARTMENT_HEAD' => ['/dashboard/finance/financial-insights', "Each organization's Admin makes its forecast, and you can read it on the Financial insights page.", 'Read the forecast'],
            ],
        ],
        'budget_advice' => [
            'title' => 'Budget advice',
            'does' => 'Budget advice suggests a safe spending limit from an approved budget, and your organization decides what to spend.',
            'owner' => "your organization's Admin",
            'access' => [
                'ADMIN' => ['/dashboard/finance/budget-allocation', 'Open the budget and choose advice for a safe-spending limit.', 'Open Budget allocation'],
            ],
        ],
        'task_delegation' => [
            'title' => 'Task delegation',
            'does' => 'Task delegation ranks your officers for a task by their role, workload and past work, and you make the final choice of who gets it.',
            'owner' => "your organization's Admin",
            'access' => [
                'ADMIN' => ['/dashboard/tasks/ai-delegation', 'Open Task delegation, pick the task and look at the ranking before you assign anyone.', 'Open Task delegation'],
            ],
        ],
        'event_planning' => [
            'title' => 'Event planning',
            'does' => 'Event planning drafts a timeline and a task list for your event, and you review and change it before anything is created.',
            'owner' => "your organization's Admin",
            'access' => [
                'ADMIN' => ['/dashboard/events/event-planner', 'Open the Event planner and describe the event to get a first plan.', 'Open Event planner'],
            ],
        ],
        'announcement_draft' => [
            'title' => 'Announcement drafting',
            'does' => 'The announcement page can write a first draft for you to edit, and nothing is posted unless you choose to post it.',
            'owner' => "your organization's Admin or an officer",
            'access' => [
                'ADMIN' => ['/dashboard/announcements/create-announcement', 'Open Create announcement and ask for a draft.', 'Open Create announcement'],
                'SBO_OFFICER' => ['/dashboard/announcements/create-announcement', 'Open Create announcement and ask for a draft.', 'Open Create announcement'],
            ],
        ],
        'report_summary' => [
            'title' => 'Financial report summary',
            'does' => 'A financial report comes with a written summary of its figures, and the people who review the report decide whether to approve it.',
            'owner' => "your organization's Admin",
            'access' => [
                'ADMIN' => ['/dashboard/finance/transaction-history', 'Build the report on the Financial reports page, and the summary comes with it.', 'Open Financial reports'],
                'DEPARTMENT_HEAD' => ['/dashboard/department-head/approvals', 'The summary arrives with each financial report an organization sends you, and you review it and decide.', 'Open approvals'],
            ],
        ],
    ];

    public function __construct(
        private readonly ClientRouteAccess $routeAccess,
        private readonly ApprovalEntityLabel $entityLabels,
        private readonly ApprovedFeeUsage $feeUsage,
        private readonly AskAiGlossary $glossary,
    ) {}

    public function match(string $question, string $role): ?string
    {
        $q = $this->normalize($question);

        $intent = match (true) {
            $this->isHowTo($q) => null,
            $this->glossary->lookup($q) !== null => 'glossary',
            $this->toolFor($q) !== null => 'ai_tools',
            $this->asksClaimToken($q) => 'claim_token',
            $this->asksAttendance($q) => 'my_attendance',
            $this->asksFeeUsage($q) => 'fee_usage',
            $this->asksUnclaimedStudents($q) => 'unclaimed_students',
            $this->asksApplications($q) => 'applications_queue',
            $this->asksVenueBookings($q), $this->asksSubmissions($q) => 'my_submissions',
            default => null,
        };

        return $intent !== null && in_array($role, self::ROLES[$intent], true) ? $intent : null;
    }

    public function allowed(User $user, string $intent): bool
    {
        return in_array($user->role, self::ROLES[$intent] ?? [], true);
    }

    public function build(User $user, string $intent, string $question): array
    {
        return match ($intent) {
            'applications_queue' => $this->buildApplicationsQueue($user),
            'my_submissions' => $this->buildMySubmissions($user, $question),
            'ai_tools' => $this->buildAiTools($user, $question),
            'fee_usage' => $this->buildFeeUsage($user),
            'unclaimed_students' => $this->buildUnclaimedStudents($user),
            'my_attendance' => $this->buildMyAttendance($user),
            'claim_token' => $this->buildClaimToken($user),
            'glossary' => $this->buildGlossary($user, $question),
            default => throw new InvalidArgumentException("Unknown role intent [{$intent}]."),
        };
    }

    // -------------------------------------------------------------------------
    // Matching
    // -------------------------------------------------------------------------

    private function normalize(string $question): string
    {
        $q = Str::lower(str_replace(['’', '‘'], "'", $question));
        $q = preg_replace("/[^a-z0-9' ]+/", ' ', $q);

        return trim((string) preg_replace('/\s+/', ' ', (string) $q));
    }

    private function isHowTo(string $q): bool
    {
        return preg_match('/\b(how (do|can|should|would|could) (i|we)|how to|steps to|walk me through)\b/', $q) === 1;
    }

    // "Endorse" alone is the Department Head's word for every request that waits for them, so it only means applications
    // when the question also says application or applicant.
    private function asksApplications(string $q): bool
    {
        return preg_match('/\b(applications?|applicants?)\b/', $q) === 1
            && preg_match('/\b(waiting|awaiting|pending|need|needs|needing|approve|approval|review|decision|decide|queue|endorse|endorses|endorsed|endorsing|endorsement|endorsements)\b/', $q) === 1;
    }

    private function asksVenueBookings(string $q): bool
    {
        return preg_match('/\b(bookings?|venue (requests?|reservations?)|reserved venues?)\b/', $q) === 1
            || preg_match('/\bvenues?\b/', $q) === 1 && preg_match('/\b(approved|pending|waiting|awaiting|status|confirmed|decided|rejected|returned)\b/', $q) === 1;
    }

    // The tracker answers "where is it" about something the organization sent. A question about compliance files that are
    // missing or late, another page's records (clearance, orders, tasks, fees) or where an event is held is not that.
    private function asksSubmissions(string $q): bool
    {
        if (preg_match('/\b(missing|late|overdue|compliance|haven\'t|havent|not submitted|unsubmitted|clearances?|grievances?|orders?|tasks?|payments?|invoices?|fees?|merch\w*)\b/', $q) === 1) {
            return false;
        }

        $thing = '(proposals?|requests?|submissions?|reports?|budgets?|events?|announcements?|elections?|bookings?)';
        $end = '(?: (?:now|yet|currently|exactly|stuck|so far|already|right now|at the moment|that (?:we|i) (?:sent|submitted|filed)(?: \w+){0,3}|which (?:we|i) (?:sent|submitted|filed)(?: \w+){0,3}))?$';

        return preg_match("/\\bwhere (is|are|did) (my|our) (\\w+ ){0,3}{$thing}{$end}/", $q) === 1
            || preg_match("/\\bwhat (happened|became) to (my|our) (\\w+ ){0,3}{$thing}\\b/", $q) === 1
            || preg_match("/\\b(is|was|has|have|did) (my|our|the) (\\w+ ){0,3}{$thing} (\\w+ ){0,3}(approved|accepted|returned|rejected|reviewed|signed|seen|decided)\\b/", $q) === 1
            || preg_match("/\\bstatus of (my|our) (\\w+ ){0,3}{$thing}\\b/", $q) === 1
            || preg_match('/\\b(my|our) (\\w+ )?(submissions|proposals)\\b/', $q) === 1;
    }

    private function asksFeeUsage(string $q): bool
    {
        return preg_match('/\\bwhere (do|does|did|will|are|is) (my|our|the) (\\w+ ){0,4}(fees?|dues|money|funds|payments?|contributions?) (\\w+ )?(go|goes|going|went)\\b/', $q) === 1
            || preg_match('/\\bhow (is|are|was|were) (my|our|the) (\\S+ ){0,5}(money|funds|fees?|dues|contributions?) (being )?(spent|used)\\b/', $q) === 1
            || preg_match('/\\b(fees?|dues|contributions?) (\\w+ ){0,3}(spent|used on|used for)\\b/', $q) === 1
            || preg_match('/\\bwhat (is|are) (my|our) (\\w+ )?(fees?|dues|contributions?) (used|spent) (for|on)\\b/', $q) === 1
            || preg_match('/\\bhow much (did|has|have|does|do|will) (the|our|my|your) (\\w+ ){0,3}(organi[sz]ation|org|sbo|council|club|society)\\b.{0,30}\\b(spend|spent|use|used)\\b/', $q) === 1
            || preg_match('/\\bhow much (did|have) we (spend|spent)\\b/', $q) === 1
            || preg_match('/\\bwhat (did|does|do|has|have) (the|our|my|your) (\\w+ ){0,3}(organi[sz]ation|org|sbo|council|club|society) (spend|spent|use|used)\\b/', $q) === 1;
    }

    // Students the school records list that have no account: the dean's People page and the SAO's Student records page
    // call them "Not signed up" and "Not yet". Words about an event, an election or an organization are a different sign-up.
    private function asksUnclaimedStudents(string $q): bool
    {
        if (preg_match('/\\b(students?|people|accounts?)\\b/', $q) !== 1
            || preg_match('/\\b(events?|seminars?|workshops?|elections?|votes?|voting|trainings?|class(?:es)?|subjects?|orgs?|organi[sz]ations?|clubs?|tournaments?|activit(?:y|ies)|programs?)\\b/', $q) === 1) {
            return false;
        }

        $negative = "(?:not|haven't|havent|hasn't|hasnt|never|yet to|no|without|still need to|didn't|didnt|aren't|arent|isn't|isnt)";
        $action = '(?:signed up|sign up|signed in|registered|register|created (?:an |their |any )?accounts?|create (?:an |their |any )?accounts?|made (?:an |their |any )?accounts?|joined|activated|claimed (?:their|the|an) (?:accounts?|records?))';

        return preg_match("/\\b{$negative}(?: \\w+){0,3} {$action}\\b/", $q) === 1
            || preg_match('/\\b(?:with no|without|lacking|missing) (?:an |any )?accounts?\\b/', $q) === 1
            || preg_match('/\\bunregistered students?\\b|\\bstudents? (?:who|that) (?:have|has) no accounts?\\b/', $q) === 1;
    }

    // "My claim token" and "my claim code": the code on a paid order. A question about orders to claim is the order queue.
    private function asksClaimToken(string $q): bool
    {
        return preg_match('/\\b(?:claim|pick ?up|pickup) (?:tokens?|codes?)\\b/', $q) === 1
            || preg_match('/\\bmy (?:\\w+ ){0,2}tokens?\\b/', $q) === 1;
    }

    // A student's own attendance, as the Events page shows it. The organizer's attendance sheet is the events intent.
    private function asksAttendance(string $q): bool
    {
        return preg_match('/\\bmy (?:\\w+ )?attendance\\b/', $q) === 1
            || preg_match('/\\b(?:did|have|do) i (?:\\w+ ){0,2}(?:attend|attended|miss|missed|absent)\\b/', $q) === 1
            || preg_match('/\\bhow many (?:events|meetings|activities) (?:did|have|do) i\\b/', $q) === 1
            || preg_match('/\\b(?:events|meetings) i (?:attended|missed|was absent)\\b/', $q) === 1
            || preg_match('/\\bam i (?:marked )?(?:present|absent)\\b/', $q) === 1;
    }

    private function toolFor(string $q): ?string
    {
        $patterns = [
            'report_summary' => '/^(?!.*\b(waiting|awaiting|approval|approve|pending|review)\b).*\b(summari[sz]e|summari[sz]ing|summary of)\b.*\b(financial reports?|(our|the) reports?)\b|\bfinancial report summary\b/',
            'task_delegation' => '/\bwho (should|do|can) (i|we) (assign|give|delegate)\b|\bwho to assign\b|\bassign (this|that|the|a|an) task\b|\bdelegat(e|ion|ing)\b|\bwho should (do|handle|take) (this|the) task\b/',
            'announcement_draft' => '/^(?:(?:hi|hello|hey|ok|okay|so) )?(?:(?:please|can you|could you|would you|will you|help me|help us|i need to|i want to|i would like to|i\'d like to|let me|we need to|we want to) )*(?:write|draft|compose)\b(?: \w+){0,3} announcements?\b|\b(?:writing|drafting) (?:an |a |the |our )?announcements?\b|\bannouncements? draft(?:ing)?\b/',
            'event_planning' => '/\bplan (our|the|an|my|a) (\w+ )?(event|activity)\b|\bevent plann(er|ing)\b|\bevent timeline\b/',
            'budget_advice' => '/\bbudget advice\b|\bspending advice\b|\bsafe[ -]spending\b|\bhow much (can|should) (i|we) spend\b|\badvice on (our |the )?budget\b/',
            'forecast' => '/\bforecast(s|ing)?\b|\bpredict(ing)? (our |the )?(finances|budget|spending|income|expenses)\b/',
        ];

        foreach ($patterns as $tool => $pattern) {
            if (preg_match($pattern, $q) === 1) {
                return $tool;
            }
        }

        return null;
    }

    // -------------------------------------------------------------------------
    // Applications waiting on the SAO or the Department Head
    // -------------------------------------------------------------------------

    private function buildApplicationsQueue(User $user): array
    {
        $role = $user->role;
        $isSao = $role === 'SUPER_ADMIN';
        $waiting = $isSao ? 'pending_sao' : 'pending_dean';
        $other = $isSao ? 'pending_dean' : 'pending_sao';

        $scoped = $this->applicationsFor($user);
        $counts = (clone $scoped)->selectRaw('status, count(*) as total')->whereIn('status', [$waiting, $other])->groupBy('status')->pluck('total', 'status');
        $total = (int) ($counts[$waiting] ?? 0);
        $elsewhere = (int) ($counts[$other] ?? 0);

        $applications = (clone $scoped)->where('status', $waiting)->with('college:id,name')
            ->orderBy($isSao ? 'endorsed_at' : 'submitted_at')->orderBy('id')->limit(self::ROW_LIMIT)->get();

        $rows = $applications->map(function (OrganizationApplication $application) use ($role, $isSao) {
            $since = $isSao ? $application->endorsed_at : $application->submitted_at;
            $applicant = trim("{$application->first_name} {$application->last_name}") ?: 'Applicant';

            return [
                'id' => 'application-'.$application->id,
                'primary' => $application->acronym ? "{$application->name} ({$application->acronym})" : $application->name,
                'secondary' => implode(' · ', array_filter([
                    "Applicant: {$applicant}",
                    $application->college?->name,
                    $application->round > 1 ? 'Round '.$application->round : null,
                    $since ? ($isSao ? 'Endorsed ' : 'Submitted ').$since->format('M j, Y') : null,
                ])),
                'status' => 'Waiting for you',
                'status_tone' => 'warning',
                'meta' => $since ? ($isSao ? 'Endorsed ' : 'Submitted ').$since->diffForHumans() : 'Waiting',
                'href' => $this->routeAccess->hrefFor($role, '/dashboard/organization-applications?record='.$application->id),
                'action_label' => $isSao ? 'Make the final decision' : 'Review and endorse',
            ];
        })->all();

        $oldest = $applications->first();
        $oldestName = $oldest?->name;
        $oldestSince = $oldest ? ($isSao ? $oldest->endorsed_at : $oldest->submitted_at)?->diffForHumans() : null;

        if ($total > 0) {
            $answer = $isSao
                ? sprintf('%s waiting for your final decision. The oldest is %s%s. Open it from the list to approve, return or decline it; the decision is yours, and this assistant does not make it.', $this->count($total, 'application is', 'applications are'), $oldestName, $oldestSince ? ", endorsed {$oldestSince}" : '')
                : sprintf('%s waiting for your endorsement. The oldest is %s%s. Open it from the list to endorse or return it; after you endorse, the SAO makes the final decision.', $this->count($total, 'application from your college is', 'applications from your college are'), $oldestName, $oldestSince ? ", submitted {$oldestSince}" : '');
        } elseif (! $isSao && ! $this->collegeIdOf($user)) {
            $answer = 'Your account is not linked to a college, so no applications can reach you. Ask the SAO to link your account to your college.';
        } else {
            $answer = $isSao
                ? 'No applications are waiting for your decision right now.'.($elsewhere > 0 ? sprintf(' %s still with the Department Heads for endorsement, and they come to you once endorsed.', $this->count($elsewhere, 'application is', 'applications are')) : ' Nothing is waiting with the Department Heads either.')
                : 'No applications are waiting for your endorsement right now.'.($elsewhere > 0 ? sprintf(' %s already endorsed and with the SAO for the final decision.', $this->count($elsewhere, 'application is', 'applications are')) : '');
        }

        return [
            'title' => $isSao ? 'Applications Waiting for Your Decision' : 'Applications Waiting for Your Endorsement',
            'answer' => $answer,
            'highlights' => [
                ['label' => $isSao ? 'Waiting for your decision' : 'Waiting for your endorsement', 'value' => (string) $total, 'tone' => $total > 0 ? 'warning' : 'success'],
                ['label' => $isSao ? 'Still with Department Heads' : 'Endorsed, with the SAO', 'value' => (string) $elsewhere, 'tone' => 'neutral'],
            ],
            'sections' => [
                [
                    'id' => 'applications-queue',
                    'title' => $isSao ? 'Endorsed Applications' : 'Verified Applications',
                    'description' => 'Oldest first, so the application that has waited longest is at the top.',
                    'empty_message' => $isSao ? 'No endorsed applications are waiting for the SAO.' : 'No applications are waiting for your endorsement.',
                    'rows' => $rows,
                ],
            ],
            'follow_ups' => [
                ['topic' => 'pending_approvals', 'label' => 'What else is waiting for my approval?', 'question' => 'What is waiting for my approval right now?'],
                ['topic' => 'daily_priorities', 'label' => 'What should I do today?', 'question' => 'What should I do today?'],
            ],
        ];
    }

    /** The applications this reviewer can see, exactly as the Applications page scopes them. */
    private function applicationsFor(User $user): Builder
    {
        $query = OrganizationApplication::query()->whereNotIn('status', OrganizationApplication::LEGACY_UNQUEUED);

        if ($user->role === 'SUPER_ADMIN') {
            return $query;
        }

        $collegeId = $this->collegeIdOf($user);

        return $collegeId ? $query->where('college_id', $collegeId) : $query->whereRaw('1 = 0');
    }

    private function collegeIdOf(User $user): ?int
    {
        $home = $user->organization;

        return $home?->organization_type === 'COLLEGE' && $home->college_id ? (int) $home->college_id : null;
    }

    // -------------------------------------------------------------------------
    // What an organization has sent for approval
    // -------------------------------------------------------------------------

    private function buildMySubmissions(User $user, string $question): array
    {
        $role = $user->role;
        $organizationId = (int) $user->organization_id;
        $type = $this->submissionType($this->normalize($question));
        $one = $type ? Str::lower(self::SUBMISSION_LABELS[$type]) : 'submission';
        $many = Str::plural($one);

        $latest = $this->latestApprovals($organizationId, $type);
        $approvalCounts = (clone $latest)->selectRaw('status, count(*) as total')->groupBy('status')->pluck('total', 'status');
        $waitingByRole = (clone $latest)->where('status', 'pending')->selectRaw('required_role, count(*) as total')->groupBy('required_role')->pluck('total', 'required_role');
        $rejectedByRole = (clone $latest)->where('status', 'rejected')->selectRaw('required_role, count(*) as total')->groupBy('required_role')->pluck('total', 'required_role');
        $venueCounts = $type === null || $type === 'venue'
            ? VenueBooking::query()->where('organization_id', $organizationId)->whereIn('status', ['pending', 'approved', 'rejected'])
                ->selectRaw('status, count(*) as total')->groupBy('status')->pluck('total', 'status')
            : collect();

        $waitingForYou = (int) ($waitingByRole['ADMIN'] ?? 0);
        $returned = (int) ($approvalCounts['rejected'] ?? 0) - (int) ($rejectedByRole['ADMIN'] ?? 0) + (int) ($venueCounts['rejected'] ?? 0);
        $waiting = (int) ($approvalCounts['pending'] ?? 0) - $waitingForYou + (int) ($venueCounts['pending'] ?? 0);
        $approved = (int) ($approvalCounts['approved'] ?? 0) + (int) ($venueCounts['approved'] ?? 0);
        $withDean = (int) ($waitingByRole['DEPARTMENT_HEAD'] ?? 0);
        $withSao = (int) ($waitingByRole['SUPER_ADMIN'] ?? 0) + (int) ($venueCounts['pending'] ?? 0);

        $items = collect();
        foreach (['rejected', 'pending', 'approved'] as $status) {
            $room = self::ROW_LIMIT - $items->count();
            if ($room <= 0) {
                break;
            }
            $items = $items->concat($this->submissionItems($organizationId, $type, $status, $room));
        }

        $yourStage = fn (array $item) => $item['stage_role'] === 'ADMIN';
        $priority = fn (array $item) => match (true) {
            $item['status'] === 'pending' && $yourStage($item) => 0,
            $item['status'] === 'rejected' && ! $yourStage($item) => 1,
            $item['status'] === 'pending' => 2,
            default => 3,
        };
        $items = $items->sortBy($priority)->values();
        $rows = $items->map(fn (array $item) => $this->submissionRow($role, $item))->all();

        $first = $items->first(fn (array $item) => ! $yourStage($item) && in_array($item['status'], $returned > 0 ? ['rejected'] : ['pending'], true)) ?? $items->first();
        $lead = $waitingForYou > 0
            ? sprintf('%s from your officers %s waiting for your approval. ', $this->count($waitingForYou, $one, $many), $waitingForYou === 1 ? 'is' : 'are')
            : '';
        $answer = $lead.match (true) {
            $returned > 0 => sprintf(
                '%s come back to you for changes. Start with %s, returned by %s%s. Fix it and send it again; the next move is yours.%s',
                $this->count($returned, "{$one} has", "{$many} have"),
                $first['label'],
                self::REVIEWER_NAMES[$first['reviewer_role']] ?? 'the reviewer',
                filled($first['remarks']) ? ': "'.Str::limit(trim((string) $first['remarks']), 160).'"' : ' with no remark left',
                $waiting > 0 ? sprintf(' %d more %s with reviewers.', $waiting, $waiting === 1 ? 'is' : 'are') : ''
            ),
            $waiting > 0 => sprintf(
                'Nothing has been returned to you. %s with reviewers%s. The oldest, %s, was sent %s, and the reviewer decides next.',
                $this->count($waiting, "{$one} is", "{$many} are"),
                $this->waitingBreakdown($withDean, $withSao),
                $first['label'],
                $first['submitted_at']?->diffForHumans() ?? 'earlier'
            ),
            $waitingForYou > 0 => '',
            $approved > 0 => sprintf('%s approved. Nothing is waiting on you or on a reviewer right now.', $approved === 1 ? "Your {$one} is" : "All {$approved} of your {$many} are"),
            default => "Your organization has not sent any {$many} for approval yet. When you are ready, start a request from the Approvals page.",
        };

        return [
            'title' => 'Where Your Submissions Stand',
            'answer' => $answer,
            'highlights' => [
                ['label' => 'Returned to you', 'value' => (string) $returned, 'tone' => $returned > 0 ? 'danger' : 'neutral'],
                ...($waitingForYou > 0 ? [['label' => 'Waiting for you', 'value' => (string) $waitingForYou, 'tone' => 'warning']] : []),
                ['label' => 'Waiting for a reviewer', 'value' => (string) $waiting, 'tone' => $waiting > 0 ? 'warning' : 'neutral'],
                ['label' => 'Approved', 'value' => (string) $approved, 'tone' => $approved > 0 ? 'success' : 'neutral'],
            ],
            'sections' => [
                [
                    'id' => 'my-submissions-list',
                    'title' => 'Your Submissions',
                    'description' => 'What needs you comes first, then returned items, then those waiting for a reviewer, then approved ones.',
                    'empty_message' => 'Your organization has not sent anything for approval yet.',
                    'rows' => $rows,
                ],
            ],
            'follow_ups' => [
                ['topic' => 'missing_submissions', 'label' => "What haven't we submitted yet?", 'question' => "What haven't we submitted yet?"],
                ['topic' => 'daily_priorities', 'label' => 'What should I do today?', 'question' => 'What should I do today for our organization?'],
            ],
        ];
    }

    private function waitingBreakdown(int $withDean, int $withSao): string
    {
        $parts = array_filter([
            $withDean > 0 ? "{$withDean} waiting for the Department Head" : null,
            $withSao > 0 ? "{$withSao} waiting for SAO" : null,
        ]);

        return $parts === [] ? '' : ' ('.implode(' and ', $parts).')';
    }

    private function submissionType(string $q): ?string
    {
        return match (true) {
            preg_match('/\b(venues?|bookings?)\b/', $q) === 1 => 'venue',
            preg_match('/\b(financial|reports?)\b/', $q) === 1 => 'financial_report',
            preg_match('/\bbudgets?\b/', $q) === 1 => 'budget',
            preg_match('/\belections?\b/', $q) === 1 => 'election',
            preg_match('/\bannouncements?\b/', $q) === 1 => 'announcement',
            preg_match('/\b(events?|proposals?)\b/', $q) === 1 => 'event',
            default => null,
        };
    }

    /** The newest approval request of each record the organization sent, so a second stage replaces the first. */
    private function latestApprovals(int $organizationId, ?string $type): Builder
    {
        $newest = ApprovalRequest::query()->selectRaw('MAX(id)')->where('organization_id', $organizationId)
            ->whereIn('entity_type', self::APPROVAL_TYPES)->groupBy('entity_type', 'entity_id');

        return ApprovalRequest::query()->whereIn('id', $newest)
            ->when($type === 'venue', fn (Builder $query) => $query->whereRaw('1 = 0'))
            ->when($type !== null && $type !== 'venue', fn (Builder $query) => $query->where('entity_type', $type));
    }

    /** @return Collection<int, array<string, mixed>> */
    private function submissionItems(int $organizationId, ?string $type, string $status, int $limit): Collection
    {
        $direction = $status === 'pending' ? 'asc' : 'desc';
        $items = collect();

        if ($type !== 'venue') {
            $latest = $this->latestApprovals($organizationId, $type)->with('requester:school_id,first_name,last_name');
            $items = $items->concat($latest->where('status', $status)
                ->orderBy($status === 'pending' ? 'requested_at' : 'reviewed_at', $direction)->orderBy('id', $direction)->limit($limit)->get()
                ->map(fn (ApprovalRequest $approval) => [
                    'key' => 'approval-'.$approval->id,
                    'type' => $approval->entity_type,
                    'label' => $this->entityLabels->for($approval),
                    'status' => $status,
                    'stage_role' => $approval->required_role,
                    'reviewer_role' => $approval->required_role,
                    'remarks' => $approval->remarks,
                    'requester' => trim(($approval->requester?->first_name ?? '').' '.($approval->requester?->last_name ?? '')) ?: 'your officer',
                    'submitted_at' => $approval->requested_at,
                    'decided_at' => $approval->reviewed_at,
                ]));
        }

        if ($type === null || $type === 'venue') {
            $items = $items->concat(VenueBooking::query()->with('venue:id,name')->where('organization_id', $organizationId)->where('status', $status)
                ->orderBy($status === 'pending' ? 'created_at' : 'reviewed_at', $direction)->orderBy('id', $direction)->limit($limit)->get()
                ->map(fn (VenueBooking $booking) => [
                    'key' => 'venue-'.$booking->id,
                    'type' => 'venue',
                    'label' => ($booking->venue?->name ?? $booking->off_campus_location ?? 'Venue').' on '.$booking->start_time?->format('M j, Y'),
                    'status' => $status,
                    'stage_role' => 'SUPER_ADMIN',
                    'reviewer_role' => 'SUPER_ADMIN',
                    'remarks' => $booking->remarks,
                    'submitted_at' => $booking->created_at,
                    'decided_at' => $booking->reviewed_at,
                ]));
        }

        $time = fn (array $item) => ($status === 'pending' ? $item['submitted_at'] : ($item['decided_at'] ?? $item['submitted_at']))?->getTimestamp() ?? 0;

        return $items->sortBy($time, SORT_REGULAR, $direction === 'desc')->take($limit)->values();
    }

    private function submissionRow(string $role, array $item): array
    {
        $typeLabel = self::SUBMISSION_LABELS[$item['type']] ?? Str::headline($item['type']);
        $submitted = $item['submitted_at'] ? 'Submitted '.$item['submitted_at']->format('M j, Y') : 'Submitted';
        $reviewer = self::REVIEWER_NAMES[$item['stage_role']] ?? null;

        if ($item['stage_role'] === 'ADMIN' && in_array($item['status'], ['pending', 'rejected'], true)) {
            return $this->ownStageRow($role, $item, $typeLabel, $submitted);
        }

        [$status, $tone, $secondary, $meta] = match ($item['status']) {
            'rejected' => [
                'Returned to you',
                'danger',
                'Returned to you: '.(filled($item['remarks']) ? Str::limit(trim((string) $item['remarks']), 160) : 'no remark was left')." · {$typeLabel} · {$submitted}",
                $item['decided_at'] ? 'Returned '.$item['decided_at']->diffForHumans() : 'Returned',
            ],
            'pending' => [
                'Waiting for '.($reviewer ?? 'a reviewer'),
                'warning',
                "{$typeLabel} · {$submitted}",
                $item['submitted_at'] ? 'Sent '.$item['submitted_at']->diffForHumans() : 'Waiting',
            ],
            default => [
                'Approved',
                'success',
                "{$typeLabel} · {$submitted}",
                $item['decided_at'] ? 'Approved '.$item['decided_at']->diffForHumans() : 'Approved',
            ],
        };

        $page = self::SUBMISSION_PAGES[$item['type']] ?? '/dashboard/approvals';
        $href = $item['status'] === 'rejected' || $item['type'] === 'venue'
            ? $this->routeAccess->hrefFor($role, $page) ?? $this->routeAccess->hrefFor($role, '/dashboard/approvals')
            : $this->routeAccess->hrefFor($role, '/dashboard/approvals') ?? $this->routeAccess->hrefFor($role, $page);

        return [
            'id' => $item['key'],
            'primary' => $item['label'],
            'secondary' => $secondary,
            'status' => $status,
            'status_tone' => $tone,
            'meta' => $meta,
            'href' => $href,
            'action_label' => $item['status'] === 'rejected' ? 'Fix and resend' : 'Open',
        ];
    }

    /** A request from an officer that waits for this Admin, or that this Admin sent back. */
    private function ownStageRow(string $role, array $item, string $typeLabel, string $submitted): array
    {
        $waiting = $item['status'] === 'pending';

        return [
            'id' => $item['key'],
            'primary' => $item['label'],
            'secondary' => $waiting
                ? "{$typeLabel} from {$item['requester']} · {$submitted}"
                : "You returned this to {$item['requester']}: ".(filled($item['remarks']) ? Str::limit(trim((string) $item['remarks']), 160) : 'no remark was left')." · {$typeLabel} · {$submitted}",
            'status' => $waiting ? 'Waiting for you' : 'You returned this',
            'status_tone' => $waiting ? 'warning' : 'neutral',
            'meta' => $waiting
                ? ($item['submitted_at'] ? 'Sent '.$item['submitted_at']->diffForHumans() : 'Waiting')
                : ($item['decided_at'] ? 'Returned '.$item['decided_at']->diffForHumans() : 'Returned'),
            'href' => $this->routeAccess->hrefFor($role, '/dashboard/approvals'),
            'action_label' => $waiting ? 'Review' : 'Open',
        ];
    }

    // -------------------------------------------------------------------------
    // What an AI tool does and where it lives
    // -------------------------------------------------------------------------

    private function buildAiTools(User $user, string $question): array
    {
        $role = $user->role;
        $key = $this->toolFor($this->normalize($question));
        $mine = array_filter(self::TOOLS, fn (array $tool) => isset($tool['access'][$role]));

        $rowFor = function (string $toolKey, array $tool) use ($role) {
            [$route, , $label] = $tool['access'][$role];

            return [
                'id' => 'tool-'.$toolKey,
                'primary' => $tool['title'],
                'secondary' => $tool['access'][$role][1],
                'status' => 'You can open it',
                'status_tone' => 'primary',
                'meta' => 'A person decides',
                'href' => $this->routeAccess->hrefFor($role, $route),
                'action_label' => $label,
            ];
        };

        $followUps = [
            ['topic' => 'daily_priorities', 'label' => 'What should I do today?', 'question' => 'What should I do today?'],
        ];

        if ($key !== null && ! isset(self::TOOLS[$key]['access'][$role])) {
            $tool = self::TOOLS[$key];
            $others = array_diff_key($mine, [$key => true]);

            return [
                'title' => $tool['title'],
                'answer' => sprintf('%s is only for %s, so you cannot open it. A person makes every decision it supports, so ask %s to run it with you.', $tool['title'], $tool['owner'], $tool['owner']),
                'highlights' => [
                    ['label' => 'Tool', 'value' => $tool['title'], 'tone' => 'primary'],
                    ['label' => 'Who can open it', 'value' => ucfirst($tool['owner']), 'tone' => 'neutral'],
                ],
                'sections' => [$this->otherToolsSection($others, $rowFor)],
                'follow_ups' => $followUps,
            ];
        }

        if ($key !== null) {
            $tool = self::TOOLS[$key];
            $others = array_diff_key($mine, [$key => true]);

            return [
                'title' => $tool['title'],
                'answer' => $tool['does'].' '.$tool['access'][$role][1],
                'highlights' => [
                    ['label' => 'Tool', 'value' => $tool['title'], 'tone' => 'primary'],
                    ['label' => 'Who decides', 'value' => 'A person', 'tone' => 'success'],
                ],
                'sections' => [
                    [
                        'id' => 'ai-tool-link',
                        'title' => 'Where It Lives',
                        'description' => 'This assistant does not run the tool; open it to use it yourself.',
                        'empty_message' => 'This tool has no page you can open.',
                        'rows' => [$rowFor($key, $tool)],
                    ],
                    ...($others === [] ? [] : [$this->otherToolsSection($others, $rowFor)]),
                ],
                'follow_ups' => $followUps,
            ];
        }

        return [
            'title' => 'Tools You Can Open',
            'answer' => $mine === []
                ? 'There are no AI tools for your account. Your organization Admin can open them.'
                : 'These tools help with the work, and a person decides every time: '.implode(', ', array_map(fn (array $tool) => Str::lower($tool['title']), $mine)).'. This assistant does not run them, so open the one you need from the list.',
            'highlights' => [
                ['label' => 'Tools you can open', 'value' => (string) count($mine), 'tone' => 'primary'],
            ],
            'sections' => [$this->otherToolsSection($mine, $rowFor, 'Tools You Can Open')],
            'follow_ups' => $followUps,
        ];
    }

    private function otherToolsSection(array $tools, \Closure $rowFor, string $title = 'Other Tools You Can Open'): array
    {
        $rows = [];
        foreach ($tools as $toolKey => $tool) {
            $rows[] = $rowFor($toolKey, $tool);
        }

        return [
            'id' => 'ai-tools-list',
            'title' => $title,
            'description' => 'Each tool suggests, and the person using it decides.',
            'empty_message' => 'No other tools are open to your account.',
            'rows' => $rows,
        ];
    }

    // -------------------------------------------------------------------------
    // Where a student's membership fees went
    // -------------------------------------------------------------------------

    private function buildFeeUsage(User $user): array
    {
        $role = $user->role;
        $href = $this->routeAccess->hrefFor($role, '/dashboard/finance/where-fees-go');
        $summary = $this->feeUsage->summaryFor($user);
        $organization = $summary['organization']['name'] ?? null;
        $report = $summary['reports'][0] ?? null;
        $money = fn (float $amount) => '₱'.number_format($amount, 2);

        $followUps = [
            ['topic' => 'finance_health', 'label' => 'What fees do I still owe?', 'question' => 'What fees do I still need to pay?'],
            ['topic' => 'daily_priorities', 'label' => 'What do I need to do today?', 'question' => 'What do I need to do today?'],
        ];

        if ($report === null) {
            return [
                'title' => 'Where Your Fees Go',
                'answer' => $organization === null
                    ? 'Your account is not linked to an organization yet, so there are no fee figures to show. Figures appear after the SAO approves your organization\'s financial report.'
                    : "No financial report of {$organization} has been approved yet, so there are no figures to show. Figures appear after the SAO approves the organization's financial report.",
                'highlights' => [],
                'sections' => [
                    [
                        'id' => 'fee-usage-spending',
                        'title' => 'Spending by Category',
                        'description' => 'Taken only from financial reports the SAO has approved.',
                        'empty_message' => 'No approved financial report yet.',
                        'rows' => [],
                    ],
                    ...($href === null ? [] : [[
                        'id' => 'fee-usage-page',
                        'title' => 'Where To Look',
                        'description' => null,
                        'empty_message' => '',
                        'rows' => [[
                            'id' => 'fee-usage-link',
                            'primary' => 'Where your fees go',
                            'secondary' => 'The page shows each approved report as soon as the SAO approves it.',
                            'status' => 'Open page',
                            'status_tone' => 'info',
                            'meta' => null,
                            'href' => $href,
                            'action_label' => 'See where fees go',
                        ]],
                    ]]),
                ],
                'follow_ups' => $followUps,
            ];
        }

        $totals = $report['totals'];
        $period = $report['period_label'] ?? $report['title'];
        $approvedOn = $report['approved_at'] ? Carbon::parse($report['approved_at'])->format('M j, Y') : null;
        $top = $report['spending'][0] ?? null;

        $answer = sprintf(
            '%s collected %s and spent %s, leaving %s, according to its financial report for %s%s.',
            $organization ?? 'Your organization',
            $money($totals['collected']),
            $money($totals['spent']),
            $money($totals['balance']),
            $period,
            $approvedOn ? ", which the SAO approved on {$approvedOn}" : ', which the SAO approved'
        );
        $answer .= $top !== null
            ? sprintf(' The largest share of spending went to %s (%s, %d%%). Only approved reports appear here, so these figures are final.', $top['category'], $money($top['amount']), $top['share_percent'])
            : ' No spending was recorded in that report. Only approved reports appear here, so these figures are final.';

        return [
            'title' => 'Where Your Fees Go',
            'answer' => $answer,
            'highlights' => [
                ['label' => 'Collected', 'value' => $money($totals['collected']), 'tone' => 'primary'],
                ['label' => 'Spent', 'value' => $money($totals['spent']), 'tone' => 'warning'],
                ['label' => 'Balance', 'value' => $money($totals['balance']), 'tone' => $totals['balance'] >= 0 ? 'success' : 'danger'],
            ],
            'sections' => [
                [
                    'id' => 'fee-usage-spending',
                    'title' => 'Spending by Category',
                    'description' => "From the approved financial report for {$period}.",
                    'empty_message' => 'No spending was recorded in this report.',
                    'rows' => array_map(fn (array $row, int $index) => [
                        'id' => 'spend-'.($index + 1),
                        'primary' => $row['category'],
                        'secondary' => $money($row['amount']).' spent',
                        'status' => $row['share_percent'].'% of spending',
                        'status_tone' => 'primary',
                        'meta' => $money($row['amount']),
                        'href' => $href,
                        'action_label' => 'See where fees go',
                    ], array_slice($report['spending'], 0, self::ROW_LIMIT), array_keys(array_slice($report['spending'], 0, self::ROW_LIMIT))),
                ],
            ],
            'follow_ups' => $followUps,
        ];
    }

    // -------------------------------------------------------------------------
    // Which students have not signed up yet
    // -------------------------------------------------------------------------

    private function buildUnclaimedStudents(User $user): array
    {
        $isSao = $user->role === 'SUPER_ADMIN';
        $collegeId = $isSao ? null : $this->collegeIdOf($user);
        $href = $this->routeAccess->hrefFor($user->role, $isSao ? '/dashboard/super-admin/student-records' : '/dashboard/department-head/people?show=not_signed_up');
        $followUps = [['topic' => 'daily_priorities', 'label' => 'What should I do today?', 'question' => 'What should I do today?']];
        $empty = fn (string $answer) => [
            'title' => 'Students Who Have Not Signed Up',
            'answer' => $answer,
            'highlights' => [],
            'sections' => [],
            'follow_ups' => $followUps,
        ];

        if (! $isSao && $collegeId === null) {
            return $empty('Your account is not linked to a college, so there are no student records to count. Ask the SAO to link your account to your college.');
        }

        $records = StudentRegistryEntry::query()->students()->when($collegeId !== null, fn ($query) => $query->where('college_id', $collegeId));
        $total = (clone $records)->count();
        // The same rule as the People page: a school record nobody has claimed and no account carries its number.
        $notSignedUp = (clone $records)->whereNull('claimed_at')
            ->whereNotExists(fn ($account) => $account->select(DB::raw(1))->from('users')->whereColumn('users.school_id', 'student_registry.school_id'));
        $missing = (clone $notSignedUp)->count();
        $scope = $isSao ? '' : ' in your college';

        if ($total === 0) {
            return $empty($isSao
                ? 'There are no student records loaded yet, so there is nobody to count. The school records are uploaded from the Student records page.'
                : 'There are no student records loaded for your college yet, so there is nobody to count. The school records are uploaded from the People page.');
        }

        $groups = $isSao
            ? (clone $notSignedUp)->selectRaw('college_id as grouped, count(*) as total')->groupBy('college_id')
            : (clone $notSignedUp)->selectRaw('program as grouped, count(*) as total')->groupBy('program');
        $groups = $groups->orderByDesc('total')->orderBy('grouped')->limit(self::ROW_LIMIT)->pluck('total', 'grouped');
        $names = $isSao ? College::withTrashed()->whereIn('id', $groups->keys()->all())->pluck('name', 'id') : collect();

        $rows = $groups->map(fn ($count, $key) => [
            'id' => 'unclaimed-'.Str::slug((string) ($isSao ? ($names[$key] ?? $key) : $key)),
            'primary' => (string) ($isSao ? ($names[$key] ?? 'Unknown college') : ($key ?: 'No program on record')),
            'secondary' => $count.' not signed up',
            'status' => 'Not signed up',
            'status_tone' => 'warning',
            'meta' => (string) $count,
            'href' => $href,
            'action_label' => $isSao ? 'Open Student records' : 'Open People',
        ])->values()->all();

        $where = $isSao
            ? 'Open Student records and choose Not yet under Account to see who they are.'
            : 'Open People and choose Not signed up in the Show box to see who they are.';
        $answer = match (true) {
            $missing === 0 => $isSao ? 'Every student in the school records has signed up.' : 'Every student in your college\'s records has signed up.',
            $missing === $total => sprintf('None of the %d student records%s has signed up yet. %s', $total, $scope, $where),
            default => sprintf('%d of the %d student records%s %s not signed up yet. %s', $missing, $total, $scope, $missing === 1 ? 'has' : 'have', $where),
        };

        return [
            'title' => 'Students Who Have Not Signed Up',
            'answer' => $answer,
            'highlights' => [
                ['label' => 'Not signed up', 'value' => (string) $missing, 'tone' => $missing > 0 ? 'warning' : 'success'],
                ['label' => 'Signed up', 'value' => (string) ($total - $missing), 'tone' => 'success'],
                ['label' => 'Student records', 'value' => (string) $total, 'tone' => 'neutral'],
            ],
            'sections' => [[
                'id' => 'unclaimed-students',
                'title' => $isSao ? 'By College' : 'By Program',
                'description' => 'Counts only; the names are on the page.',
                'empty_message' => 'Everyone has signed up.',
                'rows' => $rows,
            ]],
            'follow_ups' => $followUps,
        ];
    }

    // -------------------------------------------------------------------------
    // A student's own attendance
    // -------------------------------------------------------------------------

    private function buildMyAttendance(User $user): array
    {
        $href = $this->routeAccess->hrefFor($user->role, '/dashboard/events/activity-calendar');
        // The same records and rule as the My attendance summary on the Events page: this organization's approved,
        // ongoing and completed events, with excused records left out of the rate.
        $records = Attendance::query()
            ->where('user_id', $user->school_id)
            ->whereHas('event', fn ($event) => $event->where('organization_id', $user->organization_id)->whereIn('status', ['approved', 'ongoing', 'completed']));
        $attended = (clone $records)->whereIn('status', ['present', 'late'])->count();
        $missed = (clone $records)->where('status', 'absent')->count();
        $latest = (clone $records)->with('event:id,title,start_time')->orderByDesc('id')->limit(self::ROW_LIMIT)->get();
        $followUps = [
            ['topic' => 'events_attendance', 'label' => 'What events are coming up?', 'question' => 'What events are coming up?'],
            ['topic' => 'daily_priorities', 'label' => 'What do I need to do today?', 'question' => 'What do I need to do today?'],
        ];

        if ($latest->isEmpty()) {
            return [
                'title' => 'Your Attendance',
                'answer' => 'No attendance has been recorded for you yet. It appears once an organizer checks you in to an event.',
                'highlights' => [],
                'sections' => [],
                'follow_ups' => $followUps,
            ];
        }

        $counted = $attended + $missed;
        $rate = $counted > 0 ? (int) round($attended * 100 / $counted) : null;
        $answer = $rate === null
            ? 'None of your recorded attendance counts toward a rate yet, because the records are excused.'
            : sprintf('You attended %s and missed %d, an attendance rate of %d%%. Excused records are not counted. The Events page shows the same under My attendance.', $this->count($attended, 'event', 'events'), $missed, $rate);
        $tones = ['present' => 'success', 'late' => 'warning', 'absent' => 'danger', 'excused' => 'neutral'];

        return [
            'title' => 'Your Attendance',
            'answer' => $answer,
            'highlights' => [
                ['label' => 'Events attended', 'value' => (string) $attended, 'tone' => 'success'],
                ['label' => 'Events missed', 'value' => (string) $missed, 'tone' => $missed > 0 ? 'warning' : 'success'],
                ['label' => 'Attendance rate', 'value' => $rate === null ? 'Not available' : $rate.'%', 'tone' => 'primary'],
            ],
            'sections' => [[
                'id' => 'my-attendance',
                'title' => 'Your Latest Records',
                'description' => 'Most recent first.',
                'empty_message' => 'No attendance has been recorded for you yet.',
                'rows' => $latest->map(fn (Attendance $record) => [
                    'id' => 'attendance-'.$record->id,
                    'primary' => (string) ($record->event?->title ?? 'Event'),
                    'secondary' => $record->event?->start_time?->format('M j, Y'),
                    'status' => ucfirst((string) ($record->status ?? 'present')),
                    'status_tone' => $tones[$record->status ?? 'present'] ?? 'neutral',
                    'meta' => null,
                    'href' => $href,
                    'action_label' => 'Open the events page',
                ])->all(),
            ]],
            'follow_ups' => $followUps,
        ];
    }

    // -------------------------------------------------------------------------
    // Where a person's claim token is
    // -------------------------------------------------------------------------

    // The token itself stays on the Claim tokens page: an answer here is stored and may be sent to a writing service, so it
    // names the orders and where their tokens are and never prints a code.
    private function buildClaimToken(User $user): array
    {
        $tokens = $this->routeAccess->hrefFor($user->role, '/dashboard/merchandise/claim-tokens');
        $shop = $this->routeAccess->hrefFor($user->role, '/dashboard/merchandise/order-merchandise');
        $orders = Order::query()->where('student_id', $user->school_id);
        $counts = (clone $orders)->selectRaw('status, count(*) as total')->groupBy('status')->pluck('total', 'status');
        $ready = (int) ($counts['paid'] ?? 0);
        $waiting = (int) ($counts['pending'] ?? 0);
        $claimed = (int) ($counts['claimed'] ?? 0);
        $followUps = [
            ['topic' => 'merchandise_orders', 'label' => 'Is my order ready to claim?', 'question' => 'Is my merchandise order ready to claim?'],
            ['topic' => 'daily_priorities', 'label' => 'What do I need to do today?', 'question' => 'What do I need to do today?'],
        ];
        $page = fn (string $label, ?string $link) => $link === null ? [] : [[
            'id' => 'claim-token-page',
            'title' => 'Where To Look',
            'description' => null,
            'empty_message' => '',
            'rows' => [[
                'id' => 'claim-token-link',
                'primary' => $label,
                'secondary' => null,
                'status' => 'Open page',
                'status_tone' => 'info',
                'meta' => null,
                'href' => $link,
                'action_label' => $label,
            ]],
        ]];

        if ($ready === 0 && $waiting === 0 && $claimed === 0) {
            return [
                'title' => 'Your Claim Token',
                'answer' => 'You have no orders yet, so there is no claim token. You can order from the shop, and the token appears on the Claim tokens page once your payment is verified.',
                'highlights' => [],
                'sections' => $page('Open the shop', $shop),
                'follow_ups' => $followUps,
            ];
        }

        if ($ready === 0) {
            return [
                'title' => 'Your Claim Token',
                'answer' => $waiting > 0
                    ? sprintf('None of your orders is paid yet, so you have no claim token yet. %s still waiting for payment to be checked, and the token appears on the Claim tokens page once it is.', $this->count($waiting, 'order is', 'orders are'))
                    : 'All of your orders have already been claimed, so there is no token left to use.',
                'highlights' => [
                    ['label' => 'Waiting for payment', 'value' => (string) $waiting, 'tone' => $waiting > 0 ? 'warning' : 'neutral'],
                    ['label' => 'Already claimed', 'value' => (string) $claimed, 'tone' => 'neutral'],
                ],
                'sections' => $page('Open my orders', $this->routeAccess->hrefFor($user->role, '/dashboard/merchandise/my-orders')),
                'follow_ups' => $followUps,
            ];
        }

        $rows = (clone $orders)->where('status', 'paid')->with('merchandise:id,name')->orderByDesc('id')->limit(self::ROW_LIMIT)->get()
            ->map(fn (Order $order) => [
                'id' => 'claim-order-'.$order->id,
                'primary' => 'Order ORD-'.$order->id,
                'secondary' => trim(($order->merchandise?->name ?? 'Merchandise').' x '.(int) $order->quantity.' · ₱'.number_format((float) $order->total_price, 2)),
                'status' => 'Ready to claim',
                'status_tone' => 'success',
                'meta' => '₱'.number_format((float) $order->total_price, 2),
                'href' => $tokens,
                'action_label' => 'Open Claim tokens',
            ])->all();

        $answer = sprintf('%s paid and ready to claim. Your claim token for each one is on the Claim tokens page; show it at the claim desk to receive the item.', $this->count($ready, 'of your orders is', 'of your orders are'));
        if ($waiting > 0) {
            $answer .= sprintf(' %s still waiting for payment to be checked, and its token appears once it is.', $this->count($waiting, 'more order is', 'more orders are'));
        }

        return [
            'title' => 'Your Claim Token',
            'answer' => $answer,
            'highlights' => [
                ['label' => 'Ready to claim', 'value' => (string) $ready, 'tone' => 'success'],
                ['label' => 'Waiting for payment', 'value' => (string) $waiting, 'tone' => $waiting > 0 ? 'warning' : 'neutral'],
                ['label' => 'Already claimed', 'value' => (string) $claimed, 'tone' => 'neutral'],
            ],
            'sections' => [[
                'id' => 'claim-orders',
                'title' => 'Orders Ready To Claim',
                'description' => 'The token for each is on the Claim tokens page.',
                'empty_message' => 'No order is ready to claim.',
                'rows' => $rows,
            ]],
            'follow_ups' => $followUps,
        ];
    }

    // -------------------------------------------------------------------------
    // What a HIUSA word means
    // -------------------------------------------------------------------------

    private function buildGlossary(User $user, string $question): array
    {
        $key = $this->glossary->lookup($this->normalize($question));
        if ($key === null) {
            return [
                'title' => 'What a word means',
                'answer' => 'I can explain these words: '.implode(', ', array_column(AskAiGlossary::TERMS, 'title')).'. Ask, for example, "What is the SAO?".',
                'highlights' => [],
                'sections' => [],
                'follow_ups' => [['topic' => 'glossary', 'label' => 'What is the SAO?', 'question' => 'What is the SAO?']],
            ];
        }
        $term = AskAiGlossary::TERMS[$key];
        [$path, $label] = $term['pages'][$user->role] ?? [null, null];
        $href = $path === null ? null : $this->routeAccess->hrefFor($user->role, $path);

        return [
            'title' => $term['title'],
            'answer' => $term['means'],
            'highlights' => [],
            'sections' => $href === null ? [] : [[
                'id' => 'glossary-page',
                'title' => 'Where To See It',
                'description' => null,
                'empty_message' => '',
                'rows' => [[
                    'id' => 'glossary-link',
                    'primary' => $label,
                    'secondary' => null,
                    'status' => 'Open page',
                    'status_tone' => 'info',
                    'meta' => null,
                    'href' => $href,
                    'action_label' => $label,
                ]],
            ]],
            'follow_ups' => [['topic' => 'daily_priorities', 'label' => 'What should I do today?', 'question' => 'What should I do today?']],
        ];
    }

    private function count(int $number, string $singular, string $plural): string
    {
        return $number.' '.($number === 1 ? $singular : $plural);
    }
}
