<?php

namespace App\Services\Ai;

use App\Models\AcademicSemester;
use App\Models\AiOutput;
use App\Models\ApprovalRequest;
use App\Models\ComplianceRequirementType;
use App\Models\Event;
use App\Models\EventRequirement;
use App\Models\EventRequirementFile;
use App\Models\Organization;
use App\Models\OrganizationComplianceSubmission;
use App\Models\User;
use App\Services\ApprovalEntityLabel;
use App\Services\Compliance\AccreditationStatusService;
use App\Services\Dashboard\ClientRouteAccess;
use App\Services\GroqResponsesService;
use App\Services\StudentAccountBalances;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class AskAiService
{
    private const ROW_LIMIT = 12;

    public function __construct(
        private readonly AccreditationStatusService $accreditation,
        private readonly ApprovalEntityLabel $entityLabels,
        private readonly ClientRouteAccess $routeAccess,
        private readonly StudentAccountBalances $balances,
        private readonly GroqResponsesService $groq,
    ) {}

    public function overview(User $user): array
    {
        $daily = $this->answer($user, $this->defaultDailyQuestion($user->role), 'daily_priorities', false);

        return [
            'role' => $user->role,
            'role_label' => $this->roleLabel($user->role),
            'scope_label' => $this->scopeLabel($user),
            'daily_briefing' => [
                'title' => $daily['title'],
                'summary' => $daily['answer'],
                'highlights' => $daily['highlights'],
                'priorities' => $this->extractPriorityCards($daily['sections']),
                'sections' => $daily['sections'],
            ],
            'suggested_questions' => $this->suggestedQuestions($user->role),
            'recent_queries' => $this->recentQueries($user),
        ];
    }

    public function ask(User $user, string $question, ?string $topic = null): array
    {
        $cleanQuestion = trim($question);
        $intent = $this->classifyIntent($cleanQuestion, $topic, $user->role);
        $response = $this->answer($user, $cleanQuestion, $intent, true);

        $aiOutput = AiOutput::create([
            'organization_id' => $user->organization_id,
            'feature_type' => 'ASK_AI_ASSISTANT',
            'reference_type' => User::class,
            'reference_id' => $user->school_id,
            'prompt_text' => $cleanQuestion,
            'output_text' => $response['answer'],
            'model_name' => $response['model_name'],
            'context_version' => 'ask-ai-v1',
            'structured_input' => [
                'question' => $cleanQuestion,
                'topic' => $topic,
                'intent' => $intent,
                'role' => $user->role,
            ],
            'structured_output' => [
                'title' => $response['title'],
                'highlights' => $response['highlights'],
                'section_count' => count($response['sections']),
            ],
            'status' => 'completed',
            'decision_status' => 'accepted',
            'requested_by' => $user->school_id,
            'decided_by' => $user->school_id,
            'decided_at' => now(),
            'created_at' => now(),
        ]);

        return [
            'id' => $aiOutput->id,
            'question' => $cleanQuestion,
            'intent' => $intent,
            'title' => $response['title'],
            'answer' => $response['answer'],
            'highlights' => $response['highlights'],
            'sections' => $response['sections'],
            'follow_ups' => $response['follow_ups'],
            'generated_at' => now()->toIso8601String(),
            'engine' => $response['model_name'] ? 'groq+deterministic' : 'deterministic',
        ];
    }

    public function classifyIntent(string $question, ?string $topic, string $role): string
    {
        $validTopics = [
            'daily_priorities',
            'missing_submissions',
            'submitted_documents',
            'pending_approvals',
            'organizations_without_admin',
            'tasks_workload',
            'finance_health',
            'merchandise_orders',
            'events_attendance',
            'clearances_status',
            'elections_status',
            'grievances_status',
        ];

        if ($topic !== null && in_array($topic, $validTopics, true)) {
            return $topic;
        }

        $q = Str::lower($question);

        if (Str::contains($q, [
            "haven't submitted",
            'havent submitted',
            "hasn't submitted",
            'hasnt submitted',
            'not submitted',
            'not yet submitted',
            'unsubmitted',
            'missing',
            'incomplete',
            'lacking',
            'overdue report',
            'who has not submitted',
            'which orgs have not',
        ])) {
            return 'missing_submissions';
        }

        if (Str::contains($q, [
            'who submitted',
            'who has submitted',
            'who have submitted',
            'already submitted',
            'submitted document',
            'submitted file',
            'submitted compliance',
            'submitted report',
            'what have we submitted',
            'what documents were submitted',
        ])) {
            return 'submitted_documents';
        }

        if (Str::contains($q, ['without admin', 'no admin', 'missing admin', 'awaiting admin', 'returned registration'])) {
            return 'organizations_without_admin';
        }

        if (Str::contains($q, ['grievance', 'complaint', 'concern'])) {
            return $role === 'SUPER_ADMIN' ? 'grievances_status' : 'daily_priorities';
        }

        if (Str::contains($q, ['clearance', 'signatory', 'signatories', 'held clearance', 'signed my clearance'])) {
            return 'clearances_status';
        }

        if (Str::contains($q, ['order', 'merch', 'claim', 'payment proof', 'verify payment'])) {
            return 'merchandise_orders';
        }

        if (Str::contains($q, ['task', 'workload', 'assigned', 'assignee', 'overdue task', 'officer task'])) {
            return 'tasks_workload';
        }

        if (Str::contains($q, [
            'budget',
            'finance',
            'financial',
            'spent',
            'spending',
            'fee',
            'invoice',
            'debt',
            'owe',
            'unpaid',
            'collection',
            'paid',
        ])) {
            return 'finance_health';
        }

        if (Str::contains($q, ['election', 'vote', 'voted', 'ballot', 'turnout', 'candidate'])) {
            return 'elections_status';
        }

        if (Str::contains($q, ['event', 'attendance', 'calendar', 'check-in', 'ongoing event'])) {
            return 'events_attendance';
        }

        if (Str::contains($q, ['approval', 'approve', 'pending review', 'waiting for review', 'venue booking', 'registration'])) {
            return 'pending_approvals';
        }

        return 'daily_priorities';
    }

    private function answer(User $user, string $question, string $intent, bool $allowGroq): array
    {
        $organizationIds = $this->scopedStudentOrganizationIds($user);

        $payload = match ($intent) {
            'missing_submissions' => $this->buildMissingSubmissions($user, $organizationIds),
            'submitted_documents' => $this->buildSubmittedDocuments($user, $organizationIds),
            'pending_approvals' => $this->buildPendingApprovals($user, $organizationIds),
            'organizations_without_admin' => $this->buildOrganizationsWithoutAdmin($user, $organizationIds),
            'tasks_workload' => $this->buildTasksWorkload($user, $organizationIds),
            'finance_health' => $this->buildFinanceHealth($user, $organizationIds),
            'merchandise_orders' => $this->buildMerchandiseOrders($user),
            'events_attendance' => $this->buildEventsAttendance($user, $organizationIds),
            'clearances_status' => $this->buildClearancesStatus($user, $organizationIds),
            'elections_status' => $this->buildElectionsStatus($user, $organizationIds),
            'grievances_status' => $this->buildGrievancesStatus($user),
            default => $this->buildDailyPriorities($user, $organizationIds),
        };

        $modelName = null;
        if ($allowGroq) {
            $enhanced = $this->enhanceWithGroq($user, $question, $payload);
            if ($enhanced !== null) {
                $payload['answer'] = $enhanced['text'];
                $modelName = $enhanced['model'];
            }
        }

        $payload['model_name'] = $modelName;

        return $payload;
    }

    // -------------------------------------------------------------------------
    // Intent 1: Daily Priorities ("What should I do today?")
    // -------------------------------------------------------------------------

    private function buildDailyPriorities(User $user, Collection $organizationIds): array
    {
        $role = $user->role;

        if ($role === 'SUPER_ADMIN') {
            $pendingRegistrations = DB::table('organizations')
                ->where('organization_type', 'STUDENT_ORGANIZATION')
                ->where('lifecycle_status', 'pending')
                ->count();
            $pendingCompliance = DB::table('organization_compliance_submissions')
                ->where('status', 'submitted')
                ->count();
            $pendingApprovals = ApprovalRequest::where('required_role', 'SUPER_ADMIN')
                ->where('status', 'pending')
                ->count();
            $pendingVenues = DB::table('venue_bookings')->where('status', 'pending')->count();
            $urgentGrievances = DB::table('grievances')
                ->whereNotIn('status', ['resolved', 'dismissed'])
                ->whereIn('urgency', ['high', 'critical'])
                ->count();
            $pendingClearances = DB::table('clearance_signatures')
                ->whereNull('retired_at')
                ->where('required_role', 'sao')
                ->where('status', 'pending')
                ->count();

            $accreditation = $this->accreditation->forOrganizations($organizationIds);
            $incompleteOrgs = collect($accreditation)->filter(fn (string $status) => in_array($status, ['incomplete', 'returned'], true))->count();

            $queueRows = [];
            if ($urgentGrievances > 0) {
                $queueRows[] = [
                    'id' => 'prio-grievances',
                    'primary' => 'Resolve high or critical urgency student grievances',
                    'secondary' => "{$urgentGrievances} urgent grievance(s) require immediate SAO attention.",
                    'status' => 'High priority',
                    'status_tone' => 'danger',
                    'meta' => "{$urgentGrievances} open",
                    'href' => $this->routeAccess->hrefFor($role, '/dashboard/super-admin/grievances'),
                    'action_label' => 'Open grievances',
                ];
            }
            if ($pendingRegistrations > 0) {
                $queueRows[] = [
                    'id' => 'prio-registrations',
                    'primary' => 'Review pending student organization registrations',
                    'secondary' => "{$pendingRegistrations} organization registration(s) are waiting for SAO decision.",
                    'status' => 'Pending review',
                    'status_tone' => 'warning',
                    'meta' => "{$pendingRegistrations} pending",
                    'href' => $this->routeAccess->hrefFor($role, '/dashboard/super-admin/organizations?status=pending'),
                    'action_label' => 'Review registrations',
                ];
            }
            if ($pendingCompliance > 0) {
                $queueRows[] = [
                    'id' => 'prio-compliance',
                    'primary' => 'Audit submitted compliance and accreditation files',
                    'secondary' => "{$pendingCompliance} compliance document(s) have been uploaded by organizations and await review.",
                    'status' => 'Pending review',
                    'status_tone' => 'warning',
                    'meta' => "{$pendingCompliance} submitted",
                    'href' => $this->routeAccess->hrefFor($role, '/dashboard/super-admin/compliance?tab=review'),
                    'action_label' => 'Review compliance',
                ];
            }
            if ($pendingApprovals > 0) {
                $queueRows[] = [
                    'id' => 'prio-approvals',
                    'primary' => 'Process SAO approval requests (events & financial reports)',
                    'secondary' => "{$pendingApprovals} request(s) have cleared initial stages and await final SAO sign-off.",
                    'status' => 'Awaiting SAO',
                    'status_tone' => 'warning',
                    'meta' => "{$pendingApprovals} queued",
                    'href' => $this->routeAccess->hrefFor($role, '/dashboard/super-admin/compliance'),
                    'action_label' => 'Open queue',
                ];
            }
            if ($pendingVenues > 0) {
                $queueRows[] = [
                    'id' => 'prio-venues',
                    'primary' => 'Confirm pending campus venue bookings',
                    'secondary' => "{$pendingVenues} venue booking request(s) need scheduling confirmation.",
                    'status' => 'Pending venue',
                    'status_tone' => 'info',
                    'meta' => "{$pendingVenues} pending",
                    'href' => $this->routeAccess->hrefFor($role, '/dashboard/super-admin/venues'),
                    'action_label' => 'Open venues',
                ];
            }
            if ($pendingClearances > 0) {
                $queueRows[] = [
                    'id' => 'prio-clearances',
                    'primary' => 'Sign pending SAO student clearance lines',
                    'secondary' => "{$pendingClearances} student clearance signature(s) are waiting at the SAO stage.",
                    'status' => 'Pending signature',
                    'status_tone' => 'info',
                    'meta' => "{$pendingClearances} students",
                    'href' => $this->routeAccess->hrefFor($role, '/dashboard/super-admin/clearances'),
                    'action_label' => 'Open clearances',
                ];
            }
            if ($incompleteOrgs > 0) {
                $queueRows[] = [
                    'id' => 'prio-incomplete-orgs',
                    'primary' => 'Follow up with organizations missing compliance requirements',
                    'secondary' => "{$incompleteOrgs} student organization(s) still have incomplete or returned compliance requirements.",
                    'status' => 'Follow up',
                    'status_tone' => 'neutral',
                    'meta' => "{$incompleteOrgs} org(s)",
                    'href' => $this->routeAccess->hrefFor($role, '/dashboard/super-admin/compliance'),
                    'action_label' => 'View compliance',
                ];
            }

            $totalActionItems = $urgentGrievances + $pendingRegistrations + $pendingCompliance + $pendingApprovals + $pendingVenues + $pendingClearances;
            $answer = $totalActionItems > 0
                ? "Today you have {$totalActionItems} university-wide item(s) awaiting SAO action: {$pendingRegistrations} pending organization registration(s), {$pendingCompliance} compliance submission(s), {$pendingApprovals} final approval request(s), {$pendingVenues} venue booking(s), {$pendingClearances} clearance signature(s), and {$urgentGrievances} urgent grievance(s). Additionally, {$incompleteOrgs} organization(s) still have incomplete or returned compliance requirements."
                : "All primary SAO review queues (registrations, compliance reviews, approvals, venue bookings, urgent grievances, and clearances) are clear right now. {$incompleteOrgs} organization(s) currently have incomplete or returned compliance requirements that you can monitor.";

            return [
                'title' => "Today's SAO Action Plan",
                'answer' => $answer,
                'highlights' => [
                    ['label' => 'Total action items', 'value' => (string) $totalActionItems, 'tone' => $totalActionItems > 0 ? 'warning' : 'success'],
                    ['label' => 'Compliance to review', 'value' => (string) $pendingCompliance, 'tone' => $pendingCompliance > 0 ? 'warning' : 'neutral'],
                    ['label' => 'Pending approvals', 'value' => (string) ($pendingApprovals + $pendingRegistrations), 'tone' => ($pendingApprovals + $pendingRegistrations) > 0 ? 'primary' : 'neutral'],
                    ['label' => 'Incomplete orgs', 'value' => (string) $incompleteOrgs, 'tone' => $incompleteOrgs > 0 ? 'danger' : 'success'],
                ],
                'sections' => [
                    [
                        'id' => 'sao-daily-queues',
                        'title' => 'Prioritized SAO Queues for Today',
                        'description' => 'Items ordered by urgency across university-wide oversight queues.',
                        'empty_message' => 'Every SAO queue is clear today.',
                        'rows' => $queueRows,
                    ],
                ],
                'follow_ups' => [
                    ['topic' => 'missing_submissions', 'label' => "Who hasn't submitted requirements?", 'question' => "Which organizations haven't submitted compliance or financial reports?"],
                    ['topic' => 'submitted_documents', 'label' => 'Who submitted files for review?', 'question' => 'Who has submitted compliance documents or reports for review?'],
                    ['topic' => 'organizations_without_admin', 'label' => 'Organizations needing an admin', 'question' => 'Which active organizations still need an administrator?'],
                ],
            ];
        }

        if ($role === 'DEPARTMENT_HEAD') {
            $orgIds = $organizationIds->all();
            $pendingApprovals = ApprovalRequest::where('required_role', 'DEPARTMENT_HEAD')
                ->where('status', 'pending')
                ->whereIn('organization_id', $orgIds)
                ->count();
            $returnedOrgs = DB::table('organizations')
                ->whereIn('id', $orgIds)
                ->where('lifecycle_status', 'returned')
                ->count();
            $orgsWithoutAdmin = DB::table('organizations')
                ->whereIn('id', $orgIds)
                ->where('lifecycle_status', 'active')
                ->whereNotExists(fn ($q) => $q->selectRaw('1')->from('account_profiles')
                    ->whereColumn('account_profiles.organization_id', 'organizations.id')
                    ->where('account_profiles.role', 'ADMIN')
                    ->where('account_profiles.account_status', 'active'))
                ->count();
            $pendingReports = DB::table('financial_reports')
                ->whereIn('organization_id', $orgIds)
                ->where('submission_status', 'pending_department_head')
                ->count();

            $rows = [];
            if ($pendingApprovals > 0) {
                $rows[] = [
                    'id' => 'dh-approvals',
                    'primary' => 'Review pending college organization approvals',
                    'secondary' => "{$pendingApprovals} budget, event, or financial report request(s) await your endorsement.",
                    'status' => 'Action needed',
                    'status_tone' => 'warning',
                    'meta' => "{$pendingApprovals} pending",
                    'href' => $this->routeAccess->hrefFor($role, '/dashboard/approvals'),
                    'action_label' => 'Open approvals',
                ];
            }
            if ($pendingReports > 0) {
                $rows[] = [
                    'id' => 'dh-reports',
                    'primary' => 'Endorse submitted financial reports',
                    'secondary' => "{$pendingReports} financial report(s) from your college organizations await Department Head review.",
                    'status' => 'Pending review',
                    'status_tone' => 'warning',
                    'meta' => "{$pendingReports} report(s)",
                    'href' => $this->routeAccess->hrefFor($role, '/dashboard/department-head/compliance'),
                    'action_label' => 'Review reports',
                ];
            }
            if ($returnedOrgs > 0) {
                $rows[] = [
                    'id' => 'dh-returned',
                    'primary' => 'Resubmit returned organization registrations',
                    'secondary' => "{$returnedOrgs} organization registration(s) were returned by the SAO with remarks.",
                    'status' => 'Returned',
                    'status_tone' => 'danger',
                    'meta' => "{$returnedOrgs} returned",
                    'href' => $this->routeAccess->hrefFor($role, '/dashboard/department-head/organizations'),
                    'action_label' => 'Manage organizations',
                ];
            }
            if ($orgsWithoutAdmin > 0) {
                $rows[] = [
                    'id' => 'dh-no-admin',
                    'primary' => 'Coordinate administrator assignment for active organizations',
                    'secondary' => "{$orgsWithoutAdmin} active organization(s) in your college do not have an active administrator yet.",
                    'status' => 'Awaiting admin',
                    'status_tone' => 'info',
                    'meta' => "{$orgsWithoutAdmin} org(s)",
                    'href' => $this->routeAccess->hrefFor($role, '/dashboard/department-head/organizations'),
                    'action_label' => 'View organizations',
                ];
            }

            $total = $pendingApprovals + $returnedOrgs + $orgsWithoutAdmin;
            $answer = $total > 0
                ? "Across your college's {$organizationIds->count()} student organization(s), you have {$pendingApprovals} pending approval request(s), {$returnedOrgs} returned registration(s) needing revision, and {$orgsWithoutAdmin} active organization(s) awaiting an administrator."
                : "Your college oversight queue is clear today across all {$organizationIds->count()} student organization(s). There are 0 pending Department Head approvals and 0 returned registrations.";

            return [
                'title' => "Today's College Oversight Plan",
                'answer' => $answer,
                'highlights' => [
                    ['label' => 'College organizations', 'value' => (string) $organizationIds->count(), 'tone' => 'primary'],
                    ['label' => 'Pending approvals', 'value' => (string) $pendingApprovals, 'tone' => $pendingApprovals > 0 ? 'warning' : 'success'],
                    ['label' => 'Returned registrations', 'value' => (string) $returnedOrgs, 'tone' => $returnedOrgs > 0 ? 'danger' : 'neutral'],
                    ['label' => 'Awaiting admin', 'value' => (string) $orgsWithoutAdmin, 'tone' => $orgsWithoutAdmin > 0 ? 'warning' : 'neutral'],
                ],
                'sections' => [
                    [
                        'id' => 'dh-daily-priorities',
                        'title' => 'College Priorities for Today',
                        'description' => 'Direct actions across your college organizations and endorsement queues.',
                        'empty_message' => 'No pending endorsements or returned registrations require action today.',
                        'rows' => $rows,
                    ],
                ],
                'follow_ups' => [
                    ['topic' => 'pending_approvals', 'label' => 'What needs my approval?', 'question' => 'What requests are waiting for my approval right now?'],
                    ['topic' => 'missing_submissions', 'label' => "Which college orgs haven't submitted?", 'question' => "Which college organizations haven't submitted compliance or financial reports?"],
                    ['topic' => 'submitted_documents', 'label' => 'Who submitted reports or files?', 'question' => 'Who has submitted budgets, events, or financial reports for my review?'],
                ],
            ];
        }

        if ($role === 'STUDENT') {
            $orgId = (int) $user->organization_id;
            $balanceRow = $this->balances->rows(collect([$user]), $orgId)->first();
            $owedTotal = (float) ($balanceRow['total_debt'] ?? 0);
            $unpaidInvoices = (int) ($balanceRow['unpaid_invoice_count'] ?? 0);

            $clearanceCounts = DB::table('clearance_signatures')
                ->whereNull('retired_at')
                ->where('student_id', $user->school_id)
                ->selectRaw("SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending, SUM(CASE WHEN status = 'held' THEN 1 ELSE 0 END) as held")
                ->first();
            $pendingClearance = (int) ($clearanceCounts->pending ?? 0);
            $heldClearance = (int) ($clearanceCounts->held ?? 0);

            $readyOrders = DB::table('orders')
                ->where('organization_id', $orgId)
                ->where('student_id', $user->school_id)
                ->where('status', 'paid')
                ->count();

            $activeElection = DB::table('elections')
                ->where('organization_id', $orgId)
                ->where('status', 'active')
                ->first(['id', 'title', 'end_time']);
            $needsToVote = $activeElection
                ? ! DB::table('votes')->where('election_id', $activeElection->id)->where('voter_id', $user->school_id)->exists()
                : false;

            $rows = [];
            if ($heldClearance > 0 || $pendingClearance > 0) {
                $rows[] = [
                    'id' => 'stu-clearance',
                    'primary' => $heldClearance > 0 ? 'Resolve held clearance signature(s)' : 'Track pending clearance signatures',
                    'secondary' => "{$heldClearance} held and {$pendingClearance} pending signatory line(s) on your clearance.",
                    'status' => $heldClearance > 0 ? 'Held' : 'In progress',
                    'status_tone' => $heldClearance > 0 ? 'danger' : 'warning',
                    'meta' => ($heldClearance + $pendingClearance).' remaining',
                    'href' => $this->routeAccess->hrefFor($role, '/dashboard/my-clearance'),
                    'action_label' => 'View clearance',
                ];
            }
            if ($unpaidInvoices > 0) {
                $rows[] = [
                    'id' => 'stu-fees',
                    'primary' => 'Settle open organization fees or invoices',
                    'secondary' => sprintf('You have %d open invoice(s) totaling ₱%s.', $unpaidInvoices, number_format($owedTotal, 2)),
                    'status' => 'Unpaid balance',
                    'status_tone' => 'warning',
                    'meta' => '₱'.number_format($owedTotal, 2),
                    'href' => $this->routeAccess->hrefFor($role, '/dashboard/finance/statement-of-account'),
                    'action_label' => 'Check balance',
                ];
            }
            if ($needsToVote && $activeElection) {
                $rows[] = [
                    'id' => 'stu-vote',
                    'primary' => 'Cast your ballot in '.$activeElection->title,
                    'secondary' => 'Voting is currently open for your organization.',
                    'status' => 'Election open',
                    'status_tone' => 'info',
                    'meta' => 'Vote now',
                    'href' => $this->routeAccess->hrefFor($role, '/dashboard/elections/cast-vote'),
                    'action_label' => 'Cast vote',
                ];
            }
            if ($readyOrders > 0) {
                $rows[] = [
                    'id' => 'stu-orders',
                    'primary' => 'Claim your paid merchandise order(s)',
                    'secondary' => "{$readyOrders} order(s) are verified and ready for pickup.",
                    'status' => 'Ready to claim',
                    'status_tone' => 'success',
                    'meta' => "{$readyOrders} order(s)",
                    'href' => $this->routeAccess->hrefFor($role, '/dashboard/merchandise/my-orders'),
                    'action_label' => 'My orders',
                ];
            }

            $answer = count($rows) > 0
                ? sprintf(
                    'Today you have %d item(s) to check: %d held and %d pending clearance signature(s), %d open invoice(s) (₱%s balance), %d order(s) ready to claim, and %s.',
                    count($rows),
                    $heldClearance,
                    $pendingClearance,
                    $unpaidInvoices,
                    number_format($owedTotal, 2),
                    $readyOrders,
                    $needsToVote ? '1 active election awaiting your vote' : '0 unvoted active elections'
                )
                : 'You are all caught up today! Your account has 0 held clearances, 0 unpaid invoices, and no unvoted active elections.';

            return [
                'title' => "Today's Student Checklist",
                'answer' => $answer,
                'highlights' => [
                    ['label' => 'Account balance', 'value' => '₱'.number_format($owedTotal, 2), 'tone' => $owedTotal > 0 ? 'warning' : 'success'],
                    ['label' => 'Pending clearance', 'value' => (string) ($pendingClearance + $heldClearance), 'tone' => $heldClearance > 0 ? 'danger' : ($pendingClearance > 0 ? 'warning' : 'success')],
                    ['label' => 'Orders to claim', 'value' => (string) $readyOrders, 'tone' => $readyOrders > 0 ? 'primary' : 'neutral'],
                    ['label' => 'Open ballot', 'value' => $needsToVote ? '1 open' : 'None', 'tone' => $needsToVote ? 'warning' : 'neutral'],
                ],
                'sections' => [
                    [
                        'id' => 'student-daily-priorities',
                        'title' => 'Your Action Items Today',
                        'description' => 'Personal clearance, fees, voting, and merchandise updates for your account.',
                        'empty_message' => 'Nothing requires your action right now.',
                        'rows' => $rows,
                    ],
                ],
                'follow_ups' => [
                    ['topic' => 'clearances_status', 'label' => "Who hasn't signed my clearance?", 'question' => "Who hasn't signed my clearance yet and why?"],
                    ['topic' => 'finance_health', 'label' => 'What fees do I owe?', 'question' => 'What fees or invoices do I still need to pay?'],
                    ['topic' => 'events_attendance', 'label' => 'Upcoming events & attendance', 'question' => 'What upcoming events and attendance records do I have?'],
                ],
            ];
        }

        // ADMIN and SBO_OFFICER
        $orgId = (int) $user->organization_id;
        $isOfficer = $role === 'SBO_OFFICER';

        $overdueTasksQuery = DB::table('tasks')->where('organization_id', $orgId)->where('status', 'overdue');
        $openTasksQuery = DB::table('tasks')->where('organization_id', $orgId)->whereIn('status', ['pending', 'in_progress']);
        if ($isOfficer) {
            $overdueTasksQuery->where('assigned_to', $user->school_id);
            $openTasksQuery->where('assigned_to', $user->school_id);
        }
        $overdueTasks = $overdueTasksQuery->count();
        $openTasks = $openTasksQuery->count();

        $pendingApprovals = $role === 'ADMIN'
            ? ApprovalRequest::where('required_role', 'ADMIN')->where('organization_id', $orgId)->where('status', 'pending')->count()
            : 0;

        $ordersToVerify = DB::table('orders')
            ->where('organization_id', $orgId)
            ->where('status', 'pending')
            ->where('officer_review_status', 'pending')
            ->whereNotNull('payment_proof_url')
            ->count();

        $missingComplianceCount = count($this->missingComplianceRequirementsForOrganization($orgId));
        $staleEvents = DB::table('events')
            ->where('organization_id', $orgId)
            ->whereIn('status', ['approved', 'ongoing'])
            ->where('end_time', '<', now())
            ->count();

        $rows = [];
        if ($overdueTasks > 0) {
            $rows[] = [
                'id' => 'org-overdue-tasks',
                'primary' => $isOfficer ? 'Complete your overdue assigned tasks' : 'Resolve overdue organization tasks',
                'secondary' => "{$overdueTasks} task(s) are past their deadline and need progress updates.",
                'status' => 'Overdue',
                'status_tone' => 'danger',
                'meta' => "{$overdueTasks} overdue",
                'href' => $this->routeAccess->hrefFor($role, $isOfficer ? '/dashboard/tasks/assigned-tasks' : '/dashboard/tasks/task-board'),
                'action_label' => 'Open tasks',
            ];
        }
        if ($pendingApprovals > 0) {
            $rows[] = [
                'id' => 'org-approvals',
                'primary' => 'Review pending organization approval requests',
                'secondary' => "{$pendingApprovals} internal request(s) await administrator sign-off.",
                'status' => 'Pending approval',
                'status_tone' => 'warning',
                'meta' => "{$pendingApprovals} pending",
                'href' => $this->routeAccess->hrefFor($role, '/dashboard/approvals'),
                'action_label' => 'Review approvals',
            ];
        }
        if ($missingComplianceCount > 0) {
            $rows[] = [
                'id' => 'org-missing-compliance',
                'primary' => 'Upload missing or returned compliance requirements',
                'secondary' => "{$missingComplianceCount} active compliance requirement(s) for your organization are not yet submitted or were returned.",
                'status' => 'Incomplete',
                'status_tone' => 'warning',
                'meta' => "{$missingComplianceCount} missing",
                'href' => $this->routeAccess->hrefFor($role, '/dashboard/compliance'),
                'action_label' => 'Open compliance',
            ];
        }
        if ($ordersToVerify > 0) {
            $rows[] = [
                'id' => 'org-orders-verify',
                'primary' => 'Verify student merchandise payment proofs',
                'secondary' => "{$ordersToVerify} pending order(s) have uploaded payment proofs awaiting officer review.",
                'status' => 'Awaiting review',
                'status_tone' => 'info',
                'meta' => "{$ordersToVerify} order(s)",
                'href' => $this->routeAccess->hrefFor($role, '/dashboard/merchandise/manage-orders'),
                'action_label' => 'Verify orders',
            ];
        }
        if ($staleEvents > 0) {
            $rows[] = [
                'id' => 'org-stale-events',
                'primary' => 'Mark ended events as completed',
                'secondary' => "{$staleEvents} event(s) have passed their end time but remain marked approved or ongoing.",
                'status' => 'Needs closing',
                'status_tone' => 'warning',
                'meta' => "{$staleEvents} event(s)",
                'href' => $this->routeAccess->hrefFor($role, $isOfficer ? '/dashboard/events/activity-calendar' : '/dashboard/events/manage-events'),
                'action_label' => 'Manage events',
            ];
        }
        if ($openTasks > 0 && $overdueTasks === 0) {
            $rows[] = [
                'id' => 'org-open-tasks',
                'primary' => $isOfficer ? 'Advance your active tasks' : 'Monitor active officer tasks',
                'secondary' => "{$openTasks} task(s) are currently pending or in progress.",
                'status' => 'In progress',
                'status_tone' => 'info',
                'meta' => "{$openTasks} active",
                'href' => $this->routeAccess->hrefFor($role, $isOfficer ? '/dashboard/tasks/assigned-tasks' : '/dashboard/tasks/task-board'),
                'action_label' => 'View tasks',
            ];
        }

        $answer = sprintf(
            'Today for %s: there are %d overdue task(s), %d active task(s), %d missing or returned compliance requirement(s), %d merchandise order(s) awaiting payment verification, and %d ended event(s) that need to be closed.',
            $user->organization?->name ?? 'your organization',
            $overdueTasks,
            $openTasks,
            $missingComplianceCount,
            $ordersToVerify,
            $staleEvents
        );

        return [
            'title' => $isOfficer ? "Today's Officer Action Plan" : "Today's Organization Action Plan",
            'answer' => $answer,
            'highlights' => [
                ['label' => 'Overdue tasks', 'value' => (string) $overdueTasks, 'tone' => $overdueTasks > 0 ? 'danger' : 'success'],
                ['label' => 'Missing compliance', 'value' => (string) $missingComplianceCount, 'tone' => $missingComplianceCount > 0 ? 'warning' : 'success'],
                ['label' => 'Orders to verify', 'value' => (string) $ordersToVerify, 'tone' => $ordersToVerify > 0 ? 'warning' : 'neutral'],
                ['label' => 'Active tasks', 'value' => (string) $openTasks, 'tone' => 'primary'],
            ],
            'sections' => [
                [
                    'id' => 'org-daily-priorities',
                    'title' => 'Prioritized Actions Today',
                    'description' => 'Live operational queues for your organization.',
                    'empty_message' => 'All organization tasks, compliance files, and order queues are up to date.',
                    'rows' => $rows,
                ],
            ],
            'follow_ups' => [
                ['topic' => 'missing_submissions', 'label' => "What haven't we submitted?", 'question' => "What compliance requirements, event files, or reports haven't we submitted?"],
                ['topic' => 'tasks_workload', 'label' => 'Who has overdue tasks?', 'question' => 'Who has overdue or pending tasks in our organization?'],
                ['topic' => 'finance_health', 'label' => "Who hasn't paid fees & budget status?", 'question' => "Who hasn't paid collections/fees and how is our budget?"],
            ],
        ];
    }

    // -------------------------------------------------------------------------
    // Intent 2: Missing Submissions ("Who hasn't submitted this/that?")
    // -------------------------------------------------------------------------

    private function buildMissingSubmissions(User $user, Collection $organizationIds): array
    {
        $role = $user->role;

        if (in_array($role, ['SUPER_ADMIN', 'DEPARTMENT_HEAD'], true)) {
            $academicYear = $this->accreditation->currentAcademicYear();
            $semesterId = AcademicSemester::active()?->id;

            $requirementTypes = $academicYear
                ? ComplianceRequirementType::where('academic_year', $academicYear)
                    ->where('is_active', true)
                    ->where(fn ($q) => $q->whereNull('academic_semester_id')->orWhere('academic_semester_id', $semesterId))
                    ->orderBy('name')
                    ->get(['id', 'name', 'category', 'deadline_at'])
                : collect();

            $orgs = Organization::whereIn('id', $organizationIds)
                ->orderBy('name')
                ->get(['id', 'name', 'acronym', 'lifecycle_status']);

            $submissionsByOrg = $requirementTypes->isNotEmpty()
                ? OrganizationComplianceSubmission::whereIn('organization_id', $organizationIds)
                    ->whereIn('requirement_type_id', $requirementTypes->pluck('id'))
                    ->get(['organization_id', 'requirement_type_id', 'status'])
                    ->groupBy('organization_id')
                : collect();

            $missingComplianceRows = [];
            $fullySubmittedCount = 0;

            foreach ($orgs as $org) {
                if ($requirementTypes->isEmpty()) {
                    continue;
                }
                $orgSubs = ($submissionsByOrg->get($org->id) ?? collect())->keyBy('requirement_type_id');
                $missingNames = [];
                $returnedNames = [];

                foreach ($requirementTypes as $req) {
                    $status = $orgSubs->get($req->id)->status ?? 'not_submitted';
                    if ($status === 'not_submitted') {
                        $missingNames[] = $req->name;
                    } elseif ($status === 'returned') {
                        $returnedNames[] = $req->name;
                    }
                }

                $outstandingCount = count($missingNames) + count($returnedNames);
                if ($outstandingCount === 0) {
                    $fullySubmittedCount++;

                    continue;
                }

                $details = [];
                if ($missingNames !== []) {
                    $details[] = 'Not submitted: '.implode(', ', array_slice($missingNames, 0, 3)).(count($missingNames) > 3 ? ' (+'.(count($missingNames) - 3).' more)' : '');
                }
                if ($returnedNames !== []) {
                    $details[] = 'Returned: '.implode(', ', array_slice($returnedNames, 0, 2));
                }

                $submittedCount = $requirementTypes->count() - $outstandingCount;
                $missingComplianceRows[] = [
                    'id' => 'missing-comp-'.$org->id,
                    'primary' => $org->acronym ? "{$org->name} ({$org->acronym})" : $org->name,
                    'secondary' => implode(' · ', $details),
                    'status' => $returnedNames !== [] ? 'Returned' : 'Missing files',
                    'status_tone' => $returnedNames !== [] ? 'danger' : 'warning',
                    'meta' => "{$submittedCount}/{$requirementTypes->count()} submitted",
                    'href' => $this->routeAccess->hrefFor($role, $role === 'SUPER_ADMIN' ? '/dashboard/super-admin/compliance' : '/dashboard/department-head/organizations'),
                    'action_label' => 'Inspect',
                ];
            }

            // Also check financial report deadline
            $latestDeadline = DB::table('financial_report_deadlines')->orderByDesc('id')->first();
            $missingReportRows = [];
            if ($latestDeadline) {
                $coveredOrgIds = DB::table('financial_reports')
                    ->whereIn('organization_id', $organizationIds)
                    ->where('deadline_id', $latestDeadline->id)
                    ->whereIn('submission_status', ['pending_department_head', 'pending_sao', 'approved'])
                    ->pluck('organization_id')
                    ->unique();

                $orgsMissingReport = $orgs->whereNotIn('id', $coveredOrgIds);
                foreach ($orgsMissingReport->take(self::ROW_LIMIT) as $org) {
                    $missingReportRows[] = [
                        'id' => 'missing-fin-'.$org->id,
                        'primary' => $org->acronym ? "{$org->name} ({$org->acronym})" : $org->name,
                        'secondary' => 'No submitted financial report for deadline '.Carbon::parse($latestDeadline->deadline_at)->format('M j, Y'),
                        'status' => Carbon::parse($latestDeadline->deadline_at)->isPast() ? 'Overdue' : 'Not submitted',
                        'status_tone' => Carbon::parse($latestDeadline->deadline_at)->isPast() ? 'danger' : 'warning',
                        'meta' => 'Due '.Carbon::parse($latestDeadline->deadline_at)->format('M j'),
                        'href' => $this->routeAccess->hrefFor($role, $role === 'SUPER_ADMIN' ? '/dashboard/super-admin/compliance?tab=financial' : '/dashboard/department-head/compliance'),
                        'action_label' => 'View reports',
                    ];
                }
            }

            $missingComplianceTotal = count($missingComplianceRows);
            $missingReportTotal = count($missingReportRows);

            $answer = $requirementTypes->isEmpty()
                ? sprintf(
                    'There are currently 0 active compliance requirement types configured for the current period across %d organization(s), and %d organization(s) have an unsubmitted financial report for the latest deadline.',
                    $orgs->count(),
                    $missingReportTotal
                )
                : sprintf(
                    'Out of %d student organization(s) in scope, %d organization(s) still have missing or returned compliance requirements across %d active requirement type(s), while %d organization(s) have submitted all required files. For financial reporting, %d organization(s) have not yet submitted against the latest deadline.',
                    $orgs->count(),
                    $missingComplianceTotal,
                    $requirementTypes->count(),
                    $fullySubmittedCount,
                    $missingReportTotal
                );

            return [
                'title' => 'Organizations With Missing or Returned Submissions',
                'answer' => $answer,
                'highlights' => [
                    ['label' => 'Orgs missing compliance', 'value' => (string) $missingComplianceTotal, 'tone' => $missingComplianceTotal > 0 ? 'warning' : 'success'],
                    ['label' => 'Fully submitted orgs', 'value' => (string) $fullySubmittedCount, 'tone' => 'success'],
                    ['label' => 'Active requirements', 'value' => (string) $requirementTypes->count(), 'tone' => 'primary'],
                    ['label' => 'Missing financial reports', 'value' => (string) $missingReportTotal, 'tone' => $missingReportTotal > 0 ? 'danger' : 'neutral'],
                ],
                'sections' => [
                    [
                        'id' => 'orgs-missing-compliance',
                        'title' => 'Organizations Missing Compliance Documents',
                        'description' => 'Student organizations with unsubmitted or returned compliance requirements for the current academic period.',
                        'empty_message' => 'Every organization in scope has submitted all active compliance requirements.',
                        'rows' => array_slice($missingComplianceRows, 0, self::ROW_LIMIT),
                    ],
                    [
                        'id' => 'orgs-missing-financial-reports',
                        'title' => 'Organizations Missing Latest Financial Report',
                        'description' => 'Organizations that have not yet submitted a financial report for the active reporting deadline.',
                        'empty_message' => 'No organizations are missing a required financial report for the latest deadline.',
                        'rows' => $missingReportRows,
                    ],
                ],
                'follow_ups' => [
                    ['topic' => 'submitted_documents', 'label' => 'Who HAS submitted documents?', 'question' => 'Who has submitted compliance documents or reports for review?'],
                    ['topic' => 'pending_approvals', 'label' => 'What is awaiting review right now?', 'question' => 'What registrations, event files, and venue bookings are pending?'],
                    ['topic' => 'daily_priorities', 'label' => 'Back to today’s priorities', 'question' => 'What should I do today?'],
                ],
            ];
        }

        // Organization-scoped (ADMIN, SBO_OFFICER, STUDENT)
        $orgId = (int) $user->organization_id;
        $missingCompliance = $this->missingComplianceRequirementsForOrganization($orgId);

        // Also check events with missing requirement files
        $upcomingOrDraftEvents = Event::where('organization_id', $orgId)
            ->whereIn('status', ['draft', 'pending', 'approved'])
            ->orderByDesc('start_time')
            ->limit(8)
            ->get();

        $missingEventReqRows = [];
        foreach ($upcomingOrDraftEvents as $event) {
            $activeReqs = EventRequirement::activeForEvent($event)->where('is_optional', false)->get(['id', 'name']);
            if ($activeReqs->isEmpty()) {
                continue;
            }
            $uploadedReqIds = EventRequirementFile::where('event_id', $event->id)
                ->whereIn('event_requirement_id', $activeReqs->pluck('id'))
                ->pluck('event_requirement_id')
                ->all();
            $missingNames = $activeReqs->whereNotIn('id', $uploadedReqIds)->pluck('name')->all();
            if ($missingNames !== []) {
                $missingEventReqRows[] = [
                    'id' => 'missing-ev-req-'.$event->id,
                    'primary' => $event->title,
                    'secondary' => 'Missing event files: '.implode(', ', array_slice($missingNames, 0, 3)),
                    'status' => count($missingNames).' missing',
                    'status_tone' => 'warning',
                    'meta' => Str::headline($event->status),
                    'href' => $this->routeAccess->hrefFor($role, $role === 'ADMIN' ? '/dashboard/events/manage-events' : '/dashboard/events/activity-calendar'),
                    'action_label' => 'Upload files',
                ];
            }
        }

        $answer = sprintf(
            'For %s, there are %d unsubmitted or returned organization compliance requirement(s) and %d event(s) still missing required proposal files.',
            $user->organization?->name ?? 'your organization',
            count($missingCompliance),
            count($missingEventReqRows)
        );

        return [
            'title' => 'Missing or Returned Requirements',
            'answer' => $answer,
            'highlights' => [
                ['label' => 'Missing compliance files', 'value' => (string) count($missingCompliance), 'tone' => count($missingCompliance) > 0 ? 'warning' : 'success'],
                ['label' => 'Events missing files', 'value' => (string) count($missingEventReqRows), 'tone' => count($missingEventReqRows) > 0 ? 'warning' : 'success'],
            ],
            'sections' => [
                [
                    'id' => 'org-missing-compliance-list',
                    'title' => 'Unsubmitted or Returned Compliance Requirements',
                    'description' => 'Active university compliance requirements your organization still needs to upload or revise.',
                    'empty_message' => 'Your organization has submitted all active compliance requirements.',
                    'rows' => array_slice($missingCompliance, 0, self::ROW_LIMIT),
                ],
                [
                    'id' => 'org-missing-event-files',
                    'title' => 'Events Missing Required Proposal Documents',
                    'description' => 'Organization events that still have unuploaded mandatory requirement files.',
                    'empty_message' => 'All current events have their required proposal documents uploaded.',
                    'rows' => $missingEventReqRows,
                ],
            ],
            'follow_ups' => [
                ['topic' => 'submitted_documents', 'label' => 'What have we already submitted?', 'question' => 'What documents and reports have we already submitted?'],
                ['topic' => 'tasks_workload', 'label' => 'Who has overdue tasks?', 'question' => 'Who has overdue or pending tasks in our organization?'],
                ['topic' => 'daily_priorities', 'label' => 'What should I do today?', 'question' => 'What should I do today?'],
            ],
        ];
    }

    // -------------------------------------------------------------------------
    // Intent 3: Submitted Documents ("Who has submitted this/that?")
    // -------------------------------------------------------------------------

    private function buildSubmittedDocuments(User $user, Collection $organizationIds): array
    {
        $role = $user->role;
        $orgIds = $organizationIds->all();

        $submissions = OrganizationComplianceSubmission::with([
            'organization:id,name,acronym',
            'requirementType:id,name,category',
            'submitter:school_id,first_name,last_name',
        ])
            ->whereIn('organization_id', $orgIds)
            ->whereIn('status', ['submitted', 'approved', 'returned'])
            ->orderByDesc('submitted_at')
            ->limit(self::ROW_LIMIT)
            ->get();

        $totalSubmitted = OrganizationComplianceSubmission::whereIn('organization_id', $orgIds)
            ->where('status', 'submitted')
            ->count();
        $totalApproved = OrganizationComplianceSubmission::whereIn('organization_id', $orgIds)
            ->where('status', 'approved')
            ->count();

        $complianceRows = $submissions->map(function (OrganizationComplianceSubmission $sub) use ($role) {
            $orgName = $sub->organization?->acronym
                ? "{$sub->organization->name} ({$sub->organization->acronym})"
                : ($sub->organization?->name ?? 'Organization');
            $submitterName = trim(($sub->submitter?->first_name ?? '').' '.($sub->submitter?->last_name ?? '')) ?: 'Officer';

            return [
                'id' => 'sub-comp-'.$sub->id,
                'primary' => ($sub->requirementType?->name ?? 'Compliance Document').' — '.$orgName,
                'secondary' => "Submitted by {$submitterName} · ".($sub->file_original_name ?: 'Uploaded file'),
                'status' => Str::headline($sub->status),
                'status_tone' => match ($sub->status) {
                    'approved' => 'success',
                    'submitted' => 'warning',
                    'returned' => 'danger',
                    default => 'neutral',
                },
                'meta' => $sub->submitted_at ? $sub->submitted_at->diffForHumans() : 'Recently',
                'href' => $this->routeAccess->hrefFor(
                    $role,
                    match ($role) {
                        'SUPER_ADMIN' => '/dashboard/super-admin/compliance?tab=review',
                        'DEPARTMENT_HEAD' => '/dashboard/department-head/compliance',
                        default => '/dashboard/compliance',
                    }
                ),
                'action_label' => 'View file',
            ];
        })->all();

        $reports = DB::table('financial_reports')
            ->join('organizations', 'organizations.id', '=', 'financial_reports.organization_id')
            ->whereIn('financial_reports.organization_id', $orgIds)
            ->whereIn('financial_reports.submission_status', ['pending_department_head', 'pending_sao', 'approved', 'rejected'])
            ->orderByDesc('financial_reports.submitted_at')
            ->limit(self::ROW_LIMIT)
            ->get([
                'financial_reports.id',
                'financial_reports.title',
                'financial_reports.submission_status',
                'financial_reports.submitted_at',
                'organizations.name as org_name',
                'organizations.acronym as org_acronym',
            ]);

        $reportRows = $reports->map(fn ($rep) => [
            'id' => 'sub-rep-'.$rep->id,
            'primary' => $rep->title.' — '.($rep->org_acronym ?: $rep->org_name),
            'secondary' => 'Financial report submission',
            'status' => Str::headline($rep->submission_status),
            'status_tone' => match ($rep->submission_status) {
                'approved' => 'success',
                'pending_department_head', 'pending_sao' => 'warning',
                'rejected' => 'danger',
                default => 'neutral',
            },
            'meta' => $rep->submitted_at ? Carbon::parse($rep->submitted_at)->diffForHumans() : 'Submitted',
            'href' => $this->routeAccess->hrefFor(
                $role,
                match ($role) {
                    'SUPER_ADMIN' => '/dashboard/super-admin/compliance?tab=financial',
                    'DEPARTMENT_HEAD' => '/dashboard/department-head/compliance',
                    default => '/dashboard/finance/statement-of-account',
                }
            ),
            'action_label' => 'Open report',
        ])->all();

        $answer = sprintf(
            'There are %d compliance document(s) currently awaiting review and %d approved compliance submission(s) in scope, along with %d submitted financial report(s).',
            $totalSubmitted,
            $totalApproved,
            $reports->count()
        );

        return [
            'title' => 'Submitted Compliance Documents & Financial Reports',
            'answer' => $answer,
            'highlights' => [
                ['label' => 'Awaiting review', 'value' => (string) $totalSubmitted, 'tone' => $totalSubmitted > 0 ? 'warning' : 'neutral'],
                ['label' => 'Approved files', 'value' => (string) $totalApproved, 'tone' => 'success'],
                ['label' => 'Submitted financial reports', 'value' => (string) $reports->count(), 'tone' => 'primary'],
            ],
            'sections' => [
                [
                    'id' => 'submitted-compliance-files',
                    'title' => 'Recent Compliance Submissions',
                    'description' => 'Compliance files uploaded by organizations, newest first.',
                    'empty_message' => 'No compliance submissions have been uploaded yet.',
                    'rows' => $complianceRows,
                ],
                [
                    'id' => 'submitted-financial-reports',
                    'title' => 'Submitted Financial Reports',
                    'description' => 'Financial statements submitted for Department Head or SAO endorsement.',
                    'empty_message' => 'No financial reports have been submitted yet.',
                    'rows' => $reportRows,
                ],
            ],
            'follow_ups' => [
                ['topic' => 'missing_submissions', 'label' => "Who hasn't submitted yet?", 'question' => "Which organizations haven't submitted compliance or financial reports?"],
                ['topic' => 'pending_approvals', 'label' => 'Pending approvals queue', 'question' => 'What requests are waiting for approval right now?'],
                ['topic' => 'daily_priorities', 'label' => 'What should I do today?', 'question' => 'What should I do today?'],
            ],
        ];
    }

    // -------------------------------------------------------------------------
    // Intent 4: Pending Approvals
    // -------------------------------------------------------------------------

    private function buildPendingApprovals(User $user, Collection $organizationIds): array
    {
        $role = $user->role;
        $orgIds = $organizationIds->all();

        $approvalsQuery = ApprovalRequest::with(['requester:school_id,first_name,last_name', 'organization:id,name,acronym'])
            ->where('status', 'pending');

        if ($role === 'SUPER_ADMIN') {
            $approvalsQuery->where('required_role', 'SUPER_ADMIN');
        } elseif ($role === 'DEPARTMENT_HEAD') {
            $approvalsQuery->where('required_role', 'DEPARTMENT_HEAD')->whereIn('organization_id', $orgIds);
        } else {
            $approvalsQuery->where('organization_id', (int) $user->organization_id);
        }

        $totalPendingApprovals = (clone $approvalsQuery)->count();
        $approvals = $approvalsQuery->orderBy('requested_at')->limit(self::ROW_LIMIT)->get();

        $approvalRows = $approvals->map(function (ApprovalRequest $req) use ($role) {
            $requester = trim(($req->requester?->first_name ?? '').' '.($req->requester?->last_name ?? '')) ?: 'Member';
            $orgName = $req->organization?->acronym ?: ($req->organization?->name ?? 'Organization');

            return [
                'id' => 'app-'.$req->id,
                'primary' => $this->entityLabels->for($req),
                'secondary' => Str::headline($req->entity_type)." · {$orgName} · Requested by {$requester}",
                'status' => 'Pending '.Str::headline($req->required_role),
                'status_tone' => 'warning',
                'meta' => $req->requested_at ? $req->requested_at->diffForHumans() : 'Pending',
                'href' => $this->routeAccess->hrefFor($role, $role === 'SUPER_ADMIN' ? '/dashboard/super-admin/compliance' : '/dashboard/approvals'),
                'action_label' => 'Review',
            ];
        })->all();

        $extraSection = [];
        $pendingRegCount = 0;
        if ($role === 'SUPER_ADMIN') {
            $pendingRegs = DB::table('organizations')
                ->where('organization_type', 'STUDENT_ORGANIZATION')
                ->where('lifecycle_status', 'pending')
                ->orderBy('name')
                ->get(['id', 'name', 'acronym', 'submitted_at']);
            $pendingRegCount = $pendingRegs->count();

            $extraSection[] = [
                'id' => 'pending-org-registrations',
                'title' => 'Pending Organization Registrations',
                'description' => 'Student organizations awaiting SAO registration review.',
                'empty_message' => 'No organization registrations are pending review.',
                'rows' => $pendingRegs->take(self::ROW_LIMIT)->map(fn ($org) => [
                    'id' => 'reg-'.$org->id,
                    'primary' => $org->acronym ? "{$org->name} ({$org->acronym})" : $org->name,
                    'secondary' => 'Student organization registration application',
                    'status' => 'Pending review',
                    'status_tone' => 'warning',
                    'meta' => $org->submitted_at ? Carbon::parse($org->submitted_at)->diffForHumans() : 'Submitted',
                    'href' => $this->routeAccess->hrefFor($role, '/dashboard/super-admin/organizations?status=pending'),
                    'action_label' => 'Review',
                ])->all(),
            ];
        }

        $answer = $role === 'SUPER_ADMIN'
            ? "There are {$totalPendingApprovals} pending SAO approval request(s) and {$pendingRegCount} student organization registration(s) awaiting review."
            : "There are {$totalPendingApprovals} pending approval request(s) currently in your queue.";

        return [
            'title' => 'Pending Approvals & Review Queue',
            'answer' => $answer,
            'highlights' => [
                ['label' => 'Pending approvals', 'value' => (string) $totalPendingApprovals, 'tone' => $totalPendingApprovals > 0 ? 'warning' : 'success'],
                ...(
                    $role === 'SUPER_ADMIN'
                        ? [['label' => 'Pending registrations', 'value' => (string) $pendingRegCount, 'tone' => $pendingRegCount > 0 ? 'warning' : 'neutral']]
                        : []
                ),
            ],
            'sections' => [
                [
                    'id' => 'pending-approvals-list',
                    'title' => 'Pending Approval Requests',
                    'description' => 'Requests ordered oldest first so the longest-waiting items are addressed first.',
                    'empty_message' => 'No pending approval requests in your queue.',
                    'rows' => $approvalRows,
                ],
                ...$extraSection,
            ],
            'follow_ups' => [
                ['topic' => 'missing_submissions', 'label' => "Who hasn't submitted requirements?", 'question' => "Which organizations haven't submitted compliance or financial reports?"],
                ['topic' => 'daily_priorities', 'label' => 'What should I do today?', 'question' => 'What should I do today?'],
            ],
        ];
    }

    // -------------------------------------------------------------------------
    // Intent 5: Organizations Without Admin / Returned Registrations
    // -------------------------------------------------------------------------

    private function buildOrganizationsWithoutAdmin(User $user, Collection $organizationIds): array
    {
        $role = $user->role;
        $orgIds = $organizationIds->all();

        $noAdminOrgs = DB::table('organizations')
            ->whereIn('id', $orgIds)
            ->where('lifecycle_status', 'active')
            ->whereNotExists(fn ($q) => $q->selectRaw('1')->from('account_profiles')
                ->whereColumn('account_profiles.organization_id', 'organizations.id')
                ->where('account_profiles.role', 'ADMIN')
                ->where('account_profiles.account_status', 'active'))
            ->orderBy('name')
            ->get(['id', 'name', 'acronym']);

        $returnedOrgs = DB::table('organizations')
            ->whereIn('id', $orgIds)
            ->where('lifecycle_status', 'returned')
            ->orderBy('name')
            ->get(['id', 'name', 'acronym', 'review_remarks']);

        $href = $this->routeAccess->hrefFor(
            $role,
            $role === 'SUPER_ADMIN' ? '/dashboard/super-admin/organizations' : '/dashboard/department-head/organizations'
        );

        return [
            'title' => 'Organization Leadership & Registration Gaps',
            'answer' => sprintf(
                'There are %d active student organization(s) without an assigned active administrator and %d organization registration(s) currently in returned status.',
                $noAdminOrgs->count(),
                $returnedOrgs->count()
            ),
            'highlights' => [
                ['label' => 'Active without admin', 'value' => (string) $noAdminOrgs->count(), 'tone' => $noAdminOrgs->count() > 0 ? 'warning' : 'success'],
                ['label' => 'Returned registrations', 'value' => (string) $returnedOrgs->count(), 'tone' => $returnedOrgs->count() > 0 ? 'danger' : 'neutral'],
            ],
            'sections' => [
                [
                    'id' => 'orgs-without-admin',
                    'title' => 'Active Organizations Without an Administrator',
                    'description' => 'Active organizations that still need an active ADMIN profile provisioned.',
                    'empty_message' => 'Every active organization in scope has an assigned administrator.',
                    'rows' => $noAdminOrgs->take(self::ROW_LIMIT)->map(fn ($org) => [
                        'id' => 'noadmin-'.$org->id,
                        'primary' => $org->acronym ? "{$org->name} ({$org->acronym})" : $org->name,
                        'secondary' => 'Active organization with no active ADMIN profile',
                        'status' => 'Needs admin',
                        'status_tone' => 'warning',
                        'meta' => 'Active',
                        'href' => $href,
                        'action_label' => 'Assign admin',
                    ])->all(),
                ],
                [
                    'id' => 'orgs-returned',
                    'title' => 'Returned Organization Registrations',
                    'description' => 'Registrations returned for revision.',
                    'empty_message' => 'No organization registrations are currently returned.',
                    'rows' => $returnedOrgs->take(self::ROW_LIMIT)->map(fn ($org) => [
                        'id' => 'ret-'.$org->id,
                        'primary' => $org->acronym ? "{$org->name} ({$org->acronym})" : $org->name,
                        'secondary' => $org->review_remarks ?: 'Returned for document or profile revision.',
                        'status' => 'Returned',
                        'status_tone' => 'danger',
                        'meta' => 'Needs revision',
                        'href' => $href,
                        'action_label' => 'Open',
                    ])->all(),
                ],
            ],
            'follow_ups' => [
                ['topic' => 'missing_submissions', 'label' => "Who hasn't submitted compliance?", 'question' => "Which organizations haven't submitted compliance or financial reports?"],
                ['topic' => 'daily_priorities', 'label' => 'What should I do today?', 'question' => 'What should I do today?'],
            ],
        ];
    }

    // -------------------------------------------------------------------------
    // Intent 6: Tasks & Officer Workload
    // -------------------------------------------------------------------------

    private function buildTasksWorkload(User $user, Collection $organizationIds): array
    {
        $role = $user->role;
        $orgIds = $role === 'SUPER_ADMIN' || $role === 'DEPARTMENT_HEAD'
            ? $organizationIds->all()
            : [(int) $user->organization_id];

        $query = DB::table('tasks')
            ->leftJoin('users', 'tasks.assigned_to', '=', 'users.school_id')
            ->whereIn('tasks.organization_id', $orgIds)
            ->whereIn('tasks.status', ['overdue', 'pending', 'in_progress']);

        if ($role === 'SBO_OFFICER') {
            $query->where('tasks.assigned_to', $user->school_id);
        }

        $overdueCount = (clone $query)->where('tasks.status', 'overdue')->count();
        $openCount = (clone $query)->whereIn('tasks.status', ['pending', 'in_progress'])->count();

        $tasks = $query
            ->orderByRaw("CASE WHEN tasks.status = 'overdue' THEN 0 ELSE 1 END")
            ->orderBy('tasks.deadline')
            ->limit(self::ROW_LIMIT)
            ->get([
                'tasks.id',
                'tasks.title',
                'tasks.status',
                'tasks.priority',
                'tasks.deadline',
                'tasks.progress_percent',
                'users.first_name',
                'users.last_name',
            ]);

        $href = $this->routeAccess->hrefFor(
            $role,
            $role === 'SBO_OFFICER' ? '/dashboard/tasks/assigned-tasks' : '/dashboard/tasks/task-board'
        );

        $rows = $tasks->map(function ($task) use ($href) {
            $assignee = trim(($task->first_name ?? '').' '.($task->last_name ?? '')) ?: 'Unassigned';
            $due = $task->deadline ? Carbon::parse($task->deadline)->format('M j, Y') : 'No deadline';

            return [
                'id' => 'task-'.$task->id,
                'primary' => $task->title,
                'secondary' => "Assigned to {$assignee} · Due {$due}",
                'status' => Str::headline($task->status),
                'status_tone' => $task->status === 'overdue' ? 'danger' : ($task->status === 'in_progress' ? 'info' : 'warning'),
                'meta' => ((int) ($task->progress_percent ?? 0)).'% complete',
                'href' => $href,
                'action_label' => 'Open task',
            ];
        })->all();

        return [
            'title' => 'Tasks & Officer Workload',
            'answer' => "There are {$overdueCount} overdue task(s) and {$openCount} pending or in-progress task(s) in your current scope.",
            'highlights' => [
                ['label' => 'Overdue tasks', 'value' => (string) $overdueCount, 'tone' => $overdueCount > 0 ? 'danger' : 'success'],
                ['label' => 'Open tasks', 'value' => (string) $openCount, 'tone' => 'primary'],
            ],
            'sections' => [
                [
                    'id' => 'tasks-workload-list',
                    'title' => 'Overdue & Active Tasks',
                    'description' => 'Overdue tasks appear first, ordered by earliest deadline.',
                    'empty_message' => 'No overdue or pending tasks found.',
                    'rows' => $rows,
                ],
            ],
            'follow_ups' => [
                ['topic' => 'daily_priorities', 'label' => 'What should I do today?', 'question' => 'What should I do today?'],
                ['topic' => 'events_attendance', 'label' => 'Upcoming events status', 'question' => 'What events are happening today or need to be closed?'],
            ],
        ];
    }

    // -------------------------------------------------------------------------
    // Intent 7: Finance Health, Budgets & Student Balances
    // -------------------------------------------------------------------------

    private function buildFinanceHealth(User $user, Collection $organizationIds): array
    {
        $role = $user->role;

        if ($role === 'STUDENT') {
            $orgId = (int) $user->organization_id;
            $row = $this->balances->rows(collect([$user]), $orgId)->first();
            $owed = (float) ($row['total_debt'] ?? 0);
            $unpaidCount = (int) ($row['unpaid_invoice_count'] ?? 0);

            $invoices = DB::table('invoices')
                ->where('organization_id', $orgId)
                ->where('student_id', $user->school_id)
                ->orderByDesc('created_at')
                ->limit(self::ROW_LIMIT)
                ->get(['id', 'description', 'amount', 'paid_amount', 'status', 'due_date']);

            return [
                'title' => 'Your Fees & Account Balance',
                'answer' => sprintf(
                    'Your current organization balance is ₱%s across %d open invoice(s).',
                    number_format($owed, 2),
                    $unpaidCount
                ),
                'highlights' => [
                    ['label' => 'Total balance owed', 'value' => '₱'.number_format($owed, 2), 'tone' => $owed > 0 ? 'warning' : 'success'],
                    ['label' => 'Open invoices', 'value' => (string) $unpaidCount, 'tone' => $unpaidCount > 0 ? 'warning' : 'neutral'],
                ],
                'sections' => [
                    [
                        'id' => 'student-invoices',
                        'title' => 'Your Invoices & Collections',
                        'description' => 'Invoices issued to your student account.',
                        'empty_message' => 'No invoices have been issued to your account.',
                        'rows' => $invoices->map(fn ($inv) => [
                            'id' => 'inv-'.$inv->id,
                            'primary' => $inv->description ?: 'Invoice #'.$inv->id,
                            'secondary' => sprintf('Amount: ₱%s · Paid: ₱%s', number_format((float) $inv->amount, 2), number_format((float) $inv->paid_amount, 2)),
                            'status' => Str::headline($inv->status),
                            'status_tone' => $inv->status === 'paid' ? 'success' : 'warning',
                            'meta' => $inv->due_date ? 'Due '.Carbon::parse($inv->due_date)->format('M j, Y') : 'Open',
                            'href' => $this->routeAccess->hrefFor($role, '/dashboard/finance/statement-of-account'),
                            'action_label' => 'View account',
                        ])->all(),
                    ],
                ],
                'follow_ups' => [
                    ['topic' => 'clearances_status', 'label' => 'Check my clearance status', 'question' => "Who hasn't signed my clearance yet and why?"],
                    ['topic' => 'daily_priorities', 'label' => 'What do I need to do today?', 'question' => 'What do I need to do today?'],
                ],
            ];
        }

        $orgIds = in_array($role, ['SUPER_ADMIN', 'DEPARTMENT_HEAD'], true)
            ? $organizationIds->all()
            : [(int) $user->organization_id];

        $approvedBudgets = DB::table('budgets')
            ->join('organizations', 'organizations.id', '=', 'budgets.organization_id')
            ->whereIn('budgets.organization_id', $orgIds)
            ->where('budgets.submission_status', 'approved')
            ->orderByDesc('budgets.allocated_amount')
            ->limit(self::ROW_LIMIT)
            ->get([
                'budgets.id',
                'budgets.title',
                'budgets.allocated_amount',
                'budgets.remaining_amount',
                'organizations.name as org_name',
                'organizations.acronym as org_acronym',
            ]);

        $totals = DB::table('budgets')
            ->whereIn('organization_id', $orgIds)
            ->where('submission_status', 'approved')
            ->selectRaw('COALESCE(SUM(allocated_amount),0) as allocated, COALESCE(SUM(remaining_amount),0) as remaining')
            ->first();

        $allocated = (float) ($totals->allocated ?? 0);
        $remaining = (float) ($totals->remaining ?? 0);

        $unpaidInvoicesCount = DB::table('invoices')
            ->whereIn('organization_id', $orgIds)
            ->where('status', '!=', 'paid')
            ->count();

        $budgetHref = $this->routeAccess->hrefFor($role, '/dashboard/finance/budget-allocation');

        return [
            'title' => 'Budget Utilization & Financial Status',
            'answer' => sprintf(
                'Approved budgets in scope total ₱%s allocated with ₱%s remaining, and there are %d unpaid student invoice(s).',
                number_format($allocated, 2),
                number_format($remaining, 2),
                $unpaidInvoicesCount
            ),
            'highlights' => [
                ['label' => 'Approved allocated', 'value' => '₱'.number_format($allocated, 2), 'tone' => 'primary'],
                ['label' => 'Remaining budget', 'value' => '₱'.number_format($remaining, 2), 'tone' => 'success'],
                ['label' => 'Open student invoices', 'value' => (string) $unpaidInvoicesCount, 'tone' => $unpaidInvoicesCount > 0 ? 'warning' : 'neutral'],
            ],
            'sections' => [
                [
                    'id' => 'approved-budgets-list',
                    'title' => 'Approved Budgets',
                    'description' => 'Allocated and remaining balances across approved budgets.',
                    'empty_message' => 'No approved budgets recorded in scope.',
                    'rows' => $approvedBudgets->map(fn ($b) => [
                        'id' => 'bud-'.$b->id,
                        'primary' => $b->title.' — '.($b->org_acronym ?: $b->org_name),
                        'secondary' => sprintf('Allocated: ₱%s · Remaining: ₱%s', number_format((float) $b->allocated_amount, 2), number_format((float) $b->remaining_amount, 2)),
                        'status' => 'Approved',
                        'status_tone' => ((float) $b->remaining_amount <= ((float) $b->allocated_amount * 0.15)) ? 'warning' : 'success',
                        'meta' => '₱'.number_format((float) $b->remaining_amount, 2).' left',
                        'href' => $budgetHref,
                        'action_label' => 'Open budget',
                    ])->all(),
                ],
            ],
            'follow_ups' => [
                ['topic' => 'missing_submissions', 'label' => 'Missing financial reports', 'question' => "Which organizations haven't submitted compliance or financial reports?"],
                ['topic' => 'daily_priorities', 'label' => 'What should I do today?', 'question' => 'What should I do today?'],
            ],
        ];
    }

    // -------------------------------------------------------------------------
    // Intent 8: Merchandise Orders
    // -------------------------------------------------------------------------

    private function buildMerchandiseOrders(User $user): array
    {
        $role = $user->role;
        $orgId = (int) $user->organization_id;

        $query = DB::table('orders')
            ->leftJoin('users', 'orders.student_id', '=', 'users.school_id')
            ->where('orders.organization_id', $orgId);

        if ($role === 'STUDENT') {
            $query->where('orders.student_id', $user->school_id);
        }

        $pendingVerify = (clone $query)->where('orders.status', 'pending')->count();
        $readyToClaim = (clone $query)->where('orders.status', 'paid')->count();

        $orders = $query
            ->whereIn('orders.status', ['pending', 'paid'])
            ->orderByDesc('orders.updated_at')
            ->limit(self::ROW_LIMIT)
            ->get([
                'orders.id',
                'orders.total_price',
                'orders.status',
                'orders.officer_review_status',
                'orders.payment_proof_url',
                'users.first_name',
                'users.last_name',
            ]);

        $href = $this->routeAccess->hrefFor(
            $role,
            $role === 'STUDENT' ? '/dashboard/merchandise/my-orders' : '/dashboard/merchandise/manage-orders'
        );

        return [
            'title' => 'Merchandise Orders Queue',
            'answer' => "There are {$pendingVerify} pending order(s) awaiting verification and {$readyToClaim} paid order(s) ready to be claimed.",
            'highlights' => [
                ['label' => 'Pending verification', 'value' => (string) $pendingVerify, 'tone' => $pendingVerify > 0 ? 'warning' : 'neutral'],
                ['label' => 'Ready to claim', 'value' => (string) $readyToClaim, 'tone' => $readyToClaim > 0 ? 'success' : 'neutral'],
            ],
            'sections' => [
                [
                    'id' => 'orders-active-list',
                    'title' => 'Pending & Claimable Merchandise Orders',
                    'description' => 'Orders awaiting payment proof verification or pickup.',
                    'empty_message' => 'No pending or unclaimed merchandise orders right now.',
                    'rows' => $orders->map(function ($ord) use ($href) {
                        $buyer = trim(($ord->first_name ?? '').' '.($ord->last_name ?? '')) ?: 'Student';

                        return [
                            'id' => 'ord-'.$ord->id,
                            'primary' => "Order ORD-{$ord->id} ({$buyer})",
                            'secondary' => 'Total: ₱'.number_format((float) $ord->total_price, 2).' · '.($ord->payment_proof_url ? 'Payment proof uploaded' : 'Awaiting payment proof'),
                            'status' => $ord->status === 'paid' ? 'Ready to claim' : 'Pending verification',
                            'status_tone' => $ord->status === 'paid' ? 'success' : 'warning',
                            'meta' => '₱'.number_format((float) $ord->total_price, 2),
                            'href' => $href,
                            'action_label' => 'Open order',
                        ];
                    })->all(),
                ],
            ],
            'follow_ups' => [
                ['topic' => 'daily_priorities', 'label' => 'What should I do today?', 'question' => 'What should I do today?'],
            ],
        ];
    }

    // -------------------------------------------------------------------------
    // Intent 9: Events & Attendance
    // -------------------------------------------------------------------------

    private function buildEventsAttendance(User $user, Collection $organizationIds): array
    {
        $role = $user->role;
        $orgIds = in_array($role, ['SUPER_ADMIN', 'DEPARTMENT_HEAD'], true)
            ? $organizationIds->all()
            : [(int) $user->organization_id];

        $upcomingEvents = DB::table('events')
            ->join('organizations', 'organizations.id', '=', 'events.organization_id')
            ->whereIn('events.organization_id', $orgIds)
            ->whereIn('events.status', ['approved', 'ongoing'])
            ->where('events.end_time', '>=', now())
            ->orderBy('events.start_time')
            ->limit(self::ROW_LIMIT)
            ->get([
                'events.id',
                'events.title',
                'events.status',
                'events.start_time',
                'events.location',
                'organizations.name as org_name',
                'organizations.acronym as org_acronym',
            ]);

        $staleEventsCount = DB::table('events')
            ->whereIn('organization_id', $orgIds)
            ->whereIn('status', ['approved', 'ongoing'])
            ->where('end_time', '<', now())
            ->count();

        $href = $this->routeAccess->hrefFor($role, '/dashboard/events/activity-calendar');

        return [
            'title' => 'Upcoming Events & Attendance Status',
            'answer' => sprintf(
                'There are %d upcoming or ongoing event(s) scheduled and %d past event(s) still open that need to be marked completed.',
                $upcomingEvents->count(),
                $staleEventsCount
            ),
            'highlights' => [
                ['label' => 'Upcoming / ongoing', 'value' => (string) $upcomingEvents->count(), 'tone' => 'primary'],
                ['label' => 'Needs closing', 'value' => (string) $staleEventsCount, 'tone' => $staleEventsCount > 0 ? 'warning' : 'neutral'],
            ],
            'sections' => [
                [
                    'id' => 'upcoming-events-list',
                    'title' => 'Scheduled & Ongoing Events',
                    'description' => 'Approved and ongoing events across your scope.',
                    'empty_message' => 'No upcoming events are currently scheduled.',
                    'rows' => $upcomingEvents->map(fn ($ev) => [
                        'id' => 'ev-'.$ev->id,
                        'primary' => $ev->title.' — '.($ev->org_acronym ?: $ev->org_name),
                        'secondary' => ($ev->location ?: 'Campus venue').' · Starts '.Carbon::parse($ev->start_time)->format('M j, Y g:i A'),
                        'status' => Str::headline($ev->status),
                        'status_tone' => $ev->status === 'ongoing' ? 'success' : 'info',
                        'meta' => Carbon::parse($ev->start_time)->format('M j'),
                        'href' => $href,
                        'action_label' => 'View calendar',
                    ])->all(),
                ],
            ],
            'follow_ups' => [
                ['topic' => 'missing_submissions', 'label' => 'Missing event files?', 'question' => "What compliance requirements, event files, or reports haven't we submitted?"],
                ['topic' => 'daily_priorities', 'label' => 'What should I do today?', 'question' => 'What should I do today?'],
            ],
        ];
    }

    // -------------------------------------------------------------------------
    // Intent 10: Clearances Status
    // -------------------------------------------------------------------------

    private function buildClearancesStatus(User $user, Collection $organizationIds): array
    {
        $role = $user->role;

        if ($role === 'STUDENT') {
            $sigs = DB::table('clearance_signatures')
                ->leftJoin('organizations', 'organizations.id', '=', 'clearance_signatures.organization_id')
                ->whereNull('clearance_signatures.retired_at')
                ->where('clearance_signatures.student_id', $user->school_id)
                ->orderBy('clearance_signatures.id')
                ->get([
                    'clearance_signatures.id',
                    'clearance_signatures.required_role',
                    'clearance_signatures.status',
                    'clearance_signatures.remarks',
                    'clearance_signatures.signed_at',
                    'organizations.name as org_name',
                ]);

            $pending = $sigs->where('status', 'pending')->count();
            $held = $sigs->where('status', 'held')->count();
            $signed = $sigs->whereIn('status', ['signed', 'approved', 'cleared'])->count();

            return [
                'title' => 'Your Clearance Signatories Breakdown',
                'answer' => "On your clearance record, {$signed} signatory line(s) are signed, {$pending} are pending, and {$held} are held.",
                'highlights' => [
                    ['label' => 'Signed', 'value' => (string) $signed, 'tone' => 'success'],
                    ['label' => 'Pending', 'value' => (string) $pending, 'tone' => $pending > 0 ? 'warning' : 'neutral'],
                    ['label' => 'Held', 'value' => (string) $held, 'tone' => $held > 0 ? 'danger' : 'neutral'],
                ],
                'sections' => [
                    [
                        'id' => 'student-clearance-lines',
                        'title' => 'Signatory Statuses',
                        'description' => 'Each required clearance signatory and its current status.',
                        'empty_message' => 'No active clearance period signatures are assigned to your account.',
                        'rows' => $sigs->map(fn ($sig) => [
                            'id' => 'sig-'.$sig->id,
                            'primary' => Str::upper($sig->required_role).' — '.($sig->org_name ?: 'University'),
                            'secondary' => $sig->remarks ?: ($sig->status === 'pending' ? 'Awaiting review by signatory' : 'Cleared'),
                            'status' => Str::headline($sig->status),
                            'status_tone' => match ($sig->status) {
                                'held' => 'danger',
                                'pending' => 'warning',
                                default => 'success',
                            },
                            'meta' => $sig->signed_at ? Carbon::parse($sig->signed_at)->format('M j') : 'Open',
                            'href' => $this->routeAccess->hrefFor($role, '/dashboard/my-clearance'),
                            'action_label' => 'Open clearance',
                        ])->all(),
                    ],
                ],
                'follow_ups' => [
                    ['topic' => 'finance_health', 'label' => 'What fees do I owe?', 'question' => 'What fees or invoices do I still need to pay?'],
                    ['topic' => 'daily_priorities', 'label' => 'What do I need to do today?', 'question' => 'What do I need to do today?'],
                ],
            ];
        }

        $query = DB::table('clearance_signatures')
            ->join('users', 'users.school_id', '=', 'clearance_signatures.student_id')
            ->whereNull('clearance_signatures.retired_at');

        if ($role === 'SUPER_ADMIN') {
            $query->where('clearance_signatures.required_role', 'sao');
        } elseif ($role === 'DEPARTMENT_HEAD') {
            $query->whereIn('clearance_signatures.organization_id', $organizationIds->all());
        } else {
            $query->where('clearance_signatures.organization_id', (int) $user->organization_id);
        }

        $pendingCount = (clone $query)->where('clearance_signatures.status', 'pending')->count();
        $heldCount = (clone $query)->where('clearance_signatures.status', 'held')->count();

        $rows = $query->whereIn('clearance_signatures.status', ['pending', 'held'])
            ->orderByDesc('clearance_signatures.updated_at')
            ->limit(self::ROW_LIMIT)
            ->get([
                'clearance_signatures.id',
                'clearance_signatures.required_role',
                'clearance_signatures.status',
                'clearance_signatures.remarks',
                'users.school_id',
                'users.first_name',
                'users.last_name',
            ]);

        $href = $this->routeAccess->hrefFor(
            $role,
            $role === 'SUPER_ADMIN' ? '/dashboard/super-admin/clearances' : '/dashboard/clearances'
        );

        return [
            'title' => 'Pending & Held Student Clearances',
            'answer' => "There are {$pendingCount} pending clearance signature(s) and {$heldCount} held clearance line(s) in your queue.",
            'highlights' => [
                ['label' => 'Pending signatures', 'value' => (string) $pendingCount, 'tone' => $pendingCount > 0 ? 'warning' : 'success'],
                ['label' => 'Held clearances', 'value' => (string) $heldCount, 'tone' => $heldCount > 0 ? 'danger' : 'neutral'],
            ],
            'sections' => [
                [
                    'id' => 'clearance-queue-rows',
                    'title' => 'Students Awaiting Clearance Action',
                    'description' => 'Pending and held student clearance lines in your scope.',
                    'empty_message' => 'All student clearance lines in your queue have been processed.',
                    'rows' => $rows->map(fn ($r) => [
                        'id' => 'clr-'.$r->id,
                        'primary' => "{$r->first_name} {$r->last_name} ({$r->school_id})",
                        'secondary' => $r->remarks ?: 'Stage: '.Str::upper($r->required_role),
                        'status' => Str::headline($r->status),
                        'status_tone' => $r->status === 'held' ? 'danger' : 'warning',
                        'meta' => Str::upper($r->required_role),
                        'href' => $href,
                        'action_label' => 'Review',
                    ])->all(),
                ],
            ],
            'follow_ups' => [
                ['topic' => 'daily_priorities', 'label' => 'What should I do today?', 'question' => 'What should I do today?'],
            ],
        ];
    }

    // -------------------------------------------------------------------------
    // Intent 11: Elections Status
    // -------------------------------------------------------------------------

    private function buildElectionsStatus(User $user, Collection $organizationIds): array
    {
        $role = $user->role;
        $orgIds = in_array($role, ['SUPER_ADMIN', 'DEPARTMENT_HEAD'], true)
            ? $organizationIds->all()
            : [(int) $user->organization_id];

        $elections = DB::table('elections')
            ->join('organizations', 'organizations.id', '=', 'elections.organization_id')
            ->whereIn('elections.organization_id', $orgIds)
            ->whereIn('elections.status', ['active', 'upcoming'])
            ->orderBy('elections.end_time')
            ->limit(self::ROW_LIMIT)
            ->get([
                'elections.id',
                'elections.title',
                'elections.status',
                'elections.end_time',
                'organizations.name as org_name',
                'organizations.acronym as org_acronym',
            ]);

        $activeCount = $elections->where('status', 'active')->count();
        $href = $this->routeAccess->hrefFor($role, '/dashboard/elections/cast-vote');

        return [
            'title' => 'Active & Upcoming Elections',
            'answer' => "There are {$activeCount} active election(s) and {$elections->where('status', 'upcoming')->count()} upcoming election(s) in your scope.",
            'highlights' => [
                ['label' => 'Active elections', 'value' => (string) $activeCount, 'tone' => $activeCount > 0 ? 'primary' : 'neutral'],
                ['label' => 'Upcoming elections', 'value' => (string) $elections->where('status', 'upcoming')->count(), 'tone' => 'neutral'],
            ],
            'sections' => [
                [
                    'id' => 'elections-status-list',
                    'title' => 'Elections Schedule',
                    'description' => 'Active and upcoming organization elections.',
                    'empty_message' => 'No active or upcoming elections right now.',
                    'rows' => $elections->map(fn ($el) => [
                        'id' => 'el-'.$el->id,
                        'primary' => $el->title.' — '.($el->org_acronym ?: $el->org_name),
                        'secondary' => 'Closes '.Carbon::parse($el->end_time)->format('M j, Y g:i A'),
                        'status' => Str::headline($el->status),
                        'status_tone' => $el->status === 'active' ? 'success' : 'info',
                        'meta' => Carbon::parse($el->end_time)->diffForHumans(),
                        'href' => $href,
                        'action_label' => 'Open election',
                    ])->all(),
                ],
            ],
            'follow_ups' => [
                ['topic' => 'daily_priorities', 'label' => 'What should I do today?', 'question' => 'What should I do today?'],
            ],
        ];
    }

    // -------------------------------------------------------------------------
    // Intent 12: Grievances Status (SAO only, privacy-preserving)
    // -------------------------------------------------------------------------

    private function buildGrievancesStatus(User $user): array
    {
        if ($user->role !== 'SUPER_ADMIN') {
            return $this->buildDailyPriorities($user, $this->scopedStudentOrganizationIds($user));
        }

        $openGrievances = DB::table('grievances')
            ->whereNotIn('status', ['resolved', 'dismissed'])
            ->orderByRaw("CASE WHEN urgency = 'critical' THEN 0 WHEN urgency = 'high' THEN 1 WHEN urgency = 'medium' THEN 2 ELSE 3 END")
            ->orderByDesc('created_at')
            ->limit(self::ROW_LIMIT)
            ->get(['id', 'title', 'category', 'urgency', 'status', 'created_at']);

        $urgentCount = $openGrievances->whereIn('urgency', ['high', 'critical'])->count();
        $href = $this->routeAccess->hrefFor('SUPER_ADMIN', '/dashboard/super-admin/grievances');

        return [
            'title' => 'Student Grievance Queue (SAO)',
            'answer' => "There are {$openGrievances->count()} unresolved grievance(s) in the SAO queue, including {$urgentCount} high or critical urgency case(s).",
            'highlights' => [
                ['label' => 'Unresolved grievances', 'value' => (string) $openGrievances->count(), 'tone' => $openGrievances->count() > 0 ? 'warning' : 'success'],
                ['label' => 'High / critical urgency', 'value' => (string) $urgentCount, 'tone' => $urgentCount > 0 ? 'danger' : 'neutral'],
            ],
            'sections' => [
                [
                    'id' => 'sao-grievances-list',
                    'title' => 'Open Student Grievances',
                    'description' => 'Ordered by urgency level (identities are protected in summary views).',
                    'empty_message' => 'No unresolved student grievances in the queue.',
                    'rows' => $openGrievances->map(fn ($g) => [
                        'id' => 'grv-'.$g->id,
                        'primary' => $g->title ?: ('Grievance #'.$g->id),
                        'secondary' => 'Category: '.Str::headline($g->category ?: 'General'),
                        'status' => Str::headline($g->urgency ?: 'normal').' urgency',
                        'status_tone' => in_array($g->urgency, ['high', 'critical'], true) ? 'danger' : 'warning',
                        'meta' => Str::headline($g->status),
                        'href' => $href,
                        'action_label' => 'Review case',
                    ])->all(),
                ],
            ],
            'follow_ups' => [
                ['topic' => 'daily_priorities', 'label' => 'Back to today’s priorities', 'question' => 'What should I do today?'],
            ],
        ];
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private function missingComplianceRequirementsForOrganization(int $organizationId): array
    {
        $academicYear = $this->accreditation->currentAcademicYear();
        if ($academicYear === null) {
            return [];
        }

        $semesterId = AcademicSemester::active()?->id;
        $requirementTypes = ComplianceRequirementType::where('academic_year', $academicYear)
            ->where('is_active', true)
            ->where(fn ($q) => $q->whereNull('academic_semester_id')->orWhere('academic_semester_id', $semesterId))
            ->orderBy('name')
            ->get();

        if ($requirementTypes->isEmpty()) {
            return [];
        }

        $submissions = OrganizationComplianceSubmission::where('organization_id', $organizationId)
            ->whereIn('requirement_type_id', $requirementTypes->pluck('id'))
            ->get()
            ->keyBy('requirement_type_id');

        $missing = [];
        foreach ($requirementTypes as $req) {
            $sub = $submissions->get($req->id);
            $status = $sub->status ?? 'not_submitted';
            if (in_array($status, ['not_submitted', 'returned'], true)) {
                $missing[] = [
                    'id' => 'req-'.$req->id,
                    'primary' => $req->name,
                    'secondary' => $status === 'returned'
                        ? ('Returned: '.($sub->remarks ?: 'Needs revision'))
                        : ($req->description ?: 'Required compliance document for '.$academicYear),
                    'status' => $status === 'returned' ? 'Returned' : 'Not submitted',
                    'status_tone' => $status === 'returned' ? 'danger' : 'warning',
                    'meta' => $req->deadline_at ? 'Due '.$req->deadline_at->format('M j, Y') : $academicYear,
                    'href' => '/dashboard/compliance',
                    'action_label' => 'Upload',
                ];
            }
        }

        return $missing;
    }

    private function scopedStudentOrganizationIds(User $user): Collection
    {
        if ($user->role === 'SUPER_ADMIN') {
            return DB::table('organizations')
                ->where('organization_type', 'STUDENT_ORGANIZATION')
                ->pluck('id');
        }

        if ($user->role === 'DEPARTMENT_HEAD') {
            return collect($user->scopedOrganizationIds());
        }

        return collect([(int) $user->organization_id]);
    }

    private function extractPriorityCards(array $sections): array
    {
        $cards = [];
        foreach ($sections as $section) {
            foreach ($section['rows'] ?? [] as $row) {
                $cards[] = $row;
                if (count($cards) >= 4) {
                    return $cards;
                }
            }
        }

        return $cards;
    }

    private function enhanceWithGroq(User $user, string $question, array $payload): ?array
    {
        $facts = [
            'role' => $user->role,
            'question' => $question,
            'deterministic_answer' => $payload['answer'],
            'highlights' => $payload['highlights'],
        ];

        $result = $this->groq->generate(
            instructions: 'You are the HIUSA Operations AI Assistant. Rewrite the provided deterministic_answer into a concise, helpful 2-sentence response that directly answers the user question using ONLY the exact numbers and facts provided. Never invent numbers, dates, or organization names.',
            input: json_encode($facts, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
            maxOutputTokens: 220,
            temperature: 0.1,
        );

        if ($result === null) {
            return null;
        }

        $plain = $this->groq->plainText($result['text']);
        if ($plain === '' || ! $this->groq->preservesNumericFacts($plain, $facts)) {
            return null;
        }

        return [
            'text' => $plain,
            'model' => $result['model'],
        ];
    }

    private function recentQueries(User $user): array
    {
        return AiOutput::where('requested_by', $user->school_id)
            ->where('feature_type', 'ASK_AI_ASSISTANT')
            ->orderByDesc('id')
            ->limit(5)
            ->get(['id', 'prompt_text', 'output_text', 'created_at'])
            ->map(fn (AiOutput $out) => [
                'id' => $out->id,
                'question' => $out->prompt_text,
                'answer' => $out->output_text,
                'asked_at' => $out->created_at?->toIso8601String(),
            ])
            ->all();
    }

    private function roleLabel(string $role): string
    {
        return match ($role) {
            'SUPER_ADMIN' => 'SAO Operations Copilot',
            'DEPARTMENT_HEAD' => 'College Oversight Copilot',
            'ADMIN' => 'Organization Admin Copilot',
            'SBO_OFFICER' => 'Officer Workflow Copilot',
            default => 'Student Portal Copilot',
        };
    }

    private function scopeLabel(User $user): string
    {
        if ($user->role === 'SUPER_ADMIN') {
            return 'University-wide student organizations';
        }
        if ($user->role === 'DEPARTMENT_HEAD') {
            return $user->organization?->name ?? 'College student organizations';
        }

        return $user->organization?->name ?? 'Your organization';
    }

    private function defaultDailyQuestion(string $role): string
    {
        return match ($role) {
            'SUPER_ADMIN' => 'What should I do today across student organizations?',
            'DEPARTMENT_HEAD' => 'What should I do today for my college?',
            'ADMIN' => 'What should I do today for our organization?',
            'SBO_OFFICER' => 'What should I do today as an officer?',
            default => 'What do I need to do today?',
        };
    }

    public function suggestedQuestions(string $role): array
    {
        return match ($role) {
            'SUPER_ADMIN' => [
                [
                    'id' => 'sao-today',
                    'topic' => 'daily_priorities',
                    'label' => 'What should I do today?',
                    'question' => 'What should I do today across student organizations?',
                    'description' => 'Prioritized SAO review queues for registrations, compliance, approvals, venues, grievances, and clearances.',
                ],
                [
                    'id' => 'sao-missing',
                    'topic' => 'missing_submissions',
                    'label' => "Who hasn't submitted requirements?",
                    'question' => "Which organizations haven't submitted compliance or financial reports?",
                    'description' => 'Exact list of student organizations missing active compliance documents or financial reports.',
                ],
                [
                    'id' => 'sao-submitted',
                    'topic' => 'submitted_documents',
                    'label' => 'Who has submitted files for review?',
                    'question' => 'Who has submitted compliance documents or reports for review?',
                    'description' => 'Recent compliance uploads and financial statements awaiting SAO action.',
                ],
                [
                    'id' => 'sao-approvals',
                    'topic' => 'pending_approvals',
                    'label' => 'Pending registrations & approvals',
                    'question' => 'What registrations, event files, and approvals are pending?',
                    'description' => 'Pending student organization applications and SAO approval requests.',
                ],
                [
                    'id' => 'sao-no-admin',
                    'topic' => 'organizations_without_admin',
                    'label' => 'Organizations needing an admin',
                    'question' => 'Which active organizations still need an administrator or were returned?',
                    'description' => 'Active student organizations without an active ADMIN profile and returned registrations.',
                ],
                [
                    'id' => 'sao-finance',
                    'topic' => 'finance_health',
                    'label' => 'University-wide budget health',
                    'question' => 'How is university-wide budget utilization and financial report status?',
                    'description' => 'Approved budget allocations and remaining balances across student organizations.',
                ],
            ],
            'DEPARTMENT_HEAD' => [
                [
                    'id' => 'dh-today',
                    'topic' => 'daily_priorities',
                    'label' => 'What should I do today?',
                    'question' => 'What should I do today for my college?',
                    'description' => 'Pending college endorsements, returned registrations, and leadership gaps.',
                ],
                [
                    'id' => 'dh-missing',
                    'topic' => 'missing_submissions',
                    'label' => "Which college orgs haven't submitted?",
                    'question' => "Which college organizations haven't submitted compliance or financial reports?",
                    'description' => 'College student organizations with incomplete compliance or unsubmitted financial reports.',
                ],
                [
                    'id' => 'dh-submitted',
                    'topic' => 'submitted_documents',
                    'label' => 'Who submitted files or reports?',
                    'question' => 'Who has submitted budgets, events, or financial reports for my review?',
                    'description' => 'Recent compliance and financial report submissions from your college organizations.',
                ],
                [
                    'id' => 'dh-approvals',
                    'topic' => 'pending_approvals',
                    'label' => 'Pending college approvals',
                    'question' => 'What requests are waiting for my approval right now?',
                    'description' => 'Requests awaiting Department Head sign-off.',
                ],
                [
                    'id' => 'dh-no-admin',
                    'topic' => 'organizations_without_admin',
                    'label' => 'Returned or missing-admin orgs',
                    'question' => 'Which organizations in my college are returned or missing an administrator?',
                    'description' => 'Organizations needing registration edits or administrator provisioning.',
                ],
                [
                    'id' => 'dh-events',
                    'topic' => 'events_attendance',
                    'label' => 'Upcoming college events',
                    'question' => 'What upcoming events are scheduled in my college?',
                    'description' => 'Approved and ongoing events across your college organizations.',
                ],
            ],
            'ADMIN' => [
                [
                    'id' => 'adm-today',
                    'topic' => 'daily_priorities',
                    'label' => 'What should I do today?',
                    'question' => 'What should I do today for our organization?',
                    'description' => 'Overdue tasks, pending approvals, missing compliance requirements, and order queues.',
                ],
                [
                    'id' => 'adm-missing',
                    'topic' => 'missing_submissions',
                    'label' => "What haven't we submitted yet?",
                    'question' => "What compliance requirements, event files, or reports haven't we submitted?",
                    'description' => 'Unsubmitted or returned compliance documents and missing event proposal files.',
                ],
                [
                    'id' => 'adm-submitted',
                    'topic' => 'submitted_documents',
                    'label' => 'What have we already submitted?',
                    'question' => 'What documents and reports have we already submitted?',
                    'description' => 'Status of all compliance files and financial reports submitted by your organization.',
                ],
                [
                    'id' => 'adm-tasks',
                    'topic' => 'tasks_workload',
                    'label' => 'Who has overdue or pending tasks?',
                    'question' => 'Who has overdue or pending tasks in our organization?',
                    'description' => 'Officer task assignments, deadlines, and completion progress.',
                ],
                [
                    'id' => 'adm-finance',
                    'topic' => 'finance_health',
                    'label' => 'Budget & unpaid student fees',
                    'question' => "Who hasn't paid collections/fees and how is our budget?",
                    'description' => 'Approved budget balances and open student invoices.',
                ],
                [
                    'id' => 'adm-clearances',
                    'topic' => 'clearances_status',
                    'label' => 'Pending student clearances',
                    'question' => 'Which students have pending or held clearance signatures?',
                    'description' => 'Students awaiting organization clearance sign-off.',
                ],
            ],
            'SBO_OFFICER' => [
                [
                    'id' => 'off-today',
                    'topic' => 'daily_priorities',
                    'label' => 'What should I do today?',
                    'question' => 'What should I do today as an officer?',
                    'description' => 'Your assigned tasks, orders awaiting payment verification, and event queues.',
                ],
                [
                    'id' => 'off-tasks',
                    'topic' => 'tasks_workload',
                    'label' => 'My overdue & active tasks',
                    'question' => 'What tasks are assigned to me or overdue?',
                    'description' => 'Deadlines and progress for tasks assigned to you.',
                ],
                [
                    'id' => 'off-orders',
                    'topic' => 'merchandise_orders',
                    'label' => 'Orders needing verification',
                    'question' => 'Which merchandise orders need payment verification or claiming?',
                    'description' => 'Student orders with payment proofs to verify or ready for pickup.',
                ],
                [
                    'id' => 'off-missing',
                    'topic' => 'missing_submissions',
                    'label' => 'Missing compliance & event files',
                    'question' => 'Which event requirements or compliance documents are still missing?',
                    'description' => 'Organization compliance requirements and event proposal files still needed.',
                ],
                [
                    'id' => 'off-events',
                    'topic' => 'events_attendance',
                    'label' => 'Upcoming & open events',
                    'question' => 'What events are happening today or need to be closed?',
                    'description' => 'Scheduled events and past events that need to be marked completed.',
                ],
                [
                    'id' => 'off-clearances',
                    'topic' => 'clearances_status',
                    'label' => 'Student clearances queue',
                    'question' => 'How many student clearances are pending?',
                    'description' => 'Pending and held student clearance lines for your organization.',
                ],
            ],
            default => [
                [
                    'id' => 'stu-today',
                    'topic' => 'daily_priorities',
                    'label' => 'What do I need to do today?',
                    'question' => 'What do I need to do today?',
                    'description' => 'Your personal checklist across clearance, fees, elections, and orders.',
                ],
                [
                    'id' => 'stu-clearance',
                    'topic' => 'clearances_status',
                    'label' => "Who hasn't signed my clearance?",
                    'question' => "Who hasn't signed my clearance yet and why?",
                    'description' => 'Status of each required signatory on your student clearance.',
                ],
                [
                    'id' => 'stu-fees',
                    'topic' => 'finance_health',
                    'label' => 'What fees or invoices do I owe?',
                    'question' => 'What fees or invoices do I still need to pay?',
                    'description' => 'Open invoices, paid amounts, and remaining balance on your account.',
                ],
                [
                    'id' => 'stu-orders',
                    'topic' => 'merchandise_orders',
                    'label' => 'Status of my merchandise orders',
                    'question' => 'What is the status of my merchandise orders?',
                    'description' => 'Orders under review and paid orders ready to claim.',
                ],
                [
                    'id' => 'stu-events',
                    'topic' => 'events_attendance',
                    'label' => 'Upcoming events',
                    'question' => 'What upcoming events are scheduled for my organization?',
                    'description' => 'Approved and ongoing organization events.',
                ],
                [
                    'id' => 'stu-elections',
                    'topic' => 'elections_status',
                    'label' => 'Active elections to vote in',
                    'question' => 'Is there an active election I still need to vote in?',
                    'description' => 'Active and upcoming elections in your organization.',
                ],
            ],
        };
    }
}
