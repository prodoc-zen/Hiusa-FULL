<?php

namespace App\Services\Ai;

use App\Contracts\TextGenerator;
use App\Models\AcademicSemester;
use App\Models\AiMemory;
use App\Models\AiOutput;
use App\Models\ApprovalRequest;
use App\Models\Budget;
use App\Models\ComplianceRequirementType;
use App\Models\Election;
use App\Models\ElectionBallot;
use App\Models\Event;
use App\Models\EventRequirement;
use App\Models\EventRequirementFile;
use App\Models\EventRequirementFileReview;
use App\Models\FinancialReport;
use App\Models\FinancialReportDeadline;
use App\Models\Invoice;
use App\Models\Organization;
use App\Models\OrganizationApplicantGrant;
use App\Models\OrganizationApplication;
use App\Models\OrganizationComplianceSubmission;
use App\Models\Transaction;
use App\Models\User;
use App\Models\VenueBooking;
use App\Services\ApprovalEntityLabel;
use App\Services\Compliance\AccreditationStatusService;
use App\Services\Dashboard\ClientRouteAccess;
use App\Services\EventApprovalChain;
use App\Services\Finance\FinancialReportChecks;
use App\Services\StudentAccountBalances;
use App\Support\LedgerScope;
use App\Support\SemesterScope;
use Illuminate\Database\Eloquent\Builder as EloquentBuilder;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Arr;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class AskAiService
{
    private const ROW_LIMIT = 12;

    // How far ahead a task counts as due soon when the financial report is being prepared.
    private const DUE_SOON_DAYS = 7;

    // A task title about money or the member records, which a report is read against.
    private const FINANCE_RECORDS_TASK_WORDS = '~\b(?:financ\w*|fees?|funds?|funding|budgets?|receipts?|ledger|payments?|dues|collect\w*|liquidat\w*|audit\w*|treasur\w*|roster|members?|membership|records?|reports?)\b~i';

    private const INTENT_MODULES = [
        'missing_submissions' => 'compliance',
        'submitted_documents' => 'compliance',
        'clearances_status' => 'compliance',
        'finance_health' => 'finance',
        'report_preparation' => 'finance',
        'merchandise_orders' => 'merchandise',
        'merchandise_stock' => 'merchandise',
        'events_attendance' => 'events',
        'event_readiness' => 'events',
    ];

    // 'tasks_workload' has no module here on purpose: an officer limited to other areas still reads their own tasks, and that answer is already cut to them.
    private const TOPICS = [
        'daily_priorities',
        'missing_submissions',
        'submitted_documents',
        'pending_approvals',
        'organizations_without_admin',
        'tasks_workload',
        'finance_health',
        'report_preparation',
        'merchandise_orders',
        'merchandise_stock',
        'events_attendance',
        'event_readiness',
        'clearances_status',
        'elections_status',
        'grievances_status',
        'semantic_rag',
        'how_to_guide',
    ];

    // Most specific first: the first pattern that matches the lowercased question decides the intent. 'missing_requirements'
    // is the plainer wording of missing_submissions, tried only after the task and file questions that share its words, and
    // 'money_words' is finance_health's unambiguous words, tried before it so an outstanding balance is not a compliance gap.
    private const INTENT_PATTERNS = [
        'daily_priorities' => '~\b(?:what (?:should|do|can|must) (?:i|we) (?:need to )?do today|what to do today|what(?:\'s| is) on (?:my|our) (?:desk|plate|list|agenda)|daily (?:priorities|briefing|checklist)|(?:action plan|checklist|priorities) (?:for )?today|today\'s (?:priorities|action plan)|where (?:do|should) (?:i|we) start|what needs (?:me|my attention|our attention))\b~',
        'organizations_without_admin' => '~\b(?:(?:without|no|missing|lacking|lacks?|needs?|needing|awaiting|vacant)(?: \w+){0,3} (?:admins?|administrators?|org(?:anization)? heads?|(?<!department )heads?)|(?:admins?|administrators?|org(?:anization)? heads?)(?: \w+){0,3} (?:missing|needed|vacant|unfilled)|returned registrations?)\b~',
        'semantic_rag' => '~\b(?:who (?:are|is) (?:the|my|our) (?:officers|president|vice|secretary|treasurer|auditor|advis[eo]r|dean|candidates)|officer directory|leadership roster|list of officers|organization members|stocks?|inventory|catalog|price of|low stock|partylist|platform|tell me about|compare|search|everything about)\b~',
        'grievances_status' => '~\b(?:grievances?|complaints?|concerns?)\b~',
        'clearances_status' => '~\b(?:clearances?|signator(?:y|ies)|signed my clearance)\b~',
        'missing_submissions' => '~\b(?:(?:haven\'t|havent|hasn\'t|hasnt|have not|has not|not|never|yet to|failed to|still need to|didn\'t|didnt)(?: \w+){0,3} (?:submit|submitted|upload|uploaded|file|filed|passed)|unsubmitted|overdue reports?)\b~',
        'submitted_documents' => '~\b(?:who (?:has |have |had )?(?:submitted|sent|uploaded|filed)|(?:already|recently) submitted|submitted (?:documents?|files?|compliance|reports?|requirements?)|what (?:have|did) (?:we|i) (?:already )?submit(?:ted)?|what documents were submitted|files? (?:\w+ ){0,6}review)\b~',
        'elections_status' => '~\b(?:elections?|votes?|voted|voting|voters?|ballots?|turnout|candidates?)\b~',
        'merchandise_orders' => '~\b(?:(?<!in )orders?|merch(?:andise)?|claim(?:s|ed|ing)?|payment proofs?|verify payments?|pick-?up)\b~',
        'tasks_workload' => '~\b(?:tasks?|workloads?|assigned|assignees?|assign|delegate|delegation|to-?do)\b~',
        'money_words' => '~\b(?:balances?|owe[ds]?|owing|unpaid|invoices?|fees?|receipts?|dues|debts?|utang|bayad|babayaran|bayaran)\b~',
        'missing_requirements' => '~\b(?:requirements?|compliance|accreditation)\b|(?=.*\b(?:files?|documents?|reports?|submi\w*|forms?|papers?)\b)\b(?:missing|incomplete|lacking|outstanding|deadlines?)\b~',
        'pending_approvals' => '~\b(?:approvals?|approve|approving|endorse\w*|pending review|waiting for (?:my |our |the )?(?:review|approval|decision)|my decision|venues?|bookings?|(?:pending|new|waiting|awaiting) registrations?|applications?)\b~',
        'finance_health' => '~\b(?:budgets?|finance|finances|financial|spent|spending|spend|fees?|invoices?|debts?|owe|owed|owes|owing|unpaid|collections?|paid|balances?|receipts?|payments?|dues|how much (?:is |do we have |do i have )?(?:left|remaining))\b~',
        'events_attendance' => '~\b(?:events?|attendance|attendees?|calendar|check[- ]?in)\b~',
    ];

    private const ROLE_INTENT_CAPABILITIES = [
        'applications_queue' => ['Organization applications', 'The applications waiting for your decision, and who each one is waiting for.'],
        'my_submissions' => ['Where our submissions stand', 'Where your event proposals, budget requests and reports are, and who has to act on them next.'],
        'ai_tools' => ['The AI tools', 'What each tool does, who can use it and where to open it.'],
        'fee_usage' => ['Where my fees go', 'How the fees your organization collected were spent, once the SAO has approved the report.'],
        'unclaimed_students' => ['Students not signed up', 'How many students in the school records have no account yet, and where to see them.'],
        'my_attendance' => ['My attendance', 'How many events you attended and missed, and your attendance rate.'],
        'claim_token' => ['My claim token', 'Which of your orders are paid and where the claim token for each one is.'],
        'glossary' => ['What a word means', 'The meaning of words like SAO, clearance, accreditation and claim token.'],
    ];

    // The question a person can ask for each role intent, offered when their own words matched nothing.
    private const ROLE_INTENT_QUESTIONS = [
        'applications_queue' => 'Which organization applications are waiting for my decision?',
        'my_submissions' => 'Where do our submissions stand?',
        'ai_tools' => 'What do the AI tools do?',
        'fee_usage' => 'Where do my membership fees go?',
        'unclaimed_students' => 'Which students have not signed up yet?',
        'my_attendance' => 'What is my attendance?',
        'claim_token' => 'Where is my claim token?',
        'glossary' => 'What is the SAO?',
    ];

    // A page that fits a kind of question, by role: [path, button label]. A link is offered only when exactly one kind
    // of question fits the words used and the person's role can open the page.
    private const PAGE_HINTS = [
        'people' => ['~\b(?:students?|roster|members?|people|users?)\b~', [
            'SUPER_ADMIN' => ['/dashboard/super-admin/users', 'Open University users'],
            'DEPARTMENT_HEAD' => ['/dashboard/department-head/people', 'Open People'],
            'ADMIN' => ['/dashboard/admin/users', 'Open Users'],
            'SBO_OFFICER' => ['/dashboard/admin/users', 'Open Users'],
        ]],
        'money' => ['~\b(?:budgets?|spend|spent|spending|expenses?|money|funds?|ledger|transactions?|income)\b~', [
            'DEPARTMENT_HEAD' => ['/dashboard/finance/budget-allocation', 'Open the budgets'],
            'ADMIN' => ['/dashboard/finance/budget-allocation', 'Open the budgets'],
            'SBO_OFFICER' => ['/dashboard/finance/budget-allocation', 'Open the budgets'],
            'STUDENT' => ['/dashboard/finance/where-fees-go', 'Open Where your fees go'],
        ]],
        'events' => ['~\b(?:events?|calendar|schedule|activities)\b~', [
            'DEPARTMENT_HEAD' => ['/dashboard/events/activity-calendar', 'Open the events calendar'],
            'ADMIN' => ['/dashboard/events/activity-calendar', 'Open the events calendar'],
            'SBO_OFFICER' => ['/dashboard/events/activity-calendar', 'Open the events calendar'],
            'STUDENT' => ['/dashboard/events/activity-calendar', 'Open the events calendar'],
        ]],
        'announcements' => ['~\b(?:announcements?|news|memo)\b~', [
            'SUPER_ADMIN' => ['/dashboard/super-admin/announcements', 'Open Announcements'],
            'DEPARTMENT_HEAD' => ['/dashboard/announcements/view-announcements', 'Open the announcements'],
            'ADMIN' => ['/dashboard/announcements/view-announcements', 'Open the announcements'],
            'SBO_OFFICER' => ['/dashboard/announcements/view-announcements', 'Open the announcements'],
            'STUDENT' => ['/dashboard/announcements/view-announcements', 'Open the announcements'],
        ]],
        'clearance' => ['~\b(?:clearances?|sign-?offs?)\b~', [
            'SUPER_ADMIN' => ['/dashboard/super-admin/clearances', 'Open Clearances'],
            'DEPARTMENT_HEAD' => ['/dashboard/clearances', 'Open Clearances'],
            'ADMIN' => ['/dashboard/clearances', 'Open Clearances'],
            'SBO_OFFICER' => ['/dashboard/clearances', 'Open Clearances'],
            'STUDENT' => ['/dashboard/my-clearance', 'Open My clearance'],
        ]],
        'grievance' => ['~\b(?:grievances?|complaints?|concerns?)\b~', [
            'SUPER_ADMIN' => ['/dashboard/super-admin/grievances', 'Open Grievances'],
            'ADMIN' => ['/dashboard/grievances', 'Open Grievances'],
            'STUDENT' => ['/dashboard/my-grievances', 'Open My grievances'],
        ]],
        'orders' => ['~\b(?:orders?|merch\w*|shirts?|shop)\b~', [
            'ADMIN' => ['/dashboard/merchandise/manage-orders', 'Open Manage orders'],
            'SBO_OFFICER' => ['/dashboard/merchandise/manage-orders', 'Open Manage orders'],
            'STUDENT' => ['/dashboard/merchandise/my-orders', 'Open My orders'],
        ]],
        'elections' => ['~\b(?:elections?|votes?|voting|candidates?|ballots?)\b~', [
            'DEPARTMENT_HEAD' => ['/dashboard/elections', 'Open the elections'],
            'ADMIN' => ['/dashboard/elections', 'Open the elections'],
            'SBO_OFFICER' => ['/dashboard/elections', 'Open the elections'],
            'STUDENT' => ['/dashboard/elections', 'Open the elections'],
        ]],
        'venues' => ['~\b(?:venues?|rooms?|halls?|bookings?)\b~', [
            'SUPER_ADMIN' => ['/dashboard/super-admin/venues', 'Open Venues'],
            'ADMIN' => ['/dashboard/venues', 'Open Venues'],
            'SBO_OFFICER' => ['/dashboard/venues', 'Open Venues'],
        ]],
        'compliance' => ['~\b(?:compliance|requirements?|accreditation|documents?|files?)\b~', [
            'SUPER_ADMIN' => ['/dashboard/super-admin/compliance', 'Open Compliance'],
            'DEPARTMENT_HEAD' => ['/dashboard/department-head/compliance', 'Open College compliance'],
            'ADMIN' => ['/dashboard/compliance', 'Open Compliance'],
        ]],
        'organizations' => ['~\b(?:organi[sz]ations?|orgs?|clubs?)\b~', [
            'SUPER_ADMIN' => ['/dashboard/super-admin/organizations', 'Open Organizations'],
            'DEPARTMENT_HEAD' => ['/dashboard/department-head/organizations', 'Open Organizations'],
        ]],
        'tasks' => ['~\b(?:tasks?|to-?do)\b~', [
            'ADMIN' => ['/dashboard/tasks/task-board', 'Open the task board'],
            'SBO_OFFICER' => ['/dashboard/tasks/assigned-tasks', 'Open My tasks'],
        ]],
        'profile' => ['~\b(?:profile|password|email address)\b~', [
            'SUPER_ADMIN' => ['/dashboard/profile', 'Open my profile'],
            'DEPARTMENT_HEAD' => ['/dashboard/profile', 'Open my profile'],
            'ADMIN' => ['/dashboard/profile', 'Open my profile'],
            'SBO_OFFICER' => ['/dashboard/profile', 'Open my profile'],
            'STUDENT' => ['/dashboard/profile', 'Open my profile'],
        ]],
        'audit' => ['~\b(?:audit|logs?)\b~', [
            'SUPER_ADMIN' => ['/dashboard/super-admin/audit-logs', 'Open Audit logs'],
            'ADMIN' => ['/dashboard/audit-logs', 'Open Audit logs'],
        ]],
        'academic' => ['~\b(?:semesters?|academic years?|school years?)\b~', [
            'SUPER_ADMIN' => ['/dashboard/super-admin/academic-years', 'Open Academic years'],
        ]],
    ];

    private const NO_ANSWER_SOURCES = 'No records were used for this answer, because I could not match your question to one I can answer.';

    private const REFUSED_SOURCES = 'No records were read, because this is outside what your account can open.';

    private const NO_RECORD_SOURCES = 'No records were read for this answer.';

    private const STUDENT_REDIRECTS = [
        'tasks_workload' => ['organization tasks, which are given to officers', 'The closest thing for you is your own list for today, and I can show it.', 'daily_priorities'],
        'pending_approvals' => ['approval queues, which officers, the Department Head and the SAO review', 'I can show your clearance, your fees and your orders instead.', 'clearances_status'],
        'missing_submissions' => ['the compliance files that organizations send to the SAO', 'I can show which signatures are still missing on your own clearance.', 'clearances_status'],
        'submitted_documents' => ['the compliance files that organizations send to the SAO', 'I can show which signatures are still missing on your own clearance.', 'clearances_status'],
        'organizations_without_admin' => ['the list of organizations that still need an organization head', 'I can show what you need to do today instead.', 'daily_priorities'],
        'merchandise_stock' => ['the stock levels of the organization\'s merchandise, which its officers keep', 'I can show your own orders instead.', 'merchandise_orders'],
        'event_readiness' => ['an event\'s readiness checklist, which the organization head and officers keep', 'I can show the upcoming events instead.', 'events_attendance'],
    ];

    private const STUDENT_INTENTS = [
        'daily_priorities',
        'finance_health',
        'merchandise_orders',
        'events_attendance',
        'clearances_status',
        'elections_status',
        'grievances_status',
        'semantic_rag',
        'how_to_guide',
    ];

    public function __construct(
        private readonly AccreditationStatusService $accreditation,
        private readonly ApprovalEntityLabel $entityLabels,
        private readonly ClientRouteAccess $routeAccess,
        private readonly StudentAccountBalances $balances,
        private readonly TextGenerator $ai,
        private readonly HowToGuideLibrary $guides,
        private readonly AskAiRoleIntents $roleIntents,
        private readonly AskAiActions $actions,
        private readonly EventApprovalChain $eventApprovals,
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
                'formatted_blocks' => $daily['formatted_blocks'],
                'charts' => $daily['charts'],
                'rag_metadata' => $daily['rag_metadata'] ?? null,
                'priorities' => $this->extractPriorityCards($daily['sections']),
                'sections' => $daily['sections'],
            ],
            'suggested_questions' => array_values(array_filter(
                $this->suggestedQuestions($user->role),
                fn (array $question) => $this->intentAllowed($user, $question['topic'])
            )),
            'recent_queries' => $this->recentQueries($user),
            'user_first_name' => $user->first_name,
            'model_enabled' => trim((string) config('services.anthropic.key')) !== '' || trim((string) config('services.groq.key')) !== '',
            'memory_count' => AiMemory::ownedBy($user)->count(),
            'starter_prompts' => $this->starterPrompts($user),
        ];
    }

    /**
     * The same records and wording as ask(), without the one-shot model call or the audit row: the chat
     * service supplies its own model call and writes its own audit row.
     */
    public function deterministicAnswer(User $user, string $question, string $intent): array
    {
        return $this->answer($user, $question, $intent, true, false);
    }

    public function canAsk(User $user, string $intent): bool
    {
        return $this->intentAllowed($user, $intent);
    }

    /**
     * Who is asking and when, in the words the model is allowed to repeat.
     *
     * @return array{first_name: string, role: string, position: ?string, scope: string, today: string, semester: ?string}
     */
    public function chatContext(User $user): array
    {
        $semester = AcademicSemester::selected();
        $label = $semester === null ? null : trim(($semester->academicYear?->label ? 'AY '.$semester->academicYear->label.' · ' : '').$this->semesterLabel((int) $semester->number));
        if ($semester !== null && $semester->id !== AcademicSemester::active()?->id) {
            $label .= ' (not the current semester)';
        }

        return [
            'first_name' => (string) $user->first_name,
            'role' => $this->roleName($user->role),
            'position' => $this->positionTitle($user),
            'scope' => $this->scopeLabel($user),
            'today' => now()->format('l, F j, Y'),
            'semester' => $label,
        ];
    }

    /** The title the person holds in their organization, or null: a student without one is never given a made-up title. */
    private function positionTitle(User $user): ?string
    {
        $title = trim((string) $user->position_title);

        return $title === '' ? null : $title;
    }

    /** @return array<int, array{id: string, label: string, question: string, topic: string}> */
    public function starterPrompts(User $user): array
    {
        return array_map(
            fn (array $prompt) => ['id' => $prompt['id'], 'label' => $prompt['label'], 'question' => $prompt['question'], 'topic' => $prompt['topic']],
            array_slice(array_values(array_filter(
                $this->suggestedQuestions($user->role),
                fn (array $question) => $this->intentAllowed($user, $question['topic'])
            )), 0, 6)
        );
    }

    /**
     * What this role can ask, built from the intents the role is allowed to use.
     */
    public function capabilitiesAnswer(User $user): array
    {
        $prompts = array_values(array_filter(
            $this->suggestedQuestions($user->role),
            fn (array $question) => $this->intentAllowed($user, $question['topic'])
        ));

        $lines = array_map(fn (array $q) => '- **'.$q['label'].'**: '.$q['description'], $prompts);
        $listed = array_column($prompts, 'topic');
        foreach (self::ROLE_INTENT_CAPABILITIES as $intent => [$label, $description]) {
            if (! in_array($intent, $listed, true) && $this->roleIntents->allowed($user, $intent)) {
                $lines[] = '- **'.$label.'**: '.$description;
            }
        }
        $forms = array_map('lcfirst', $this->actions->titlesFor($user));
        $answer = 'I can read the records your account can already open and put them in plain words. As '.$this->roleName($user->role).' for '.$this->scopeLabel($user).", you can ask me things like:\n\n"
            .implode("\n", $lines)
            ."\n\nI can also take you to where things get done. Say what you want to do, for example \"".(self::REQUEST_EXAMPLES[$user->role] ?? 'I want to create an event')."\", and I will tell you whether you are ready and open the right page. Here is what I can help you start:\n\n"
            .implode("\n", $this->capabilityGuideLines($user->role))
            .($forms === [] ? '' : "\n\nIn the chat I can also fill in the form for you, for these: ".implode(', ', $forms).'. Nothing is saved until you check the form and confirm it.')
            ."\n\nI can also explain how HIUSA works step by step, help you draft a message or an agenda, and remember things you ask me to keep in mind (say \"remember that ...\"). I never approve, assign or publish anything for you.";

        return $this->enrichWithFormattedBlocksAndCharts([
            'title' => 'What I can help with',
            'answer' => $answer,
            'highlights' => [],
            'sections' => [],
            'follow_ups' => array_map(fn (array $q) => ['topic' => $q['topic'], 'label' => $q['label'], 'question' => $q['question']], array_slice($prompts, 0, 3)),
            'model_name' => null,
        ], 'capabilities');
    }

    /** Who the account is: role, organization and officer position, read from the account and needing no model. */
    public function identityAnswer(User $user): array
    {
        $position = $this->positionTitle($user);
        $answer = 'You are signed in as '.$this->roleName($user->role).' for '.AnswerMarkdown::escape($this->scopeLabel($user)).'.'
            .($position !== null
                ? ' Your position is '.AnswerMarkdown::escape($position).'.'
                : ($user->role === 'STUDENT' ? ' There is no officer position on your account.' : ' There is no position title on your account.'));

        return $this->enrichWithFormattedBlocksAndCharts([
            'title' => 'Who you are in HIUSA',
            'answer' => $answer,
            'highlights' => [],
            'sections' => [],
            'follow_ups' => array_map(fn (array $q) => ['topic' => $q['topic'], 'label' => $q['label'], 'question' => $q['question']], array_slice($this->starterPrompts($user), 0, 3)),
            'model_name' => null,
        ], 'identity');
    }

    /** A short answer for a greeting or thanks, still carrying the role's first prompts as chips. */
    public function greetingAnswer(User $user, bool $thanks): array
    {
        $name = trim((string) $user->first_name);
        $answer = $thanks
            ? 'You are welcome. Ask me anything else about your records whenever you need it.'
            : 'Hello'.($name !== '' ? ', '.$name : '').'. What would you like to look at? I can read your records, explain how a process works or help you draft something.';

        return $this->enrichWithFormattedBlocksAndCharts([
            'title' => $thanks ? 'You are welcome' : 'Hello',
            'answer' => $answer,
            'highlights' => [],
            'sections' => [],
            'follow_ups' => array_map(fn (array $q) => ['topic' => $q['topic'], 'label' => $q['label'], 'question' => $q['question']], array_slice($this->starterPrompts($user), 0, 3)),
            'model_name' => null,
        ], 'greeting');
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
            'context_version' => 'ask-ai-rag-v2',
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
                'rag_metadata' => $response['rag_metadata'] ?? null,
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
            'formatted_blocks' => $response['formatted_blocks'],
            'charts' => $response['charts'],
            'rag_metadata' => $response['rag_metadata'] ?? null,
            'sections' => $response['sections'],
            'follow_ups' => $response['follow_ups'],
            'sources' => $response['sources'],
            'generated_at' => now()->toIso8601String(),
            'engine' => $response['model_name'] ? (str_starts_with($response['model_name'], 'claude') ? 'claude' : 'groq').'+semantic_rag' : 'semantic_rag+deterministic',
        ];
    }

    public function classifyIntent(string $question, ?string $topic, string $role): string
    {
        if ($topic !== null && in_array($topic, [...self::TOPICS, ...AskAiRoleIntents::INTENTS], true)) {
            return $topic;
        }

        $q = trim((string) preg_replace('/\s+/', ' ', Str::lower(str_replace(['’', '‘'], "'", $question))));

        // Procedural "how do I ..." questions get step-by-step guidance. Data
        // questions such as "how many" / "how much" / "how is our budget"
        // deliberately do not match and keep flowing to the data intents.
        if ($this->isHowToQuestion($q)) {
            return 'how_to_guide';
        }

        if (preg_match('~\b(?:plan|organi[sz]e|schedule) (?:my|our) (?:day|week|time)\b~', $q) === 1) {
            return 'daily_priorities';
        }

        // "What should I do before submitting the financial report" asks for the work to do, not for what the report checks are,
        // so it is answered from the organization's own records before the tool descriptions claim the words.
        if ($this->asksReportPreparation($q, $role)) {
            return 'report_preparation';
        }

        $roleIntent = $this->roleIntents->match($question, $role);
        if ($roleIntent !== null) {
            return $roleIntent;
        }

        if ($this->asksOwnBalance($q, $role)) {
            return in_array($role, ['ADMIN', 'SBO_OFFICER'], true) ? 'own_balance' : 'how_to_guide';
        }

        // "I wanna create an org", "book a venue", "can you post an announcement": someone saying what they want to do
        // is taken to the guide for it, after the role intents above have claimed their own wording.
        if ($this->isActionRequest($q)) {
            return 'how_to_guide';
        }

        // "Which merchandise is running low" is the stock, not the order queue that shares the word merchandise, and
        // "is Sports Fest ready" is a checklist for one event, not the events list or a status count.
        if ($this->asksLowStock($q)) {
            return 'merchandise_stock';
        }

        if ($this->asksEventReadiness($q, $role)) {
            return 'event_readiness';
        }

        // "What events are coming up and what tasks do they have" asks for the events first, and the tasks are listed under them.
        if ($this->asksEventTasks($q)) {
            return 'events_attendance';
        }

        // A student's own records come before the staff words they share: "outstanding balance" is their fees, not a
        // compliance gap, and "events assigned this month" is the calendar, not the task board.
        if ($role === 'STUDENT' && preg_match(self::INTENT_PATTERNS['semantic_rag'], $q) !== 1) {
            foreach (self::STUDENT_FIRST as $intent) {
                if (preg_match(self::INTENT_PATTERNS[$intent], $q) === 1) {
                    return $intent === 'money_words' ? 'finance_health' : $intent;
                }
            }
        }

        foreach (self::INTENT_PATTERNS as $intent => $pattern) {
            if (preg_match($pattern, $q) !== 1) {
                continue;
            }

            return match ($intent) {
                'missing_requirements' => 'missing_submissions',
                'money_words' => 'finance_health',
                default => $intent,
            };
        }

        return 'semantic_rag';
    }

    // Stock words that mean the stock level on their own, and the "running low" words that need an item word beside them
    // so "is our budget running low" stays a budget question.
    private const STOCK_WORDS = '~\b(?:low[- ]stock|out[- ]of[- ]stock|(?:low|short|out) (?:on|of) (?:stock|inventory|supplies)|sold[- ]out|re-?stock\w{0,8}|stock levels?|stock status|inventory)\b~';

    private const RUNNING_LOW_WORDS = '~\b(?:running (?:low|out|short)|(?:almost|nearly) (?:gone|out)|low on)\b~';

    private const ITEM_WORDS = '~\b(?:merch(?:andise)?|items?|products?|goods|supplies|shirts?|lanyards?|hoodies?|store|shop)\b~';

    private function asksLowStock(string $q): bool
    {
        return preg_match(self::STOCK_WORDS, $q) === 1
            || (preg_match(self::RUNNING_LOW_WORDS, $q) === 1 && preg_match(self::ITEM_WORDS, $q) === 1);
    }

    // The words that ask whether something is ready, and the words that say the thing is not an event: an order to claim,
    // a clearance, a report, a budget. Without those, an Admin, an officer or a student asking "is X ready" is asking
    // about an event; the Dean and the SAO need an event word beside it because they ask about approvals too.
    private const READY_WORDS = '~\b(?:ready|all set|good to go|set to go|prepared|on track|readiness)\b~';

    private const NOT_AN_EVENT_WORDS = '~\b(?:orders?|claim\w{0,6}|pick-?up|merch\w{0,9}|clearances?|signatures?|ballots?|votes?|voting|elections?|invoices?|fees?|receipts?|payments?|tokens?|budgets?|funds?|reports?|documents?|files?|submissions?|requirements?|applications?|registrations?|approvals?|reviews?|grievances?|complaints?|tasks?|accounts?|passwords?|profile|certificates?|grades?)\b~';

    private const EVENT_WORDS = '~\b(?:events?|fest|festival|seminar|assembly|workshop|summit|tournament|competition|orientation|concert|activity|activities|program|programme|induction|ceremony|gala|week)\b~';

    // The people who send a financial report: the organization head and the officers who keep its books. A reviewer reads the
    // report, so the question reaches the tool description for them.
    private const REPORT_BEFORE = '~\b(?:before|prior to|ahead of)\b(?: \w+){0,3} (?:submit\w*|send\w*|fil(?:e|ing)|hand(?:ing)? in|turn(?:ing)? in)\b(?: \w+){0,4} financial reports?\b~';

    private const REPORT_READY = '~\bready (?:to|for) (?:submit\w*|send\w*)\b(?: \w+){0,4} financial reports?\b|\bfinancial reports?\b(?: \w+){0,4} ready (?:to|for) (?:submit|send)\w*~';

    private const REPORT_WORK_WORDS = '~\b(?:what|which|anything|things?|steps?|checklist|prepare|preparing|ready|need|needs|should|must|to do)\b~';

    private function asksReportPreparation(string $q, string $role): bool
    {
        return in_array($role, ['ADMIN', 'SBO_OFFICER'], true)
            && (preg_match(self::REPORT_BEFORE, $q) === 1 || preg_match(self::REPORT_READY, $q) === 1)
            && preg_match(self::REPORT_WORK_WORDS, $q) === 1;
    }

    // An event word, a task word and a word for what is ahead. Overdue, workload, "most tasks" and "my tasks" questions
    // are about the task list even when an event is named, so they never come here.
    private const EVENT_TASK_AHEAD = '~\b(?:upcoming|coming up|next|scheduled|this (?:week|month)|what events)\b~';

    private const EVENT_TASK_LIST_WORDS = '~\b(?:overdue|late|workloads?|most|fewest|least|how many|who has|who is|my|mine|me|i have|i am|assigned|assignees?|delegat\w*)\b~';

    private function asksEventTasks(string $q): bool
    {
        return preg_match('~\b(?:events?|activities|calendar)\b~', $q) === 1
            && preg_match('~\b(?:tasks?|to-?do)\b~', $q) === 1
            && preg_match(self::EVENT_TASK_AHEAD, $q) === 1
            && preg_match(self::EVENT_TASK_LIST_WORDS, $q) !== 1;
    }

    private function asksEventReadiness(string $q, string $role): bool
    {
        if (preg_match(self::READY_WORDS, $q) !== 1 || preg_match(self::NOT_AN_EVENT_WORDS, $q) === 1) {
            return false;
        }

        return ! in_array($role, ['SUPER_ADMIN', 'DEPARTMENT_HEAD'], true) || preg_match(self::EVENT_WORDS, $q) === 1;
    }

    private const STUDENT_FIRST = ['grievances_status', 'clearances_status', 'merchandise_orders', 'elections_status', 'money_words', 'finance_health', 'events_attendance'];

    // "What do I owe" asked by someone who is not a student: the answer is their own account, never the organization's budget.
    private const OWN_BALANCE = '~\b(?:what|how much|how many)\b(?: \w+){0,3} (?:do|did|will|would) i (?:still )?owe\b|\bdo i (?:still )?owe\b|\bwhat i (?:still )?owe\b|\bmy (?:outstanding |unpaid |current )?(?:balance|dues|fees|invoices?|receipts?)\b|\b(?:am|are) i (?:cleared|fully paid|paid up)\b|\b(?:utang|bayarin|balanse) ko\b|\b(?:magkano|ano) (?:ang )?(?:utang|babayaran|bayad) ko\b~';

    private function asksOwnBalance(string $q, string $role): bool
    {
        return $role !== 'STUDENT' && preg_match(self::OWN_BALANCE, $q) === 1;
    }

    private function answer(User $user, string $question, string $intent, bool $allowModel, bool $callModel = true): array
    {
        $payload = $this->composeAnswer($user, $question, $intent, $allowModel, $callModel);
        $payload['sources'] ??= $this->sourcesFor($user, $intent, $payload);

        return $payload;
    }

    private function composeAnswer(User $user, string $question, string $intent, bool $allowModel, bool $callModel = true): array
    {
        if ($intent === 'how_to_guide') {
            return $this->answerHowTo($user, $question);
        }

        if (! $this->intentAllowed($user, $intent)) {
            return $this->enrichWithFormattedBlocksAndCharts([...$this->refusal($user, $intent), 'sources' => self::REFUSED_SOURCES], $intent);
        }

        $organizationIds = $this->scopedStudentOrganizationIds($user);
        $rag = $this->retrieveRagContext($user, $question, $organizationIds, $intent === 'semantic_rag' || $allowModel);

        if ($intent === 'semantic_rag') {
            $payload = $this->asksForRecords($question, $rag)
                ? $this->buildSemanticRagPayload($user, $question, $rag, $organizationIds)
                : $this->buildNoAnswer($user, $question);
        } else {
            $payload = match ($intent) {
                'missing_submissions' => $this->buildMissingSubmissions($user, $organizationIds),
                'submitted_documents' => $this->buildSubmittedDocuments($user, $organizationIds),
                'pending_approvals' => $this->buildPendingApprovals($user, $organizationIds),
                'organizations_without_admin' => $this->buildOrganizationsWithoutAdmin($user, $organizationIds),
                'tasks_workload' => $this->buildTasksWorkload($user, $organizationIds),
                'finance_health' => $this->withBudgetNote($user, $question, $this->buildFinanceHealth($user, $organizationIds)),
                'report_preparation' => $this->buildReportPreparation($user),
                'own_balance' => $this->buildFinanceHealth($user, $organizationIds, true),
                'merchandise_orders' => $this->buildMerchandiseOrders($user),
                'merchandise_stock' => $this->buildMerchandiseStock($user),
                'events_attendance' => $this->buildEventsAttendance($user, $organizationIds),
                'event_readiness' => $this->buildEventReadiness($user, $question),
                'clearances_status' => $this->buildClearancesStatus($user, $organizationIds),
                'elections_status' => $this->buildElectionsStatus($user, $organizationIds),
                'grievances_status' => $this->buildGrievancesStatus($user),
                'applications_queue' => $this->withWaitingRequests($user, $organizationIds, $this->roleIntents->build($user, $intent, $question)),
                'my_submissions', 'ai_tools', 'fee_usage', 'unclaimed_students', 'my_attendance', 'claim_token', 'glossary' => $this->roleIntents->build($user, $intent, $question),
                default => $this->buildDailyPriorities($user, $organizationIds),
            };

            // A stock list, a readiness checklist and a report preparation list are whole answers; the records the search ranked beside them would repeat them.
            if ($allowModel && ! in_array($intent, ['daily_priorities', 'merchandise_stock', 'event_readiness', 'report_preparation'], true) && ! in_array($intent, AskAiRoleIntents::INTENTS, true)) {
                $payload = $this->augmentWithRagMatches($payload, $rag);
            }
        }

        $payload['follow_ups'] = array_values(array_filter(
            $payload['follow_ups'] ?? [],
            fn (array $followUp) => $this->intentAllowed($user, $followUp['topic'])
        ));

        $modelName = null;
        if ($allowModel && $callModel && empty($payload['no_answer'])) {
            $enhanced = $this->enhanceWithModel($user, $question, $payload, $rag);
            if ($enhanced !== null) {
                $payload['answer'] = $enhanced['text'];
                $modelName = $enhanced['model'];
            }
        }

        // An answer that matched nothing carries none of the records the search happened to rank.
        if (! empty($payload['no_answer'])) {
            $rag = [...$rag, 'chunks' => [], 'matched_entities' => [], 'top_confidence' => 0];
        }

        $payload['model_name'] = $modelName;
        $payload['rag_chunks'] = array_map(fn (array $chunk) => [
            'domain' => $chunk['domain'],
            'primary' => $chunk['primary'],
            'secondary' => $chunk['secondary'],
            'status' => $chunk['status'],
            'meta' => $chunk['meta'],
        ], array_slice($rag['chunks'] ?? [], 0, 8));
        $payload['rag_metadata'] = [
            'engine' => $modelName ? 'Record search + '.(str_starts_with($modelName, 'claude') ? 'Claude' : 'Groq') : 'Record search',
            'corpus_size' => $rag['corpus_size'],
            'retrieved_count' => count($rag['chunks']),
            'domains_searched' => $rag['domains_searched'],
            'matched_concepts' => $rag['matched_concepts'],
            'matched_entities' => $rag['matched_entities'],
            'top_confidence' => $rag['top_confidence'],
        ];

        $payload = $this->enrichWithFormattedBlocksAndCharts($payload, $intent);
        if (! empty($payload['no_answer'])) {
            $payload['charts'] = [];
        }

        return $payload;
    }

    // -------------------------------------------------------------------------
    // Intent 0: Procedural How-To Guidance ("How do I create an event?")
    // -------------------------------------------------------------------------

    private function isHowToQuestion(string $q): bool
    {
        if (preg_match('/\bhow\s+(many|much|is|are|was|were|far|long|often)\b/', $q) === 1) {
            return false;
        }

        return preg_match(
            '/\b(how\s+(do|can|should|would|could|does|will)\s+(i|we|you|a|an|the|students?|officers?|admins?|sao|deans?)\b'
            .'|how\s+to\b|steps?\s+(to|for|in|on)\b|step[\s-]by[\s-]step|walk\s+me\s+through|guide\s+me|show\s+me\s+how'
            .'|teach\s+me|where\s+(do|can|should)\s+(i|we)\b|what\s+(is|are)\s+the\s+(steps|process|procedure)'
            .'|process\s+(of|for|to)\b|procedure\s+(for|to)\b|tutorial|instructions?\s+(for|to|on)\b|paano\s+(ako\s+|kami\s+)?mag\b)/',
            $q
        ) === 1;
    }

    // The doing verbs that open a request. Seeing, listing, telling, knowing and checking are left out on purpose:
    // "show me", "list", "tell me" and "I want to know" stay record questions. "send me" is a record question too.
    private const REQUEST_VERBS = '(?:create|make|add|register|start|set ?up|open|file|submit|send|book|reserve|post|publish|invite|import|upload|record|approve|endorse|return|order|buy|vote|pay|sign|assign|schedule|plan|draft|write|change|update|delete|remove|archive|close|reset|apply|join|claim|request|enroll)\b(?!\s+(?:me|us)\b)';

    private const REQUEST_OPENERS = '(?:(?:hi|hello|hey|ok|okay|so|um|bro|sir|po)\b[ ,.!]*)*';

    // Whole-word patterns, tried in this order, for the ways people say what they want to do.
    private const REQUEST_PATTERNS = [
        'first_person' => '~^'.self::REQUEST_OPENERS.'(?:i(?: would| ?\'d)? (?:like|want|need)|i wanna|let me|let\'s|let us|we(?: would| ?\'d)? (?:like|want|need)|we wanna)(?: to)?\s+(?:also |now |just )?'.self::REQUEST_VERBS.'~',
        'polite' => '~^'.self::REQUEST_OPENERS.'(?:(?:can you|could you|would you|will you|can u|can i|could i|may i|can we|could we|please|pls|kindly|help me to|help me|i want you to)\s+)+(?:to )?'.self::REQUEST_VERBS.'~',
        'filipino' => '~^'.self::REQUEST_OPENERS.'(?:gusto|nais|kailangan|pwede|puwede|paki|tulungan)\b(?:\s+(?:ba|po|ko|kong|namin|naming|ako|akong|kami|kaming|na|ng|mo|mong))*\s+(?:mag-?\s?|pa-?)?'.self::REQUEST_VERBS.'~',
        'imperative' => '~^'.self::REQUEST_OPENERS.'(?:(?:please|pls|just|now|then)\s+)*(?!(?:open|close)\s+(?!an?\b|the\b|my\b|our\b|new\b)\w*s\b)'.self::REQUEST_VERBS.'(?!\s+(?:on|about|of|is|are|was|were|has|have|had|for|by|status|history|summary|count|total|details?|number|dates?|times?|results?)\b)\s+\S~',
    ];

    private const ROLE_SELF = [
        'SUPER_ADMIN' => 'The SAO',
        'DEPARTMENT_HEAD' => 'A Department Head',
        'ADMIN' => 'An Organization Admin',
        'SBO_OFFICER' => 'An SBO Officer',
        'STUDENT' => 'A student',
    ];

    private const ROLE_DOERS = [
        'SUPER_ADMIN' => 'the SAO',
        'DEPARTMENT_HEAD' => 'the Department Head',
        'ADMIN' => 'the Organization Admin',
        'SBO_OFFICER' => 'an SBO Officer',
        'STUDENT' => 'a student',
    ];

    private const ROLE_HOME = [
        'SUPER_ADMIN' => '/dashboard/super-admin',
        'DEPARTMENT_HEAD' => '/dashboard/department-head',
        'ADMIN' => '/dashboard/admin',
        'SBO_OFFICER' => '/dashboard/officer',
        'STUDENT' => '/dashboard/student',
    ];

    private const REQUEST_EXAMPLES = [
        'SUPER_ADMIN' => 'I want to invite a dean',
        'DEPARTMENT_HEAD' => 'I wanna create an org',
        'ADMIN' => 'I need to create an event',
        'SBO_OFFICER' => 'I want to book a venue',
        'STUDENT' => 'I want to file a grievance',
    ];

    // The closest page a role can open for a kind of work it cannot do: [path, button label, what the person can do there].
    private const NEAREST_PAGES = [
        'Events' => [['/dashboard/events/activity-calendar', 'Open the events calendar', 'see what is coming up on the events calendar']],
        'Venues' => [['/dashboard/events/activity-calendar', 'Open the events calendar', 'see what is coming up on the events calendar']],
        'Announcements' => [['/dashboard/announcements/view-announcements', 'Open the announcements', 'read the announcements that were posted']],
        'Members' => [
            ['/dashboard/department-head/people', 'Open People', 'see the students and staff of your college'],
            ['/dashboard/super-admin/users', 'Open University users', 'look up the people who have accounts'],
        ],
        'Elections' => [['/dashboard/elections', 'Open the elections', 'see the elections and their results']],
        'Approvals' => [['/dashboard/finance/budget-allocation', 'Open the budgets', 'read the budgets that are already approved']],
        'Finance' => [
            ['/dashboard/finance/budget-allocation', 'Open the budgets', 'read the budgets that are already approved'],
            ['/dashboard/finance/statement-of-account', 'Open my statement of account', 'see what you owe and what you have paid'],
        ],
        'Tasks' => [['/dashboard/tasks/assigned-tasks', 'Open My tasks', 'see the tasks that were given to you']],
        'Merchandise' => [['/dashboard/merchandise/order-merchandise', 'Open the shop', 'look at the merchandise that is on sale']],
        'Clearances' => [['/dashboard/my-clearance', 'Open My clearance', 'see who has signed your clearance']],
        'Organizations' => [
            ['/dashboard/department-head/organizations', 'Open Organizations', 'see the organizations of your college'],
            ['/dashboard/super-admin/organizations', 'Open Organizations', 'see the organizations and their registrations'],
        ],
        'Accreditation & compliance' => [
            ['/dashboard/compliance', 'Open Compliance', 'see the requirements and what has been sent'],
            ['/dashboard/department-head/compliance', 'Open College compliance', 'see which organizations still owe files'],
            ['/dashboard/super-admin/compliance', 'Open Compliance', 'see the requirements and what has been sent'],
        ],
    ];

    private function plainQuestion(string $question): string
    {
        return trim((string) preg_replace('/\s+/', ' ', Str::lower(str_replace(['’', '‘'], "'", $question))));
    }

    private function isActionRequest(string $q): bool
    {
        if ($this->isHowToQuestion($q)) {
            return false;
        }

        foreach (self::REQUEST_PATTERNS as $pattern) {
            if (preg_match($pattern, $q) === 1) {
                return true;
            }
        }

        return false;
    }

    /** What a guide is called as a thing to do: "create an event". With $own it keeps "your". */
    private function howToAction(array $guide, bool $own = false): string
    {
        $action = (string) ($guide['action'] ?? lcfirst($guide['title']));

        return $own ? $action : (string) preg_replace('/\byour\b/', 'the', $action);
    }

    /**
     * The page where this role begins a guide, as a row with a button: the guide's own form link when it has one,
     * otherwise the first step that has a page this role can open.
     *
     * @return null|array{href: string, label: string, page: string, row: array<string, mixed>}
     */
    private function howToStart(User $user, array $guide): ?array
    {
        $role = $user->role;
        $first = null;
        $href = null;
        foreach ($guide['steps'] as $step) {
            $href = $this->linkTo($user, ...$this->guides->stepPaths($step, $role));
            if ($href !== null) {
                $first = $step;
                break;
            }
        }

        if ($first === null) {
            return null;
        }

        $segments = explode('→', (string) ($first['where'] ?? $first['title']));
        $page = trim((string) end($segments));
        $form = isset($guide['open_path']) ? $this->linkTo($user, $guide['open_path']) : null;
        $label = $form !== null ? (string) ($guide['open_label'] ?? $first['title']) : (string) $first['title'];

        return [
            'href' => $form ?? $href,
            'label' => $label,
            'page' => $page,
            'row' => [
                'id' => $guide['id'].'-start',
                'primary' => $label,
                'secondary' => $form !== null ? 'The form opens ready to fill in.' : $first['detail'],
                'status' => 'Start here',
                'status_tone' => 'primary',
                'meta' => $first['where'] ?? null,
                'href' => $form ?? $href,
                'action_label' => $label,
            ],
        ];
    }

    /** A request in the doing voice: where to do it, what happens next, and where the person stands. */
    /** A student who has no permission to apply and no application yet cannot use the apply guide today. */
    private function applyingBlocked(User $user, array $guide): bool
    {
        if ($user->role !== 'STUDENT' || ! in_array('own_application', $guide['checks'] ?? [], true)) {
            return false;
        }

        $applied = OrganizationApplication::query()
            ->where('school_id', $user->school_id)
            ->whereNotIn('status', OrganizationApplication::LEGACY_UNQUEUED)
            ->exists();

        return ! $applied && ! OrganizationApplicantGrant::query()->usable()->where('user_school_id', $user->school_id)->exists();
    }

    private function buildHowToRequest(User $user, array $guide, bool $accessible, array $related): array
    {
        if (! $accessible) {
            return $this->buildHowToWhoCan($user, $guide, $related);
        }

        $payload = $this->buildHowToGuide($user, $guide, true, $related);
        $start = $this->howToStart($user, $guide);
        $single = $start !== null && $this->howToHasOneDestination($user, $guide, $start['href']);

        if ($start !== null && ! $single) {
            array_unshift($payload['sections'], [
                'id' => 'how-to-start',
                'title' => 'Where to start',
                'description' => null,
                'empty_message' => '',
                'rows' => [$start['row']],
            ]);
        }

        $doing = $guide['doing'] ?? null;
        $doing = is_array($doing) ? ($doing[$user->role] ?? null) : $doing;
        $answer = $doing ?? sprintf(
            'Yes, you can do that%s. %s',
            $start !== null ? ', and it starts on the '.$start['page'].' page' : '',
            $guide['summary']
        );

        $stands = [];
        foreach ($payload['sections'] as $section) {
            if ($section['id'] !== 'how-to-readiness') {
                continue;
            }
            foreach ($section['rows'] as $row) {
                $stands[] = rtrim((string) $row['primary'], '. ').'.'
                    .($row['status_tone'] === 'warning' && ! empty($row['secondary']) ? ' '.rtrim((string) $row['secondary'], '. ').'.' : '');
            }
        }
        if ($stands !== []) {
            $answer .= "\n\nFrom your records: ".implode(' ', $stands);
        }
        if ($start !== null) {
            $answer .= "\n\nThe \"".$start['label'].'" button below takes you there, and the steps are listed under it.';
        }

        $payload['title'] = $guide['title'];
        $payload['answer'] = $answer;

        if ($single) {
            $payload = $this->collapseHowToRequest($payload, $guide, $start);
        }

        return $payload;
    }

    /** True when every step of the guide, and its start button, open the same page for this role. */
    private function howToHasOneDestination(User $user, array $guide, string $startHref): bool
    {
        $paths = [strtok($startHref, '?')];
        foreach ($guide['steps'] as $step) {
            $href = $this->linkTo($user, ...$this->guides->stepPaths($step, $user->role));
            if ($href !== null) {
                $paths[] = strtok($href, '?');
            }
        }

        return count(array_unique($paths)) === 1;
    }

    /**
     * A guide with one destination is the sentence plus one row carrying the button. The steps wait behind a single
     * section with no buttons of their own, and the stat tiles, the readiness and tips sections go: what the person's
     * records say is already in the sentence.
     *
     * @param  array<string, mixed>  $payload
     * @param  array{href: string, label: string, page: string, row: array<string, mixed>}  $start
     * @return array<string, mixed>
     */
    private function collapseHowToRequest(array $payload, array $guide, array $start): array
    {
        $row = $start['row'];
        $row['status'] = null;

        $steps = [];
        foreach ($payload['sections'] as $section) {
            if ($section['id'] !== 'how-to-steps') {
                continue;
            }
            $section['rows'] = array_map(fn (array $stepRow) => array_merge($stepRow, ['href' => null]), $section['rows']);
            $steps[] = $section;
        }

        $payload['highlights'] = [];
        $payload['sections'] = array_merge([[
            'id' => 'how-to-start',
            'title' => $guide['title'],
            'description' => null,
            'empty_message' => '',
            'rows' => [$row],
        ]], $steps);

        return $payload;
    }

    /** A request this role cannot carry out: say who can, then offer the closest thing this person can do. */
    private function buildHowToWhoCan(User $user, array $guide, array $related): array
    {
        $role = $user->role;
        $doers = array_map(fn (string $r) => self::ROLE_DOERS[$r] ?? $r, $guide['done_by'] ?? $guide['roles']);
        $nearest = $this->howToNearest($user, $guide, $related);

        $answer = sprintf('%s cannot %s in HIUSA; that is done by %s.', self::ROLE_SELF[$role] ?? 'Your role', $this->howToAction($guide), $this->joinPhrases($doers));
        if (! empty($guide['otherwise'])) {
            $answer .= ' '.$guide['otherwise'];
        }
        if ($nearest !== null) {
            $answer .= ' The nearest thing you can do is '.$nearest['phrase'].', and the button below opens it.';
        }

        $followUps = array_map(fn (array $g) => [
            'topic' => 'how_to_guide',
            'label' => $g['title'],
            'question' => $g['question'],
        ], $related);
        if (count($followUps) < 3) {
            $followUps[] = [
                'topic' => 'daily_priorities',
                'label' => 'What should I do today?',
                'question' => $this->defaultDailyQuestion($role),
            ];
        }

        return [
            'title' => ucfirst($this->howToAction($guide)),
            'answer' => $answer,
            'highlights' => [
                ['label' => 'Your access', 'value' => 'Other role', 'tone' => 'warning'],
                ['label' => 'Done by', 'value' => implode(', ', array_map(fn (string $r) => HowToGuideLibrary::ROLE_NAMES[$r] ?? $r, $guide['done_by'] ?? $guide['roles'])), 'tone' => 'info'],
            ],
            'sections' => $nearest === null ? [] : [[
                'id' => 'how-to-nearest',
                'title' => 'The nearest thing you can do',
                'description' => null,
                'empty_message' => '',
                'rows' => [$nearest['row']],
            ]],
            'follow_ups' => array_slice($followUps, 0, 3),
        ];
    }

    /**
     * The closest page this role can open: one of its own guides in the same category, then a page that fits the
     * category, then one of the related guides, then its own dashboard. Every href goes through the role's allowlist.
     *
     * @return null|array{phrase: string, row: array<string, mixed>}
     */
    private function howToNearest(User $user, array $guide, array $related): ?array
    {
        $role = $user->role;
        $row = fn (string $label, string $phrase, string $href) => [
            'phrase' => $phrase,
            'row' => [
                'id' => 'how-to-nearest',
                'primary' => $label,
                'secondary' => ucfirst($phrase).'.',
                'status' => 'Closest option',
                'status_tone' => 'info',
                'meta' => null,
                'href' => $href,
                'action_label' => $label,
            ],
        ];

        $own = array_filter($this->guides->forRole($role), fn (array $g) => $g['category'] === $guide['category'] && $g['category'] !== 'Getting around');
        foreach ([...$own, ...$related] as $candidate) {
            $start = $this->howToStart($user, $candidate);
            if ($start !== null) {
                return $row($start['label'], $this->howToAction($candidate, true), $start['href']);
            }
        }

        foreach (self::NEAREST_PAGES[$guide['category']] ?? [] as [$path, $label, $phrase]) {
            $href = $this->linkTo($user, $path);
            if ($href !== null) {
                return $row($label, $phrase, $href);
            }
        }

        $home = $this->linkTo($user, ...array_filter([self::ROLE_HOME[(string) $user->profileRole()] ?? null, self::ROLE_HOME[$role] ?? null]));

        return $home === null ? null : $row('Open my dashboard', 'start from your dashboard, where your own work is gathered', $home);
    }

    /** Rows that come from the person's own records for the readiness checks beyond the active semester. */
    private function howToRecordRows(User $user, array $checks): array
    {
        $role = $user->role;
        $home = $user->organization;
        $collegeId = $home?->organization_type === 'COLLEGE' && $home->college_id ? (int) $home->college_id : null;
        $row = fn (string $id, string $primary, ?string $secondary, string $status, string $tone, ?string $href = null, ?string $label = null) => [
            'id' => 'ready-'.$id,
            'primary' => $primary,
            'secondary' => $secondary,
            'status' => $status,
            'status_tone' => $tone,
            'meta' => null,
            'href' => $href,
        ] + ($label !== null ? ['action_label' => $label] : []);
        $rows = [];

        if ($role === 'DEPARTMENT_HEAD' && $collegeId !== null && in_array('college_organizations', $checks, true)) {
            $counts = Organization::whereIn('id', $user->scopedOrganizationIds())
                ->selectRaw('lifecycle_status, count(*) as total')->groupBy('lifecycle_status')->pluck('total', 'lifecycle_status');
            $total = (int) $counts->sum();
            $parts = [];
            foreach (['active' => 'active', 'pending' => 'waiting for the SAO', 'returned' => 'returned', 'archived' => 'archived'] as $key => $label) {
                if ((int) ($counts[$key] ?? 0) > 0) {
                    $parts[] = $counts[$key].' '.$label;
                }
            }
            $rows[] = $total === 0
                ? $row('organizations', 'No student organization has started in your college yet', null, 'Your college', 'info')
                : $row('organizations', 'Your college has '.$this->plural($total, 'student organization'), implode(', ', $parts), 'Your college', 'info');
        }

        if ($role === 'DEPARTMENT_HEAD' && $collegeId !== null && in_array('applicant_grants', $checks, true)) {
            $allowed = OrganizationApplicantGrant::query()->where('college_id', $collegeId)->usable()->count();
            $rows[] = $allowed > 0
                ? $row('grants', $this->plural($allowed, 'student').' '.$this->be($allowed).' allowed to apply and '.($allowed === 1 ? 'has' : 'have').' not applied yet', 'You can take a permission back from the same list before the student applies.', 'Ready', 'success')
                : $row('grants', 'No student is allowed to apply yet', 'Choose one with Allow a student to apply.', 'Action needed', 'warning');
        }

        if (in_array('applications_waiting', $checks, true) && ($role === 'SUPER_ADMIN' || ($role === 'DEPARTMENT_HEAD' && $collegeId !== null))) {
            $query = OrganizationApplication::query()->where('status', $role === 'SUPER_ADMIN' ? 'pending_sao' : 'pending_dean');
            if ($role === 'DEPARTMENT_HEAD') {
                $query->where('college_id', $collegeId);
            }
            $waiting = $query->count();
            $rows[] = $waiting > 0
                ? $row('applications', $this->plural($waiting, 'application').' '.$this->be($waiting).' waiting for your decision', null, 'Waiting', 'warning', $this->linkTo($user, '/dashboard/organization-applications'), 'Open applications')
                : $row('applications', 'No application is waiting for your decision', null, 'Clear', 'success');
        }

        if ($role === 'STUDENT' && in_array('own_application', $checks, true)) {
            $application = OrganizationApplication::query()
                ->where('school_id', $user->school_id)
                ->whereNotIn('status', OrganizationApplication::LEGACY_UNQUEUED)
                ->latest('id')->first();

            if ($application !== null) {
                [$primary, $secondary, $tone] = match ($application->status) {
                    'pending_dean' => ['Your application is with your Department Head', 'The Department Head endorses it to the SAO or returns it to you.', 'info'],
                    'pending_sao' => ['Your application is with the SAO', 'The SAO makes the final decision.', 'info'],
                    'returned' => ['Your application was returned to you', 'Read the notes and send it again from the same page.', 'warning'],
                    'approved' => ['Your application was approved', 'You are now the Admin of the organization.', 'success'],
                    default => ['Your application was not approved', null, 'warning'],
                };
                $rows[] = $row('application', $primary, $secondary, 'Your application', $tone);
            } elseif (OrganizationApplicantGrant::query()->usable()->where('user_school_id', $user->school_id)->exists()) {
                $rows[] = $row('application', 'Your Department Head has allowed you to apply', 'The Apply for an organization page is in your menu.', 'Ready', 'success');
            } else {
                $rows[] = $row('application', 'Your Department Head has not allowed you to apply yet', 'The Apply for an organization page opens in your menu once you are allowed.', 'Not yet', 'warning');
            }
        }

        return $rows;
    }

    /** @return array<int, string> */
    private function capabilityGuideLines(string $role): array
    {
        $byCategory = [];
        foreach ($this->guides->forRole($role) as $guide) {
            if ($guide['category'] !== 'Getting around') {
                $byCategory[$guide['category']][] = $this->howToAction($guide, true);
            }
        }

        $lines = [];
        foreach ($byCategory as $category => $actions) {
            $lines[] = '- **'.$category.'**: '.implode('; ', array_slice($actions, 0, 3)).(count($actions) > 3 ? '; and more' : '');
        }

        return $lines;
    }

    private function moduleAllowed(User $user, string $module): bool
    {
        if ($user->role !== 'SBO_OFFICER') {
            return true;
        }

        return $user->activeProfile()?->allowsModule($module) ?? true;
    }

    private function intentAllowed(User $user, string $intent): bool
    {
        if (in_array($intent, AskAiRoleIntents::INTENTS, true)) {
            return $this->roleIntents->allowed($user, $intent);
        }

        if ($user->role === 'STUDENT' && ! in_array($intent, self::STUDENT_INTENTS, true)) {
            return false;
        }

        $module = self::INTENT_MODULES[$intent] ?? null;

        return $module === null || $this->moduleAllowed($user, $module);
    }

    private function refusal(User $user, string $intent): array
    {
        $payload = [
            'title' => 'Not available for your access',
            'highlights' => [],
            'sections' => [],
            'follow_ups' => [],
            'model_name' => null,
        ];

        if ($user->role === 'STUDENT') {
            [$thing, $pointer, $topic] = self::STUDENT_REDIRECTS[$intent] ?? ['that part of the organization, which is for officers and the SAO', 'I can show your clearance, your fees and your orders instead.', 'clearances_status'];
            $payload['answer'] = "A student account does not have access to {$thing}. {$pointer}";
            $payload['follow_ups'] = array_values(array_map(
                fn (array $q) => ['topic' => $q['topic'], 'label' => $q['label'], 'question' => $q['question']],
                array_filter($this->suggestedQuestions('STUDENT'), fn (array $q) => in_array($q['topic'], [$topic, 'daily_priorities'], true))
            ));

            return $payload;
        }

        $payload['answer'] = in_array($intent, AskAiRoleIntents::INTENTS, true) || ! isset(self::INTENT_MODULES[$intent])
            ? 'Your role does not have access to that part of Ask AI, so I cannot answer it.'
            : 'Your account does not have access to this part of the organization, so Ask AI cannot answer that. Ask your organization head to add it to your access.';

        return $payload;
    }

    private function answerHowTo(User $user, string $question): array
    {
        $role = $user->role;
        $request = $this->isActionRequest($this->plainQuestion($question));
        $result = $this->guides->search($question, $role, $request);
        $guide = $result['best'];

        if ($guide === null) {
            $payload = $this->buildHowToCatalog($user, $question, $request);
        } elseif (! $result['accessible']) {
            // Steps written for another role name menus and pages this role does not have, so it gets the one sentence
            // and the closest page it can open instead.
            $payload = $this->buildHowToWhoCan($user, $guide, $result['related']);
        } elseif ($request) {
            $payload = $this->buildHowToRequest($user, $guide, (bool) $result['accessible'], $result['related']);
        } else {
            $payload = $this->buildHowToGuide($user, $guide, (bool) $result['accessible'], $result['related']);
        }

        $payload['model_name'] = null;
        $payload['rag_metadata'] = [
            'engine' => 'HIUSA guides',
            'corpus_size' => $result['total'],
            'retrieved_count' => $guide === null ? 0 : 1 + count($result['related']),
            'domains_searched' => $result['categories'],
            'matched_concepts' => $guide !== null ? [$guide['category']] : ['How-to guidance'],
            'matched_entities' => $guide !== null ? [$guide['title']] : [],
            'top_confidence' => $result['top_confidence'],
        ];

        $payload = $this->enrichWithFormattedBlocksAndCharts($payload, 'how_to_guide');
        // Step lists read better without generic metric charts.
        $payload['charts'] = [];

        return $payload;
    }

    private function buildHowToGuide(User $user, array $guide, bool $accessible, array $related): array
    {
        $role = $user->role;
        $blocked = $accessible && $this->applyingBlocked($user, $guide);
        $steps = array_values($guide['steps']);
        $stepCount = count($steps);
        $allowedRoles = array_map(
            fn (string $r) => HowToGuideLibrary::ROLE_NAMES[$r] ?? $r,
            $guide['roles']
        );

        $stepRows = [];
        $paths = [];
        $previousPath = null;
        foreach ($steps as $index => $step) {
            $href = $accessible ? $this->linkTo($user, ...$this->guides->stepPaths($step, $role)) : null;
            $path = $href !== null ? strtok($href, '?') : null;
            if ($path !== null) {
                $paths[$path] = true;
            }
            // Only the first step of a run on the same page offers "Go to page"; the steps after it are done there.
            if ($path !== null && $path === $previousPath) {
                $href = null;
            }
            $previousPath = $path;
            $stepRows[] = [
                'id' => $guide['id'].'-step-'.($index + 1),
                'step' => $index + 1,
                'primary' => $step['title'],
                'secondary' => $step['detail'],
                'status' => 'Step '.($index + 1),
                'status_tone' => 'primary',
                'meta' => $step['where'] ?? null,
                'href' => $href,
                'action_label' => 'Go to page',
            ];
        }

        $sections = [];

        $readinessRows = $accessible ? $this->howToReadinessRows($user, $guide) : [];
        if ($readinessRows !== []) {
            $sections[] = [
                'id' => 'how-to-readiness',
                'title' => 'Before you start',
                'description' => 'This comes from your records as they are today.',
                'empty_message' => 'Everything you need is ready.',
                'rows' => $readinessRows,
            ];
        }

        $sections[] = [
            'id' => 'how-to-steps',
            'layout' => 'steps',
            'title' => 'The steps: '.$guide['title'],
            'description' => $accessible
                ? $this->plural($stepCount, 'step').', about '.$this->plural((int) $guide['minutes'], 'minute')
                : 'Shown so you know what they do. Your role cannot open these pages.',
            'empty_message' => 'There are no steps yet.',
            'rows' => $stepRows,
        ];

        if (! empty($guide['tips'])) {
            $sections[] = [
                'id' => 'how-to-tips',
                'title' => 'Good to know',
                'description' => null,
                'empty_message' => '',
                'rows' => array_map(fn (string $tip, int $i) => [
                    'id' => $guide['id'].'-tip-'.$i,
                    'primary' => $tip,
                    'secondary' => null,
                    'status' => 'Tip',
                    'status_tone' => 'info',
                    'meta' => null,
                    'href' => null,
                ], array_values($guide['tips']), array_keys(array_values($guide['tips']))),
            ];
        }

        if ($accessible) {
            $firstStep = $steps[0] ?? null;
            $answer = sprintf(
                '%s There %s %s%s.',
                $guide['summary'],
                $this->be($stepCount),
                $this->plural($stepCount, 'step'),
                $paths !== [] ? ', and each Go to page button opens the page for that step' : ''
            );
            if ($firstStep !== null) {
                $answer .= ' Start here: '.rtrim($firstStep['detail'], '.').'.';
            }
            if ($blocked) {
                $answer = 'You cannot apply yet: your Department Head has not allowed you to apply. '.$answer;
            }
        } else {
            $answer = sprintf(
                'The %s role cannot do "%s". That is done by %s. Here are the steps so you know what they do. %s',
                HowToGuideLibrary::ROLE_NAMES[$role] ?? $role,
                Str::lower($guide['title']),
                $this->joinPhrases($allowedRoles),
                $guide['summary']
            );
        }

        $followUps = array_map(fn (array $g) => [
            'topic' => 'how_to_guide',
            'label' => $g['title'],
            'question' => $g['question'],
        ], $related);

        if (count($followUps) < 3) {
            $followUps[] = [
                'topic' => 'daily_priorities',
                'label' => 'What should I do today?',
                'question' => $this->defaultDailyQuestion($role),
            ];
        }

        return [
            'title' => 'How to: '.$guide['title'],
            'answer' => $answer,
            'highlights' => [
                ['label' => 'Steps', 'value' => (string) $stepCount, 'tone' => 'primary'],
                ['label' => 'Pages involved', 'value' => (string) count($paths), 'tone' => 'info'],
                ['label' => 'Estimated time', 'value' => $this->plural((int) $guide['minutes'], 'minute'), 'tone' => 'success'],
                ['label' => 'Your access', 'value' => $blocked ? 'Not yet' : ($accessible ? 'Allowed' : 'Other role'), 'tone' => $accessible && ! $blocked ? 'success' : 'warning'],
            ],
            'sections' => $sections,
            'follow_ups' => array_slice($followUps, 0, 3),
        ];
    }

    private function howToReadinessRows(User $user, array $guide): array
    {
        $rows = [];
        $checks = $guide['checks'] ?? [];

        if (in_array('active_semester', $checks, true)) {
            $active = AcademicSemester::query()
                ->with('academicYear')
                ->where('status', 'active')
                ->first();

            if ($active !== null) {
                $label = trim(($active->academicYear?->label ? 'AY '.$active->academicYear->label.' · ' : '').$this->semesterLabel((int) $active->number));
                $rows[] = [
                    'id' => 'ready-semester',
                    'primary' => 'An active semester is open',
                    'secondary' => $label,
                    'status' => 'Ready',
                    'status_tone' => 'success',
                    'meta' => null,
                    'href' => null,
                ];
            } else {
                $rows[] = [
                    'id' => 'ready-semester',
                    'primary' => 'No semester is active yet',
                    'secondary' => $user->role === 'SUPER_ADMIN'
                        ? 'Activate a semester under Setup and records → Academic years first.'
                        : 'Ask the SAO to activate the current semester first.',
                    'status' => 'Action needed',
                    'status_tone' => 'warning',
                    'meta' => null,
                    'href' => $this->linkTo($user, '/dashboard/super-admin/academic-years'),
                    'action_label' => 'Open academic years',
                ];
            }
        }

        return [...$rows, ...$this->howToRecordRows($user, $checks)];
    }

    private function semesterLabel(int $number): string
    {
        return match ($number) {
            1 => '1st Semester',
            2 => '2nd Semester',
            3 => 'Summer',
            default => 'Semester '.$number,
        };
    }

    private function buildHowToCatalog(User $user, string $question, bool $request = false): array
    {
        $role = $user->role;
        $guides = $this->guides->forRole($role);

        $rows = array_map(function (array $g) use ($user, $role) {
            $firstPath = null;
            foreach ($g['steps'] as $step) {
                $firstPath = $this->linkTo($user, ...$this->guides->stepPaths($step, $role));
                if ($firstPath !== null) {
                    break;
                }
            }

            return [
                'id' => 'guide-'.$g['id'],
                'primary' => $g['title'],
                'secondary' => $g['summary'],
                'status' => $g['category'],
                'status_tone' => 'info',
                'meta' => $this->plural(count($g['steps']), 'step'),
                'href' => $firstPath,
                'action_label' => 'Open page',
                'ask_question' => $g['question'],
            ];
        }, $guides);

        return [
            'title' => 'How-to guides for your role',
            'answer' => $request
                ? sprintf(
                    'I could not tell which task you mean by "%s". As %s you can start %s from here, so say which one you want, for example "%s".',
                    Str::limit($question, 80),
                    $this->roleName($role),
                    $this->plural(count($guides), 'task'),
                    self::REQUEST_EXAMPLES[$role] ?? 'I want to create an event'
                )
                : sprintf(
                    'I could not match "%s" to one procedure. I can walk you through %s for %s, so ask about any of them, for example "%s".',
                    Str::limit($question, 80),
                    $this->plural(count($guides), 'guide'),
                    HowToGuideLibrary::ROLE_NAMES[$role] ?? $role,
                    $guides[0]['question'] ?? 'How do I use Ask AI?'
                ),
            'highlights' => [
                ['label' => 'Guides available', 'value' => (string) count($guides), 'tone' => 'primary'],
                ['label' => 'Categories', 'value' => (string) count(array_unique(array_column($guides, 'category'))), 'tone' => 'info'],
            ],
            'sections' => [[
                'id' => 'how-to-catalog',
                'title' => 'What I can walk you through',
                'description' => 'Ask "How do I ..." about any of these, in your own words.',
                'empty_message' => 'There are no guides for this role yet.',
                'rows' => $rows,
            ]],
            'follow_ups' => array_map(fn (array $g) => [
                'topic' => 'how_to_guide',
                'label' => $g['title'],
                'question' => $g['question'],
            ], array_slice($guides, 0, 3)),
        ];
    }

    // -------------------------------------------------------------------------
    // Intent 1: Daily Priorities ("What should I do today?")
    // -------------------------------------------------------------------------

    /**
     * A question that fell through every intent asks for records only when it uses one of the search words (officers,
     * stock, a search) or names a person, an organization, an event or another record. Anything else has no answer here.
     *
     * @param  array<string, mixed>  $rag
     */
    private function asksForRecords(string $question, array $rag): bool
    {
        if (($rag['chunks'] ?? []) === []) {
            return false;
        }

        if (preg_match(self::INTENT_PATTERNS['semantic_rag'], $this->plainQuestion($question)) === 1 || ($rag['matched_entities'] ?? []) !== []) {
            return true;
        }

        foreach ($rag['chunks'] as $chunk) {
            if (! empty($chunk['names_entity'])) {
                return true;
            }
        }

        // A single distinctive word of the question that is also a word of a record's name ("lanyard", "Angela") is a lookup.
        $distinctive = array_diff($this->questionWords($question), self::GENERIC_WORDS);
        foreach ($distinctive === [] ? [] : $rag['chunks'] as $chunk) {
            $name = $this->questionWords($chunk['primary'].' '.implode(' ', array_map('strval', (array) ($chunk['entity_terms'] ?? []))));
            if (array_intersect($distinctive, $name) !== []) {
                return true;
            }
        }

        return false;
    }

    // Words every kind of record shares, so meeting one of them in a record's name says nothing about what was asked.
    private const GENERIC_WORDS = ['student', 'organization', 'organisation', 'org', 'college', 'officer', 'member', 'people', 'president', 'vice', 'secretary', 'treasurer', 'auditor', 'adviser', 'advisor', 'admin', 'head', 'dean', 'department', 'account', 'user', 'record', 'week', 'month', 'year', 'time', 'full', 'every', 'name', 'active', 'inactive'];

    /**
     * One plain sentence that there is no answer, then up to three things this role can ask that are nearest to the words
     * used, and the page where the thing lives when exactly one page clearly fits. No record is listed as if it answered.
     */
    private function buildNoAnswer(User $user, string $question): array
    {
        $role = $user->role;
        $words = $this->questionWords($question);

        $candidates = array_values(array_filter($this->suggestedQuestions($role), fn (array $q) => $this->intentAllowed($user, $q['topic'])));
        $listed = array_column($candidates, 'topic');
        foreach (self::ROLE_INTENT_CAPABILITIES as $intent => [$label, $description]) {
            if (! in_array($intent, $listed, true) && $this->roleIntents->allowed($user, $intent)) {
                $candidates[] = ['id' => $intent, 'topic' => $intent, 'label' => $label, 'question' => self::ROLE_INTENT_QUESTIONS[$intent], 'description' => $description];
            }
        }

        $scored = [];
        foreach ($candidates as $position => $candidate) {
            $labelWords = $this->questionWords($candidate['label'].' '.$candidate['question']);
            $score = 2 * count(array_intersect($words, $labelWords)) + count(array_intersect($words, $this->questionWords($candidate['description'])));
            $scored[] = ['candidate' => $candidate, 'score' => $score, 'position' => $position];
        }
        usort($scored, fn (array $a, array $b) => [$b['score'], $a['position']] <=> [$a['score'], $b['position']]);
        $near = array_filter($scored, fn (array $s) => $s['score'] > 0);
        // No shared word at all: the first things the role is shown on its starter list.
        $offers = array_slice(array_column($near !== [] ? $near : $this->byPosition($scored), 'candidate'), 0, 3);

        $sections = [];
        $page = $this->pageThatFits($user, $question);
        if ($page !== null) {
            $sections[] = [
                'id' => 'no-answer-page',
                'title' => 'Where to look',
                'description' => 'The page that fits the words you used.',
                'empty_message' => '',
                'rows' => [[
                    'id' => 'no-answer-page-link',
                    'primary' => $page['label'],
                    'secondary' => 'This is the closest page to what you asked about.',
                    'status' => 'Closest page',
                    'status_tone' => 'info',
                    'meta' => null,
                    'href' => $page['href'],
                    'action_label' => $page['label'],
                ]],
            ];
        }
        $sections[] = [
            'id' => 'no-answer-offers',
            'title' => 'What I can answer',
            'description' => 'The closest things to your words. Ask any of them.',
            'empty_message' => 'Nothing to offer yet.',
            'rows' => array_map(fn (array $offer, int $index) => [
                'id' => 'offer-'.($index + 1),
                'primary' => $offer['label'],
                'secondary' => $offer['description'],
                'status' => 'You can ask',
                'status_tone' => 'info',
                'meta' => null,
                'href' => null,
                'ask_question' => $offer['question'],
            ], $offers, array_keys($offers)),
        ];

        return [
            'title' => 'I do not have an answer for that',
            'answer' => 'I do not have an answer for that, but these are the closest things I can answer for you.',
            'highlights' => [],
            'sections' => $sections,
            'follow_ups' => array_map(fn (array $offer) => ['topic' => $offer['topic'], 'label' => $offer['label'], 'question' => $offer['question']], $offers),
            'no_answer' => true,
            'sources' => self::NO_ANSWER_SOURCES,
        ];
    }

    /** @return array<int, array{candidate: array, score: int, position: int}> */
    private function byPosition(array $scored): array
    {
        usort($scored, fn (array $a, array $b) => $a['position'] <=> $b['position']);

        return $scored;
    }

    /** The meaningful words of a question: lowercase, no filler, a trailing s dropped so "budgets" meets "budget". */
    private function questionWords(string $text): array
    {
        $stop = ['the', 'and', 'for', 'you', 'your', 'our', 'are', 'was', 'were', 'have', 'has', 'had', 'can', 'could', 'would', 'should', 'what', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how', 'does', 'did', 'this', 'that', 'with', 'there', 'their', 'them', 'they', 'any', 'all', 'about', 'from', 'into', 'out', 'not', 'yet', 'still', 'give', 'show', 'tell', 'list', 'get', 'got', 'see', 'now', 'today', 'will', 'its', 'but', 'than', 'then', 'too', 'very', 'just', 'some', 'more', 'most', 'over', 'ask', 'need', 'want', 'like'];
        $words = preg_split('/[^a-z0-9]+/', Str::lower(str_replace(['’', '‘'], "'", $text)), -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $kept = [];
        foreach ($words as $word) {
            $word = strlen($word) > 3 && str_ends_with($word, 's') ? substr($word, 0, -1) : $word;
            if (strlen($word) >= 3 && ! in_array($word, $stop, true)) {
                $kept[$word] = $word;
            }
        }

        return array_values($kept);
    }

    /** @return null|array{href: string, label: string} the page for the one kind of question these words fit, if this role can open it */
    private function pageThatFits(User $user, string $question): ?array
    {
        $q = $this->plainQuestion($question);
        $fits = array_filter(self::PAGE_HINTS, fn (array $hint) => preg_match($hint[0], $q) === 1);
        if (count($fits) !== 1) {
            return null;
        }

        [$path, $label] = reset($fits)[1][$user->role] ?? [null, null];
        $href = $path === null ? null : $this->linkTo($user, $path);

        return $href === null ? null : ['href' => $href, 'label' => $label];
    }

    /** Where the facts in an answer came from, in plain words a person can check. */
    public function sourcesFor(User $user, string $intent, array $payload = []): string
    {
        if (in_array($intent, ['greeting', 'capabilities', 'memory', 'identity'], true)) {
            return self::NO_RECORD_SOURCES;
        }
        if (! empty($payload['no_answer'])) {
            return self::NO_ANSWER_SOURCES;
        }
        if ($intent === 'how_to_guide') {
            return 'From the HIUSA how-to guides for your role.';
        }
        if ($intent === 'glossary') {
            return 'From the HIUSA glossary.';
        }
        if ($intent === 'fee_usage') {
            return 'From the financial reports the SAO has approved for your organization, read just now';
        }
        if ($intent === 'ai_tools') {
            return 'From the HIUSA descriptions of the AI tools open to your role.';
        }
        if ($intent === 'semantic_rag') {
            $titles = array_values(array_unique(array_filter(array_column($payload['sections'] ?? [], 'title'))));

            return $titles === []
                ? 'From the records your account can open, read just now'
                : 'From the records that matched your question ('.implode(', ', array_slice($titles, 0, 4)).'), read just now';
        }

        $student = $user->role === 'STUDENT';
        $owner = $student || ($user->role === 'SBO_OFFICER' && $intent === 'tasks_workload') ? 'your own' : $this->ownerPhrase($user);
        $what = match ($intent) {
            'daily_priorities' => $student ? 'fees, orders, ballots and clearance' : 'tasks, requests and deadlines',
            'missing_submissions' => 'compliance requirements and submitted files',
            'submitted_documents' => 'submitted compliance files and reports',
            'pending_approvals' => 'approval requests',
            'organizations_without_admin' => 'registrations and organization heads',
            'tasks_workload' => 'tasks',
            'finance_health' => $student ? 'invoices and payments' : 'budgets and transactions',
            'report_preparation' => 'budgets, transactions and financial report checks',
            'own_balance' => 'invoices and payments',
            'merchandise_orders' => $student ? 'orders' : 'merchandise orders',
            'merchandise_stock' => 'merchandise stock and orders',
            'events_attendance' => 'events and attendance',
            'event_readiness' => 'events, venue bookings, budgets, required files and tasks',
            'clearances_status' => 'clearance signatures',
            'elections_status' => 'elections and votes',
            'grievances_status' => 'grievances',
            'applications_queue' => 'organization applications',
            'my_submissions' => 'event, budget and report submissions',
            'unclaimed_students' => 'school records and accounts',
            'my_attendance' => 'attendance records',
            'claim_token' => 'merchandise orders',
            default => 'records',
        };
        if (in_array($intent, ['own_balance', 'my_attendance', 'claim_token'], true)) {
            $owner = 'your own';
        }
        if ($intent === 'unclaimed_students') {
            $owner = $user->role === 'SUPER_ADMIN' ? 'the university\'s' : 'your college\'s';
        }

        return 'From '.$owner.' '.$what.', read just now';
    }

    private function plural(int $count, string $singular, ?string $plural = null): string
    {
        return $count.' '.($count === 1 ? $singular : ($plural ?? $singular.'s'));
    }

    private function be(int $count): string
    {
        return $count === 1 ? 'is' : 'are';
    }

    /** @param array<int, string> $parts */
    private function joinPhrases(array $parts): string
    {
        $parts = array_values($parts);
        $last = array_pop($parts);

        return $parts === [] ? (string) $last : implode(', ', $parts).' and '.$last;
    }

    /** Orders whose payment can be checked now: a GCash order still needs its proof first, a cash order does not. */
    private function ordersReadyForReview(Builder $orders): Builder
    {
        return $orders->where('orders.status', 'pending')->where('orders.officer_review_status', 'pending')
            ->where(fn ($ready) => $ready->whereNotNull('orders.payment_proof_url')
                ->orWhereNull('orders.payment_method')->orWhere('orders.payment_method', '!=', 'gcash'));
    }

    /** An empty applications queue still names the approval requests that wait, so the two answers never contradict each other. */
    private function withWaitingRequests(User $user, Collection $organizationIds, array $payload): array
    {
        if (($payload['highlights'][0]['value'] ?? null) !== '0') {
            return $payload;
        }

        $waiting = $this->awaitingApprovalsQuery($user, $organizationIds)->count();
        if ($waiting > 0) {
            $payload['answer'] .= sprintf(' Separately, %s %s waiting for your decision. Ask "What is waiting for my approval?" to see %s.', $this->plural($waiting, 'approval request'), $this->be($waiting), $waiting === 1 ? 'it' : 'them');
        }

        return $payload;
    }

    private function openGrievancesQuery(): Builder
    {
        return DB::table('grievances')
            ->whereNull('deleted_at')
            ->whereNotIn('status', ['resolved', 'dismissed']);
    }

    private function inSelectedSemester(Builder $query, string $column): Builder
    {
        return $query->when(AcademicSemester::selected()?->id, fn ($rows, $semesterId) => $rows->where($column, $semesterId));
    }

    /** The approval requests that wait for this person's own decision, the list the approvals answer reads. */
    private function awaitingApprovalsQuery(User $user, Collection $organizationIds): EloquentBuilder
    {
        $approvals = ApprovalRequest::where('status', 'pending')
            ->where('required_role', $user->approvalRole())
            ->where(fn ($assigned) => $assigned->whereNull('assigned_approver')->orWhere('assigned_approver', $user->school_id));

        if ($user->role === 'SUPER_ADMIN') {
            $saoEntityTypes = ['financial_report', 'event', ...(config('approvals.budget_final') === 'SUPER_ADMIN' ? ['budget'] : [])];

            return $approvals->where(fn ($allowed) => $allowed->whereIn('entity_type', $saoEntityTypes)
                ->orWhere(fn ($unified) => $unified->whereIn('entity_type', ['budget', 'election'])
                    ->whereIn('organization_id', Organization::student()->where('is_university_wide', true)->select('id'))));
        }

        return $approvals->whereIn('organization_id', $organizationIds->all());
    }

    /**
     * @param  Collection<int, int>  $organizationIds
     * @return Collection<int, int>
     */
    private function activeOrganizationIds(Collection $organizationIds): Collection
    {
        return DB::table('organizations')
            ->whereIn('id', $organizationIds)
            ->where('lifecycle_status', 'active')
            ->pluck('id');
    }

    /**
     * The open ballots this student has not voted in yet, soonest to close first: every organization the active
     * profile votes in, the runoff as well as the first round, and only inside the voting window.
     *
     * @return Collection<int, array{election: Election, round: int, closes: Carbon}>
     */
    private function unvotedElections(User $user): Collection
    {
        return Election::whereIn('organization_id', $user->votingOrganizationIds())
            ->where(fn ($query) => $query->where('status', 'active')->orWhere('phase', 'runoff'))
            ->get()
            ->map(function (Election $election) {
                $round = $election->openRound();

                return $round === null ? null : [
                    'election' => $election,
                    'round' => $round,
                    'closes' => $round === 2 ? $election->runoff_ends_at : $election->end_time,
                ];
            })
            ->filter(fn (?array $open) => $open !== null
                && $open['election']->listsVoter($user->school_id)
                && ! ElectionBallot::hasVoted($open['election']->id, $user->school_id, $open['round']))
            ->sortBy(fn (array $open) => $open['closes']->getTimestamp())
            ->values();
    }

    private function buildDailyPriorities(User $user, Collection $organizationIds): array
    {
        $role = $user->role;

        if ($role === 'SUPER_ADMIN') {
            $pendingRegistrations = DB::table('organizations')
                ->where('organization_type', 'STUDENT_ORGANIZATION')
                ->where('lifecycle_status', 'pending')
                ->count();
            $pendingCompliance = DB::table('organization_compliance_submissions')
                ->whereIn('organization_id', $organizationIds)
                ->where('status', 'submitted')
                ->count();
            $approvalCounts = $this->awaitingApprovalsQuery($user, $organizationIds)
                ->selectRaw('entity_type, COUNT(*) as total')
                ->groupBy('entity_type')
                ->pluck('total', 'entity_type');
            $pendingEventApprovals = (int) ($approvalCounts['event'] ?? 0);
            $pendingReportApprovals = (int) ($approvalCounts['financial_report'] ?? 0);
            $pendingApprovals = (int) $approvalCounts->sum();
            $pendingOtherApprovals = $pendingApprovals - $pendingEventApprovals - $pendingReportApprovals;
            $pendingVenues = DB::table('venue_bookings')->where('status', 'pending')->count();
            $urgentGrievances = $this->openGrievancesQuery()
                ->whereRaw('LOWER(urgency) in (?, ?)', ['high', 'critical'])
                ->count();
            $pendingClearances = DB::table('clearance_signatures')
                ->whereNull('retired_at')
                ->where('required_role', 'sao')
                ->where('status', 'pending')
                ->count();

            $accreditation = $this->accreditation->forOrganizations($this->activeOrganizationIds($organizationIds));
            $incompleteOrgs = collect($accreditation)->filter(fn (string $status) => in_array($status, ['incomplete', 'returned'], true))->count();
            $incompleteHave = $incompleteOrgs === 1 ? 'has' : 'have';

            $queueRows = [];
            if ($urgentGrievances > 0) {
                $queueRows[] = [
                    'id' => 'prio-grievances',
                    'primary' => 'Read the urgent student grievances',
                    'secondary' => ucfirst($this->plural($urgentGrievances, 'grievance')).' '.$this->be($urgentGrievances).' open and marked high or critical.',
                    'status' => 'High priority',
                    'status_tone' => 'danger',
                    'meta' => "{$urgentGrievances} open",
                    'href' => $this->linkTo($user, '/dashboard/super-admin/grievances'),
                    'action_label' => 'Open grievances',
                ];
            }
            if ($pendingRegistrations > 0) {
                $queueRows[] = [
                    'id' => 'prio-registrations',
                    'primary' => 'Decide on new organization registrations',
                    'secondary' => ucfirst($this->plural($pendingRegistrations, 'organization registration')).' '.$this->be($pendingRegistrations).' waiting for your decision.',
                    'status' => 'Waiting for SAO',
                    'status_tone' => 'warning',
                    'meta' => "{$pendingRegistrations} pending",
                    'href' => $this->linkTo($user, '/dashboard/super-admin/organizations?status=pending'),
                    'action_label' => 'Review registrations',
                ];
            }
            if ($pendingCompliance > 0) {
                $queueRows[] = [
                    'id' => 'prio-compliance',
                    'primary' => 'Review the compliance files organizations sent',
                    'secondary' => ucfirst($this->plural($pendingCompliance, 'file')).' '.$this->be($pendingCompliance).' waiting for you to review.',
                    'status' => 'Waiting for SAO',
                    'status_tone' => 'warning',
                    'meta' => "{$pendingCompliance} submitted",
                    'href' => $this->linkTo($user, '/dashboard/super-admin/compliance?tab=review'),
                    'action_label' => 'Review compliance',
                ];
            }
            if ($pendingEventApprovals > 0) {
                $queueRows[] = [
                    'id' => 'prio-event-approvals',
                    'primary' => 'Decide on event proposals',
                    'secondary' => ucfirst($this->plural($pendingEventApprovals, 'event proposal')).' '.$this->be($pendingEventApprovals).' waiting for your final decision.',
                    'status' => 'Waiting for SAO',
                    'status_tone' => 'warning',
                    'meta' => "{$pendingEventApprovals} queued",
                    'href' => $this->linkTo($user, '/dashboard/super-admin/compliance?tab=event-reviews'),
                    'action_label' => 'Open event reviews',
                ];
            }
            if ($pendingReportApprovals > 0) {
                $queueRows[] = [
                    'id' => 'prio-report-approvals',
                    'primary' => 'Review financial reports',
                    'secondary' => ucfirst($this->plural($pendingReportApprovals, 'financial report')).' '.$this->be($pendingReportApprovals).' waiting for your final decision.',
                    'status' => 'Waiting for SAO',
                    'status_tone' => 'warning',
                    'meta' => "{$pendingReportApprovals} queued",
                    'href' => $this->linkTo($user, '/dashboard/super-admin/compliance?tab=financial'),
                    'action_label' => 'Open financial reports',
                ];
            }
            if ($pendingOtherApprovals > 0) {
                $queueRows[] = [
                    'id' => 'prio-other-approvals',
                    'primary' => 'Decide on budget and election requests',
                    'secondary' => ucfirst($this->plural($pendingOtherApprovals, 'request')).' '.$this->be($pendingOtherApprovals).' waiting for your final decision.',
                    'status' => 'Waiting for SAO',
                    'status_tone' => 'warning',
                    'meta' => "{$pendingOtherApprovals} queued",
                    'href' => $this->linkTo($user, '/dashboard/super-admin/organization-approvals'),
                    'action_label' => 'Open approvals',
                ];
            }
            if ($pendingVenues > 0) {
                $queueRows[] = [
                    'id' => 'prio-venues',
                    'primary' => 'Confirm venue bookings',
                    'secondary' => ucfirst($this->plural($pendingVenues, 'venue booking')).' '.$this->be($pendingVenues).' waiting for you to confirm.',
                    'status' => 'Waiting for SAO',
                    'status_tone' => 'info',
                    'meta' => "{$pendingVenues} pending",
                    'href' => $this->linkTo($user, '/dashboard/super-admin/venues'),
                    'action_label' => 'Open venues',
                ];
            }
            if ($pendingClearances > 0) {
                $queueRows[] = [
                    'id' => 'prio-clearances',
                    'primary' => 'Sign student clearances',
                    'secondary' => ucfirst($this->plural($pendingClearances, 'student clearance')).' '.$this->be($pendingClearances).' waiting for the SAO signature.',
                    'status' => 'Waiting for SAO',
                    'status_tone' => 'info',
                    'meta' => $this->plural($pendingClearances, 'student'),
                    'href' => $this->linkTo($user, '/dashboard/super-admin/clearances'),
                    'action_label' => 'Open clearances',
                ];
            }
            if ($incompleteOrgs > 0) {
                $queueRows[] = [
                    'id' => 'prio-incomplete-orgs',
                    'primary' => 'Follow up on organizations with missing requirements',
                    'secondary' => ucfirst($this->plural($incompleteOrgs, 'active student organization')).' still '.$incompleteHave.' incomplete or returned compliance requirements.',
                    'status' => 'Follow up',
                    'status_tone' => 'neutral',
                    'meta' => $this->plural($incompleteOrgs, 'organization'),
                    'href' => $this->linkTo($user, '/dashboard/super-admin/compliance'),
                    'action_label' => 'View compliance',
                ];
            }

            $totalActionItems = $urgentGrievances + $pendingRegistrations + $pendingCompliance + $pendingApprovals + $pendingVenues + $pendingClearances;
            $waiting = array_values(array_filter([
                $pendingRegistrations > 0 ? $this->plural($pendingRegistrations, 'organization registration') : null,
                $pendingCompliance > 0 ? $this->plural($pendingCompliance, 'compliance file') : null,
                $pendingApprovals > 0 ? $this->plural($pendingApprovals, 'final approval request') : null,
                $pendingVenues > 0 ? $this->plural($pendingVenues, 'venue booking') : null,
                $pendingClearances > 0 ? $this->plural($pendingClearances, 'clearance signature') : null,
                $urgentGrievances > 0 ? $this->plural($urgentGrievances, 'urgent grievance') : null,
            ]));
            $incompleteSentence = $incompleteOrgs > 0
                ? $this->plural($incompleteOrgs, 'active organization').' still '.$incompleteHave.' incomplete or returned compliance requirements.'
                : 'Every active organization is up to date on its requirements.';
            $answer = $totalActionItems > 0
                ? 'Today the SAO has '.$this->plural($totalActionItems, 'item').' to act on: '.$this->joinPhrases($waiting).'. '.$incompleteSentence
                : 'Nothing is waiting for the SAO right now: no registrations, compliance files, approvals, venue bookings, clearance signatures or urgent grievances. '.$incompleteSentence;

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
                        'title' => 'What is waiting for you',
                        'description' => 'The most urgent come first.',
                        'empty_message' => 'Every queue is clear today.',
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
            $activeOrgCount = $this->activeOrganizationIds($organizationIds)->count();
            $pendingApprovals = $this->awaitingApprovalsQuery($user, $organizationIds)
                ->where('entity_type', '!=', 'financial_report')
                ->count();
            $returnedOrgs = DB::table('organizations')
                ->whereIn('id', $this->scopedStudentOrganizationIds($user, false))
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
                    'primary' => 'Review the requests from your college organizations',
                    'secondary' => ucfirst($this->plural($pendingApprovals, 'budget or event request')).' '.$this->be($pendingApprovals).' waiting for your endorsement.',
                    'status' => 'Waiting for the Department Head',
                    'status_tone' => 'warning',
                    'meta' => "{$pendingApprovals} pending",
                    'href' => $this->linkTo($user, '/dashboard/department-head/approvals'),
                    'action_label' => 'Open approvals',
                ];
            }
            if ($pendingReports > 0) {
                $rows[] = [
                    'id' => 'dh-reports',
                    'primary' => 'Endorse submitted financial reports',
                    'secondary' => ucfirst($this->plural($pendingReports, 'financial report')).' from your college organizations '.$this->be($pendingReports).' waiting for your review.',
                    'status' => 'Waiting for the Department Head',
                    'status_tone' => 'warning',
                    'meta' => $this->plural($pendingReports, 'report'),
                    'href' => $this->linkTo($user, '/dashboard/department-head/approvals'),
                    'action_label' => 'Review reports',
                ];
            }
            if ($returnedOrgs > 0) {
                $rows[] = [
                    'id' => 'dh-returned',
                    'primary' => 'Fix returned organization registrations',
                    'secondary' => ucfirst($this->plural($returnedOrgs, 'organization registration')).' '.($returnedOrgs === 1 ? 'was' : 'were').' returned by the SAO with remarks.',
                    'status' => 'Returned',
                    'status_tone' => 'danger',
                    'meta' => "{$returnedOrgs} returned",
                    'href' => $this->linkTo($user, '/dashboard/department-head/organizations'),
                    'action_label' => 'Manage organizations',
                ];
            }
            if ($orgsWithoutAdmin > 0) {
                $rows[] = [
                    'id' => 'dh-no-admin',
                    'primary' => 'Name an organization head for active organizations',
                    'secondary' => ucfirst($this->plural($orgsWithoutAdmin, 'active organization')).' in your college '.($orgsWithoutAdmin === 1 ? 'does' : 'do').' not have an organization head yet. Use Give access on each one.',
                    'status' => 'Needs an organization head',
                    'status_tone' => 'info',
                    'meta' => $this->plural($orgsWithoutAdmin, 'organization'),
                    'href' => $this->linkTo($user, '/dashboard/department-head/organizations'),
                    'action_label' => 'View organizations',
                ];
            }

            $total = $pendingApprovals + $pendingReports + $returnedOrgs + $orgsWithoutAdmin;
            $collegeOrganizations = $this->plural($activeOrgCount, 'active student organization');
            $waiting = array_values(array_filter([
                $pendingApprovals > 0 ? $this->plural($pendingApprovals, 'request').' waiting for your endorsement' : null,
                $pendingReports > 0 ? $this->plural($pendingReports, 'financial report').' waiting for your review' : null,
                $returnedOrgs > 0 ? $this->plural($returnedOrgs, 'returned registration').' to fix' : null,
                $orgsWithoutAdmin > 0 ? $this->plural($orgsWithoutAdmin, 'active organization').' without an organization head' : null,
            ]));
            $answer = $total > 0
                ? "Your college has {$collegeOrganizations}, and today you have ".$this->joinPhrases($waiting).'.'
                : "Nothing is waiting for you today. Your college has {$collegeOrganizations}, and none has a request to endorse, a returned registration or a missing organization head.";

            return [
                'title' => "Today's College Oversight Plan",
                'answer' => $answer,
                'highlights' => [
                    ['label' => 'College organizations', 'value' => (string) $activeOrgCount, 'tone' => 'primary'],
                    ['label' => 'Pending approvals', 'value' => (string) ($pendingApprovals + $pendingReports), 'tone' => ($pendingApprovals + $pendingReports) > 0 ? 'warning' : 'success'],
                    ['label' => 'Returned registrations', 'value' => (string) $returnedOrgs, 'tone' => $returnedOrgs > 0 ? 'danger' : 'neutral'],
                    ['label' => 'Awaiting admin', 'value' => (string) $orgsWithoutAdmin, 'tone' => $orgsWithoutAdmin > 0 ? 'warning' : 'neutral'],
                ],
                'sections' => [
                    [
                        'id' => 'dh-daily-priorities',
                        'title' => 'What is waiting for you',
                        'description' => 'Requests to endorse and organizations that need a hand.',
                        'empty_message' => 'Nothing needs you today.',
                        'rows' => $rows,
                    ],
                ],
                'follow_ups' => [
                    ['topic' => 'pending_approvals', 'label' => 'What needs my approval?', 'question' => 'What requests are waiting for my approval right now?'],
                    ['topic' => 'missing_submissions', 'label' => "Which college orgs haven't submitted?", 'question' => "Which college organizations haven't submitted compliance or financial reports?"],
                    ['topic' => 'submitted_documents', 'label' => 'Who submitted reports or files?', 'question' => 'Who has submitted compliance files or financial reports for my review?'],
                ],
            ];
        }

        if ($role === 'STUDENT') {
            // A member on the college profile owes fees and holds orders in the clubs they belong to as well.
            $memberOrgIds = $user->memberOrganizationIds();
            $balanceRows = collect($memberOrgIds)->map(fn (int $memberOrgId) => $this->balances->rows(collect([$user]), $memberOrgId)->first());
            $owedTotal = (float) $balanceRows->sum('total_debt');
            $invoiceDebt = (float) $balanceRows->sum('invoice_debt');
            $reservedOrderDebt = (float) $balanceRows->sum('reserved_order_debt');
            $unpaidInvoices = (int) $balanceRows->sum('unpaid_invoice_count');
            $reservedOrders = (int) $balanceRows->sum('pending_order_count');

            $clearanceCounts = DB::table('clearance_signatures')
                ->whereNull('retired_at')
                ->where('student_id', $user->school_id)
                ->selectRaw("SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending, SUM(CASE WHEN status = 'held' THEN 1 ELSE 0 END) as held")
                ->first();
            $pendingClearance = (int) ($clearanceCounts->pending ?? 0);
            $heldClearance = (int) ($clearanceCounts->held ?? 0);

            $readyOrders = DB::table('orders')
                ->whereIn('organization_id', $memberOrgIds)
                ->where('student_id', $user->school_id)
                ->where('status', 'paid')
                ->count();

            $openBallots = $this->unvotedElections($user);
            $nextBallot = $openBallots->first();

            $rows = [];
            if ($heldClearance > 0 || $pendingClearance > 0) {
                $clauses = [];
                if ($heldClearance > 0) {
                    $clauses[] = $this->plural($heldClearance, 'signature').' '.$this->be($heldClearance).' held';
                }
                if ($pendingClearance > 0) {
                    $clauses[] = $this->plural($pendingClearance, 'signature').' '.$this->be($pendingClearance).' still pending';
                }
                $rows[] = [
                    'id' => 'stu-clearance',
                    'primary' => $heldClearance > 0 ? 'Clear the holds on your clearance' : 'Follow your pending clearance signatures',
                    'secondary' => ucfirst($this->joinPhrases($clauses)).' on your clearance.',
                    'status' => $heldClearance > 0 ? 'Held' : 'In progress',
                    'status_tone' => $heldClearance > 0 ? 'danger' : 'warning',
                    'meta' => ($heldClearance + $pendingClearance).' remaining',
                    'href' => $this->linkTo($user, '/dashboard/my-clearance'),
                    'action_label' => 'View clearance',
                ];
            }
            if ($unpaidInvoices > 0) {
                $rows[] = [
                    'id' => 'stu-fees',
                    'primary' => 'Pay your open fees',
                    'secondary' => sprintf('You have %s open, with ₱%s still to pay.', $this->plural($unpaidInvoices, 'invoice'), number_format($invoiceDebt, 2)),
                    'status' => 'Unpaid balance',
                    'status_tone' => 'warning',
                    'meta' => '₱'.number_format($invoiceDebt, 2),
                    'href' => $this->linkTo($user, '/dashboard/finance/statement-of-account'),
                    'action_label' => 'Check balance',
                ];
            }
            if ($reservedOrderDebt > 0) {
                $rows[] = [
                    'id' => 'stu-reserved-orders',
                    'primary' => 'Pay for your reserved orders',
                    'secondary' => sprintf('%s %s reserved and not paid yet, ₱%s in all. Pay or upload your proof of payment.', ucfirst($this->plural($reservedOrders, 'merchandise order')), $this->be($reservedOrders), number_format($reservedOrderDebt, 2)),
                    'status' => 'Unpaid balance',
                    'status_tone' => 'warning',
                    'meta' => '₱'.number_format($reservedOrderDebt, 2),
                    'href' => $this->linkTo($user, '/dashboard/merchandise/my-orders'),
                    'action_label' => 'My orders',
                ];
            }
            if ($nextBallot !== null) {
                $nextTitle = $nextBallot['election']->title;
                $closes = $nextBallot['closes']->format('F j, g:i A');
                $rows[] = [
                    'id' => 'stu-vote',
                    'primary' => $openBallots->count() === 1
                        ? ($nextBallot['round'] === 2 ? 'Cast your runoff ballot in ' : 'Cast your ballot in ').$nextTitle
                        : 'Cast your ballots in '.$openBallots->count().' open elections',
                    'secondary' => $openBallots->count() === 1
                        ? "Voting closes {$closes}."
                        : "{$nextTitle} closes first, on {$closes}.",
                    'status' => 'Election open',
                    'status_tone' => 'info',
                    'meta' => 'Vote now',
                    'href' => $this->linkTo($user, '/dashboard/elections/cast-vote'),
                    'action_label' => 'Cast vote',
                ];
            }
            if ($readyOrders > 0) {
                $rows[] = [
                    'id' => 'stu-orders',
                    'primary' => 'Claim your paid merchandise',
                    'secondary' => ucfirst($this->plural($readyOrders, 'order')).' '.$this->be($readyOrders).' verified and ready for pickup.',
                    'status' => 'Ready to claim',
                    'status_tone' => 'success',
                    'meta' => $this->plural($readyOrders, 'order'),
                    'href' => $this->linkTo($user, '/dashboard/merchandise/my-orders'),
                    'action_label' => 'My orders',
                ];
            }

            $answer = $rows !== []
                ? 'Today you have '.$this->joinPhrases(array_values(array_filter([
                    $heldClearance > 0 ? $this->plural($heldClearance, 'held clearance signature') : null,
                    $pendingClearance > 0 ? $this->plural($pendingClearance, 'pending clearance signature') : null,
                    $unpaidInvoices > 0 ? $this->plural($unpaidInvoices, 'unpaid invoice').' (₱'.number_format($invoiceDebt, 2).')' : null,
                    $reservedOrderDebt > 0 ? $this->plural($reservedOrders, 'unpaid reserved order').' (₱'.number_format($reservedOrderDebt, 2).')' : null,
                    $readyOrders > 0 ? $this->plural($readyOrders, 'order').' ready to claim' : null,
                    $nextBallot !== null ? $this->plural($openBallots->count(), 'open ballot').' waiting for your vote' : null,
                ]))).'.'
                : (! $user->inStudentOrganization()
                    ? 'You are not in an organization yet, so there are no organization records for you yet. Join an organization and its fees, orders and ballots show up here.'
                    : 'You are all caught up today. Nothing is held on your clearance, you owe nothing and no ballot is waiting for you.');

            return [
                'title' => "Today's Student Checklist",
                'answer' => $answer,
                'highlights' => [
                    ['label' => 'Account balance', 'value' => '₱'.number_format($owedTotal, 2), 'tone' => $owedTotal > 0 ? 'warning' : 'success'],
                    ['label' => 'Pending clearance', 'value' => (string) ($pendingClearance + $heldClearance), 'tone' => $heldClearance > 0 ? 'danger' : ($pendingClearance > 0 ? 'warning' : 'success')],
                    ['label' => 'Orders to claim', 'value' => (string) $readyOrders, 'tone' => $readyOrders > 0 ? 'primary' : 'neutral'],
                    ['label' => 'Open ballot', 'value' => $nextBallot !== null ? $openBallots->count().' open' : 'None', 'tone' => $nextBallot !== null ? 'warning' : 'neutral'],
                ],
                'sections' => [
                    [
                        'id' => 'student-daily-priorities',
                        'title' => 'What to do today',
                        'description' => 'Your clearance, fees, ballots and orders.',
                        'empty_message' => 'Nothing needs you right now.',
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

        $overdueTasksQuery = $this->inSelectedSemester(DB::table('tasks')->where('organization_id', $orgId)->where('status', 'overdue'), 'academic_semester_id');
        $openTasksQuery = $this->inSelectedSemester(DB::table('tasks')->where('organization_id', $orgId)->whereIn('status', ['pending', 'in_progress']), 'academic_semester_id');
        if ($isOfficer) {
            $overdueTasksQuery->where('assigned_to', $user->school_id);
            $openTasksQuery->where('assigned_to', $user->school_id);
        }
        $overdueTasks = $overdueTasksQuery->count();
        $openTasks = $openTasksQuery->count();

        $pendingApprovals = $role === 'ADMIN'
            ? $this->awaitingApprovalsQuery($user, $organizationIds)->count()
            : 0;

        $ordersToVerify = $this->moduleAllowed($user, 'merchandise')
            ? $this->ordersReadyForReview(DB::table('orders')->where('orders.organization_id', $orgId))->count()
            : 0;

        $missingComplianceCount = $this->moduleAllowed($user, 'compliance')
            ? count($this->missingComplianceRequirementsForOrganization($orgId))
            : 0;
        $staleEvents = $this->moduleAllowed($user, 'events')
            ? $this->inSelectedSemester(DB::table('events')
                ->where('organization_id', $orgId)
                ->whereIn('status', ['approved', 'ongoing'])
                ->where('end_time', '<', now()), 'academic_semester_id')->count()
            : 0;

        $rows = [];
        if ($overdueTasks > 0) {
            $rows[] = [
                'id' => 'org-overdue-tasks',
                'primary' => $isOfficer ? 'Finish your overdue tasks' : 'Follow up on overdue tasks',
                'secondary' => ucfirst($this->plural($overdueTasks, 'task')).' '.$this->be($overdueTasks).' past '.($overdueTasks === 1 ? 'its' : 'their').' deadline and '.($overdueTasks === 1 ? 'needs' : 'need').' an update.',
                'status' => 'Overdue',
                'status_tone' => 'danger',
                'meta' => "{$overdueTasks} overdue",
                'href' => $this->linkTo($user, $isOfficer ? '/dashboard/tasks/assigned-tasks' : '/dashboard/tasks/task-board'),
                'action_label' => 'Open tasks',
            ];
        }
        if ($pendingApprovals > 0) {
            $rows[] = [
                'id' => 'org-approvals',
                'primary' => 'Decide on requests from your officers',
                'secondary' => ucfirst($this->plural($pendingApprovals, 'request')).' '.$this->be($pendingApprovals).' waiting for your approval.',
                'status' => 'Waiting for the organization head',
                'status_tone' => 'warning',
                'meta' => "{$pendingApprovals} pending",
                'href' => $this->linkTo($user, '/dashboard/approvals'),
                'action_label' => 'Review approvals',
            ];
        }
        if ($missingComplianceCount > 0) {
            $notSubmitted = ucfirst($this->plural($missingComplianceCount, 'requirement')).' '.$this->be($missingComplianceCount).' not submitted yet or '.($missingComplianceCount === 1 ? 'was' : 'were').' returned.';
            $rows[] = [
                'id' => 'org-missing-compliance',
                'primary' => $isOfficer ? 'Your organization still owes compliance files' : 'Upload your missing compliance files',
                'secondary' => $isOfficer ? $notSubmitted.' Your organization head uploads these.' : $notSubmitted,
                'status' => $isOfficer ? 'Waiting for the organization head' : 'Incomplete',
                'status_tone' => 'warning',
                'meta' => "{$missingComplianceCount} missing",
                'href' => $this->linkTo($user, '/dashboard/compliance'),
                'action_label' => 'Open compliance',
            ];
        }
        if ($ordersToVerify > 0) {
            $rows[] = [
                'id' => 'org-orders-verify',
                'primary' => 'Check the payment proofs on student orders',
                'secondary' => ucfirst($this->plural($ordersToVerify, 'order')).' '.($ordersToVerify === 1 ? 'has' : 'have').' a payment proof waiting for an officer to check.',
                'status' => 'Waiting for an officer',
                'status_tone' => 'info',
                'meta' => $this->plural($ordersToVerify, 'order'),
                'href' => $this->linkTo($user, '/dashboard/merchandise/manage-orders'),
                'action_label' => 'Verify orders',
            ];
        }
        if ($staleEvents > 0) {
            $rows[] = [
                'id' => 'org-stale-events',
                'primary' => 'Close events that have ended',
                'secondary' => ucfirst($this->plural($staleEvents, 'event')).' '.($staleEvents === 1 ? 'has' : 'have').' ended but still '.($staleEvents === 1 ? 'shows' : 'show').' as approved or ongoing.',
                'status' => 'Needs closing',
                'status_tone' => 'warning',
                'meta' => $this->plural($staleEvents, 'event'),
                'href' => $this->linkTo($user, $isOfficer ? '/dashboard/events/activity-calendar' : '/dashboard/events/manage-events'),
                'action_label' => 'Manage events',
            ];
        }
        if ($openTasks > 0 && $overdueTasks === 0) {
            $rows[] = [
                'id' => 'org-open-tasks',
                'primary' => $isOfficer ? 'Keep your active tasks moving' : 'Check on the active officer tasks',
                'secondary' => ucfirst($this->plural($openTasks, 'task')).' '.$this->be($openTasks).' pending or in progress.',
                'status' => 'In progress',
                'status_tone' => 'info',
                'meta' => "{$openTasks} active",
                'href' => $this->linkTo($user, $isOfficer ? '/dashboard/tasks/assigned-tasks' : '/dashboard/tasks/task-board'),
                'action_label' => 'View tasks',
            ];
        }

        $organizationName = $user->organization?->name ?? 'your organization';
        $standing = array_values(array_filter([
            $overdueTasks > 0 ? $this->plural($overdueTasks, 'overdue task') : null,
            $openTasks > 0 ? $this->plural($openTasks, 'active task') : null,
            $pendingApprovals > 0 ? $this->plural($pendingApprovals, 'request').' waiting for your approval' : null,
            $missingComplianceCount > 0 && ! $isOfficer ? $this->plural($missingComplianceCount, 'missing or returned compliance requirement') : null,
            $ordersToVerify > 0 ? $this->plural($ordersToVerify, 'order').' waiting for a payment check' : null,
            $staleEvents > 0 ? $this->plural($staleEvents, 'ended event').' to close' : null,
        ]));
        $owedByHead = $isOfficer && $missingComplianceCount > 0
            ? ' Your organization head still has '.$this->plural($missingComplianceCount, 'compliance requirement').' to upload.'
            : '';
        $answer = $standing !== []
            ? "Today for {$organizationName} you have ".$this->joinPhrases($standing).'.'.$owedByHead
            : "Nothing needs you today for {$organizationName}. There are no open tasks, ".($isOfficer ? '' : 'missing requirements, ').'payment checks or ended events to close.'.$owedByHead;

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
                    'title' => 'What needs you today',
                    'description' => 'The most urgent come first.',
                    'empty_message' => 'Your tasks, files and orders are all up to date.',
                    'rows' => $rows,
                ],
            ],
            'follow_ups' => [
                ['topic' => 'missing_submissions', 'label' => "What haven't we submitted?", 'question' => "What compliance requirements, event files, or reports haven't we submitted?"],
                ['topic' => 'tasks_workload', 'label' => 'Who has overdue tasks?', 'question' => 'Who has overdue or pending tasks in our organization?'],
                ['topic' => 'finance_health', 'label' => 'Our budget and unpaid fees', 'question' => 'How much budget is left, and how many student invoices are unpaid?'],
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
                ? ComplianceRequirementType::inYear($academicYear, AcademicSemester::active()?->academic_year_id)
                    ->where('is_active', true)
                    ->where('category', 'organization')
                    ->where(fn ($q) => $q->whereNull('academic_semester_id')->orWhere('academic_semester_id', $semesterId))
                    ->orderBy('name')
                    ->get(['id', 'name', 'category', 'deadline_at'])
                : collect();

            $orgs = Organization::whereIn('id', $organizationIds)
                ->where('lifecycle_status', 'active')
                ->orderBy('name')
                ->get(['id', 'name', 'acronym']);
            $activeOrgIds = $orgs->pluck('id');

            $submissionsByOrg = $requirementTypes->isNotEmpty()
                ? OrganizationComplianceSubmission::whereIn('organization_id', $activeOrgIds)
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
                    'href' => $this->linkTo($user, $role === 'SUPER_ADMIN' ? '/dashboard/super-admin/compliance' : '/dashboard/department-head/organizations'),
                    'action_label' => 'Inspect',
                ];
            }

            // Also check financial report deadline
            $latestDeadline = DB::table('financial_report_deadlines')->orderByDesc('id')->first();
            $missingReportRows = [];
            $missingReportTotal = 0;
            if ($latestDeadline) {
                $coveredOrgIds = DB::table('financial_reports')
                    ->whereIn('organization_id', $activeOrgIds)
                    ->where('deadline_id', $latestDeadline->id)
                    ->whereIn('submission_status', ['pending_department_head', 'pending_sao', 'approved'])
                    ->pluck('organization_id')
                    ->unique();

                $orgsMissingReport = $orgs->whereNotIn('id', $coveredOrgIds);
                $missingReportTotal = $orgsMissingReport->count();
                foreach ($orgsMissingReport->take(self::ROW_LIMIT) as $org) {
                    $missingReportRows[] = [
                        'id' => 'missing-fin-'.$org->id,
                        'primary' => $org->acronym ? "{$org->name} ({$org->acronym})" : $org->name,
                        'secondary' => 'No submitted financial report for deadline '.Carbon::parse($latestDeadline->deadline_at)->format('M j, Y'),
                        'status' => Carbon::parse($latestDeadline->deadline_at)->isPast() ? 'Overdue' : 'Not submitted',
                        'status_tone' => Carbon::parse($latestDeadline->deadline_at)->isPast() ? 'danger' : 'warning',
                        'meta' => 'Due '.Carbon::parse($latestDeadline->deadline_at)->format('M j'),
                        'href' => $this->complianceReviewLink($user, '/dashboard/super-admin/compliance?tab=financial', '/dashboard/compliance'),
                        'action_label' => 'View reports',
                    ];
                }
            }

            $missingComplianceTotal = count($missingComplianceRows);
            $orgsLabel = Str::plural('organization', $orgs->count());
            $financialSentence = match (true) {
                $latestDeadline === null => 'No financial report deadline has been set yet.',
                $missingReportTotal === 0 => 'Every organization has submitted its financial report for the latest deadline.',
                default => sprintf(
                    '%d %s not yet submitted a financial report for the latest deadline.',
                    $missingReportTotal,
                    $missingReportTotal === 1 ? 'organization has' : 'organizations have'
                ),
            };

            $answer = $requirementTypes->isEmpty()
                ? sprintf(
                    'No compliance requirements are set for the current period across %d active student %s. %s',
                    $orgs->count(),
                    $orgsLabel,
                    $financialSentence
                )
                : sprintf(
                    '%d of %d active student %s %s missing or returned compliance files, and %d %s submitted everything required across %d %s. %s',
                    $missingComplianceTotal,
                    $orgs->count(),
                    $orgsLabel,
                    $missingComplianceTotal === 1 ? 'has' : 'have',
                    $fullySubmittedCount,
                    $fullySubmittedCount === 1 ? 'has' : 'have',
                    $requirementTypes->count(),
                    Str::plural('requirement', $requirementTypes->count()),
                    $financialSentence
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
                        'description' => $this->showingFirst($missingComplianceTotal),
                        'empty_message' => 'Every active organization has submitted all its compliance requirements.',
                        'rows' => array_slice($missingComplianceRows, 0, self::ROW_LIMIT),
                    ],
                    [
                        'id' => 'orgs-missing-financial-reports',
                        'title' => 'Organizations Missing Latest Financial Report',
                        'description' => $this->showingFirst($missingReportTotal),
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
        $missingCompliance = $this->missingComplianceRequirementsForOrganization($orgId, $user);

        $semesterId = AcademicSemester::selected()?->id;
        $upcomingOrDraftEvents = Event::where('organization_id', $orgId)
            ->whereIn('status', ['planning', 'approved'])
            ->where('end_time', '>=', now())
            ->when($semesterId, fn ($events) => $events->where('academic_semester_id', $semesterId))
            ->orderBy('start_time')
            ->limit(8)
            ->get();

        $uploadedByEvent = $upcomingOrDraftEvents->isEmpty()
            ? collect()
            : EventRequirementFile::whereIn('event_id', $upcomingOrDraftEvents->pluck('id'))
                ->get(['event_id', 'requirement_id'])
                ->groupBy('event_id');

        $requirementsByShape = [];
        $missingEventReqRows = [];
        foreach ($upcomingOrDraftEvents as $event) {
            $shape = ($event->academic_semester_id ?? 'none').'|'.data_get($event->planning_details, 'venue_type');
            $activeReqs = $requirementsByShape[$shape] ??= EventRequirement::activeForEvent($event)->where('is_optional', false)->get(['id', 'name']);
            if ($activeReqs->isEmpty()) {
                continue;
            }
            $uploadedReqIds = ($uploadedByEvent->get($event->id) ?? collect())->pluck('requirement_id')->all();
            $missingNames = $activeReqs->whereNotIn('id', $uploadedReqIds)->pluck('name')->all();
            if ($missingNames !== []) {
                $missingEventReqRows[] = [
                    'id' => 'missing-ev-req-'.$event->id,
                    'primary' => $event->title,
                    'secondary' => 'Missing event files: '.implode(', ', array_slice($missingNames, 0, 3)),
                    'status' => count($missingNames).' missing',
                    'status_tone' => 'warning',
                    'meta' => Str::headline($event->status),
                    'href' => $this->linkTo($user, $role === 'ADMIN' ? '/dashboard/events/manage-events' : '/dashboard/events/activity-calendar'),
                    'action_label' => 'Upload files',
                ];
            }
        }

        $latestDeadline = DB::table('financial_report_deadlines')->orderByDesc('id')->first();
        $missingReportRows = [];
        if ($latestDeadline) {
            $reportSubmitted = DB::table('financial_reports')
                ->where('organization_id', $orgId)
                ->where('deadline_id', $latestDeadline->id)
                ->whereIn('submission_status', ['pending_department_head', 'pending_sao', 'approved'])
                ->exists();
            if (! $reportSubmitted) {
                $deadlineAt = Carbon::parse($latestDeadline->deadline_at);
                $missingReportRows[] = [
                    'id' => 'missing-fin-'.$orgId,
                    'primary' => 'Financial report for the '.$deadlineAt->format('M j, Y').' deadline',
                    'secondary' => 'No submitted financial report for this deadline yet.',
                    'status' => $deadlineAt->isPast() ? 'Overdue' : 'Not submitted',
                    'status_tone' => $deadlineAt->isPast() ? 'danger' : 'warning',
                    'meta' => 'Due '.$deadlineAt->format('M j'),
                    'href' => $this->linkTo($user, '/dashboard/finance/financial-ledger?tab=reports'),
                    'action_label' => 'Open reports',
                ];
            }
        }

        $complianceTotal = count($missingCompliance);
        $eventTotal = count($missingEventReqRows);
        $reportSentence = match (true) {
            $latestDeadline === null => 'No financial report deadline has been set yet.',
            $missingReportRows === [] => 'Your financial report for the latest deadline is in.',
            default => 'Your financial report for the latest deadline has not been submitted.',
        };

        $answer = sprintf(
            '%s has %d unsubmitted or returned compliance %s and %d %s still missing required proposal files. %s',
            $user->organization?->name ?? 'Your organization',
            $complianceTotal,
            Str::plural('requirement', $complianceTotal),
            $eventTotal,
            Str::plural('event', $eventTotal),
            $reportSentence
        );
        if ($complianceTotal > 0 && $this->linkTo($user, '/dashboard/compliance') === null) {
            $answer .= ' Your organization head uploads the compliance files.';
        }

        return [
            'title' => 'Missing or Returned Requirements',
            'answer' => $answer,
            'highlights' => [
                ['label' => 'Missing compliance files', 'value' => (string) $complianceTotal, 'tone' => $complianceTotal > 0 ? 'warning' : 'success'],
                ['label' => 'Events missing files', 'value' => (string) $eventTotal, 'tone' => $eventTotal > 0 ? 'warning' : 'success'],
                ['label' => 'Financial report', 'value' => $latestDeadline === null ? 'No deadline' : ($missingReportRows === [] ? 'Submitted' : 'Not submitted'), 'tone' => $missingReportRows === [] ? 'success' : 'danger'],
            ],
            'sections' => [
                [
                    'id' => 'org-missing-compliance-list',
                    'title' => 'Unsubmitted or Returned Compliance Requirements',
                    'description' => $this->showingFirst($complianceTotal),
                    'empty_message' => 'Your organization has submitted all active compliance requirements.',
                    'rows' => array_slice($missingCompliance, 0, self::ROW_LIMIT),
                ],
                [
                    'id' => 'org-missing-event-files',
                    'title' => 'Events Missing Required Proposal Documents',
                    'description' => null,
                    'empty_message' => 'All current events have their required proposal documents uploaded.',
                    'rows' => $missingEventReqRows,
                ],
                [
                    'id' => 'org-missing-financial-report',
                    'title' => 'Financial Report',
                    'description' => null,
                    'empty_message' => $latestDeadline === null ? 'No financial report deadline has been set yet.' : 'Your financial report for the latest deadline has been submitted.',
                    'rows' => $missingReportRows,
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
        $totalReturned = OrganizationComplianceSubmission::whereIn('organization_id', $orgIds)
            ->where('status', 'returned')
            ->count();

        $complianceRows = $submissions->map(function (OrganizationComplianceSubmission $sub) use ($user) {
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
                'href' => $this->complianceReviewLink($user, '/dashboard/super-admin/compliance?tab=review', '/dashboard/compliance'),
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
            'href' => $this->complianceReviewLink($user, '/dashboard/super-admin/compliance?tab=financial', '/dashboard/finance/statement-of-account'),
            'action_label' => 'Open report',
        ])->all();

        $reportCounts = DB::table('financial_reports')
            ->whereIn('organization_id', $orgIds)
            ->whereIn('submission_status', ['pending_department_head', 'pending_sao', 'approved', 'rejected'])
            ->selectRaw('submission_status, COUNT(*) as total')
            ->groupBy('submission_status')
            ->pluck('total', 'submission_status');
        $reportsAwaiting = (int) ($reportCounts['pending_department_head'] ?? 0) + (int) ($reportCounts['pending_sao'] ?? 0);
        $reportsApproved = (int) ($reportCounts['approved'] ?? 0);
        $reportsReturned = (int) ($reportCounts['rejected'] ?? 0);
        $reportsTotal = $reportsAwaiting + $reportsApproved + $reportsReturned;
        $complianceTotal = $totalSubmitted + $totalApproved + $totalReturned;

        $answer = sprintf(
            '%d compliance %s %s waiting for review and %d %s approved. For financial reports, %d %s awaiting review, %d %s approved and %d %s returned for changes.',
            $totalSubmitted,
            Str::plural('file', $totalSubmitted),
            $totalSubmitted === 1 ? 'is' : 'are',
            $totalApproved,
            $totalApproved === 1 ? 'is' : 'are',
            $reportsAwaiting,
            $reportsAwaiting === 1 ? 'is' : 'are',
            $reportsApproved,
            $reportsApproved === 1 ? 'is' : 'are',
            $reportsReturned,
            $reportsReturned === 1 ? 'is' : 'are'
        );

        return [
            'title' => 'Submitted Compliance Documents & Financial Reports',
            'answer' => $answer,
            'highlights' => [
                ['label' => 'Awaiting review', 'value' => (string) $totalSubmitted, 'tone' => $totalSubmitted > 0 ? 'warning' : 'neutral'],
                ['label' => 'Approved files', 'value' => (string) $totalApproved, 'tone' => 'success'],
                ['label' => 'Reports awaiting review', 'value' => (string) $reportsAwaiting, 'tone' => $reportsAwaiting > 0 ? 'warning' : 'neutral'],
                ['label' => 'Reports approved', 'value' => (string) $reportsApproved, 'tone' => 'success'],
                ['label' => 'Reports returned', 'value' => (string) $reportsReturned, 'tone' => $reportsReturned > 0 ? 'danger' : 'neutral'],
            ],
            'sections' => [
                [
                    'id' => 'submitted-compliance-files',
                    'title' => 'Recent Compliance Submissions',
                    'description' => $this->showingFirst($complianceTotal, 'newest first'),
                    'empty_message' => 'No compliance submissions have been uploaded yet.',
                    'rows' => $complianceRows,
                ],
                [
                    'id' => 'submitted-financial-reports',
                    'title' => 'Submitted Financial Reports',
                    'description' => $this->showingFirst($reportsTotal, 'newest first'),
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

        if ($role === 'SBO_OFFICER') {
            return [
                'title' => 'Pending Approvals & Review Queue',
                'answer' => 'Approval requests are reviewed by your organization head, the Department Head and the SAO, so there is no review queue on your account.',
                'highlights' => [],
                'sections' => [],
                'follow_ups' => [
                    ['topic' => 'daily_priorities', 'label' => 'What should I do today?', 'question' => 'What should I do today?'],
                ],
            ];
        }

        $approvalsQuery = $this->awaitingApprovalsQuery($user, $organizationIds)->with('requester:school_id,first_name,last_name');

        $totalPendingApprovals = (clone $approvalsQuery)->count();
        $approvals = $approvalsQuery->orderBy('requested_at')->limit(self::ROW_LIMIT)->get();

        $approvalOrgs = Organization::whereIn('id', $approvals->pluck('organization_id'))->get(['id', 'name', 'acronym'])->keyBy('id');

        $approvalRows = $approvals->map(function (ApprovalRequest $req) use ($user, $role, $approvalOrgs) {
            $requester = trim(($req->requester?->first_name ?? '').' '.($req->requester?->last_name ?? '')) ?: 'Member';
            $organization = $approvalOrgs->get($req->organization_id);
            $orgName = $organization?->acronym ?: ($organization?->name ?? 'Organization');

            return [
                'id' => 'app-'.$req->id,
                'primary' => $this->entityLabels->for($req),
                'secondary' => Str::headline($req->entity_type)." · {$orgName} · Requested by {$requester}",
                'status' => 'Waiting for '.$this->reviewerName($req->required_role),
                'status_tone' => 'warning',
                'meta' => $req->requested_at ? $req->requested_at->diffForHumans() : 'Pending',
                'href' => $this->linkTo($user, $role === 'SUPER_ADMIN' ? '/dashboard/super-admin/organization-approvals' : '/dashboard/approvals'),
                'action_label' => 'Review',
            ];
        })->all();

        $extraSection = [];
        $pendingRegCount = 0;
        $pendingBookingCount = 0;
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
                'description' => $this->showingFirst($pendingRegCount),
                'empty_message' => 'No organization registrations are pending review.',
                'rows' => $pendingRegs->take(self::ROW_LIMIT)->map(fn ($org) => [
                    'id' => 'reg-'.$org->id,
                    'primary' => $org->acronym ? "{$org->name} ({$org->acronym})" : $org->name,
                    'secondary' => 'Student organization registration application',
                    'status' => 'Pending review',
                    'status_tone' => 'warning',
                    'meta' => $org->submitted_at ? Carbon::parse($org->submitted_at)->diffForHumans() : 'Submitted',
                    'href' => $this->linkTo($user, '/dashboard/super-admin/organizations?status=pending'),
                    'action_label' => 'Review',
                ])->all(),
            ];

            $pendingBookings = VenueBooking::where('status', 'pending')->with(['venue:id,name', 'organization:id,name,acronym']);
            $pendingBookingCount = (clone $pendingBookings)->count();
            $extraSection[] = [
                'id' => 'pending-venue-bookings',
                'title' => 'Venue Bookings Waiting for the SAO',
                'description' => $this->showingFirst($pendingBookingCount, 'oldest first'),
                'empty_message' => 'No venue bookings are waiting for confirmation.',
                'rows' => $pendingBookings->orderBy('created_at')->orderBy('id')->limit(self::ROW_LIMIT)->get()->map(fn (VenueBooking $booking) => [
                    'id' => 'venue-'.$booking->id,
                    'primary' => ($booking->venue?->name ?? $booking->off_campus_location ?? 'Venue').' · '.($booking->organization?->acronym ?: ($booking->organization?->name ?? 'Organization')),
                    'secondary' => 'Venue booking · '.$booking->start_time?->format('M j, Y g:i A'),
                    'status' => 'Waiting for SAO',
                    'status_tone' => 'warning',
                    'meta' => $booking->created_at ? $booking->created_at->diffForHumans() : 'Pending',
                    'href' => $this->linkTo($user, '/dashboard/super-admin/venues'),
                    'action_label' => 'Review',
                ])->all(),
            ];
        }

        $budgetsWaiting = $this->budgetsWaitingForDecision($user, $organizationIds);

        $requestsPhrase = $totalPendingApprovals.' approval '.Str::plural('request', $totalPendingApprovals);
        $answer = $role === 'SUPER_ADMIN'
            ? sprintf(
                '%s %s waiting for your review, %d student %s %s waiting for a registration decision, and %s %s waiting for your confirmation.',
                $requestsPhrase,
                $this->be($totalPendingApprovals),
                $pendingRegCount,
                Str::plural('organization', $pendingRegCount),
                $this->be($pendingRegCount),
                $this->plural($pendingBookingCount, 'venue booking'),
                $this->be($pendingBookingCount)
            )
            : sprintf('%s %s waiting for your review.', $requestsPhrase, $totalPendingApprovals === 1 ? 'is' : 'are');

        if ($budgetsWaiting['count'] > 0) {
            $answer .= sprintf(' %d of them %s, ₱%s in all.', $budgetsWaiting['count'], $budgetsWaiting['count'] === 1 ? 'is a budget' : 'are budgets', number_format($budgetsWaiting['total'], 2));
        }

        return [
            'title' => 'Pending Approvals & Review Queue',
            'answer' => $answer,
            'highlights' => [
                ['label' => 'Pending approvals', 'value' => (string) $totalPendingApprovals, 'tone' => $totalPendingApprovals > 0 ? 'warning' : 'success'],
                ...($budgetsWaiting['count'] > 0 ? [
                    ['label' => 'Budgets waiting', 'value' => (string) $budgetsWaiting['count'], 'tone' => 'warning'],
                    ['label' => 'Budget amount waiting', 'value' => '₱'.number_format($budgetsWaiting['total'], 2), 'tone' => 'primary'],
                ] : []),
                ...(
                    $role === 'SUPER_ADMIN'
                        ? [
                            ['label' => 'Pending registrations', 'value' => (string) $pendingRegCount, 'tone' => $pendingRegCount > 0 ? 'warning' : 'neutral'],
                            ['label' => 'Pending venue bookings', 'value' => (string) $pendingBookingCount, 'tone' => $pendingBookingCount > 0 ? 'warning' : 'neutral'],
                        ]
                        : []
                ),
            ],
            'sections' => [
                [
                    'id' => 'pending-approvals-list',
                    'title' => 'Pending Approval Requests',
                    'description' => $this->showingFirst($totalPendingApprovals, 'oldest first'),
                    'empty_message' => 'No pending approval requests in your queue.',
                    'rows' => $approvalRows,
                ],
                ...($budgetsWaiting['rows'] === [] ? [] : [[
                    'id' => 'pending-budgets-list',
                    'title' => 'Budgets Waiting For Your Decision',
                    'description' => trim('Each budget with its organization, event and allocated amount. '.$this->showingFirst($budgetsWaiting['count'], 'oldest first')),
                    'empty_message' => 'No budgets are waiting for your decision.',
                    'rows' => $budgetsWaiting['rows'],
                ]]),
                ...$extraSection,
            ],
            'follow_ups' => [
                ['topic' => 'missing_submissions', 'label' => "Who hasn't submitted requirements?", 'question' => "Which organizations haven't submitted compliance or financial reports?"],
                ['topic' => 'daily_priorities', 'label' => 'What should I do today?', 'question' => 'What should I do today?'],
            ],
        ];
    }

    /**
     * The budgets among the requests that wait for this person's own decision, each with its organization, event,
     * allocated amount and stage, and what they come to together. It reads the same queue as the approvals list, so the
     * count here is a part of that list's count. Only the first rows are built; the total is over every one.
     *
     * @param  Collection<int, int>  $organizationIds
     * @return array{count: int, total: float, rows: array<int, array<string, mixed>>}
     */
    private function budgetsWaitingForDecision(User $user, Collection $organizationIds): array
    {
        $requests = $this->awaitingApprovalsQuery($user, $organizationIds)
            ->where('entity_type', 'budget')
            ->with('requester:school_id,first_name,last_name')
            ->orderBy('requested_at')
            ->orderBy('id')
            ->get();

        $budgets = Budget::with('event:id,title')
            ->whereIn('id', $requests->pluck('entity_id'))
            ->get(['id', 'organization_id', 'event_id', 'title', 'allocated_amount'])
            ->keyBy('id');
        // A request counts only when its budget belongs to the organization the request names, the rule the label uses.
        $requests = $requests->filter(fn (ApprovalRequest $req) => (int) $budgets->get($req->entity_id)?->organization_id === (int) $req->organization_id)->values();
        $organizations = Organization::whereIn('id', $requests->pluck('organization_id'))->get(['id', 'name', 'acronym'])->keyBy('id');
        $href = $this->linkTo($user, $user->role === 'SUPER_ADMIN' ? '/dashboard/super-admin/organization-approvals' : '/dashboard/approvals');

        return [
            'count' => $requests->count(),
            'total' => round((float) $requests->sum(fn (ApprovalRequest $req) => (float) $budgets->get($req->entity_id)->allocated_amount), 2),
            'rows' => $requests->take(self::ROW_LIMIT)->map(function (ApprovalRequest $req) use ($budgets, $organizations, $href) {
                $budget = $budgets->get($req->entity_id);
                $organization = $organizations->get($req->organization_id);
                $requester = trim(($req->requester?->first_name ?? '').' '.($req->requester?->last_name ?? '')) ?: 'Member';

                return [
                    'id' => 'pending-budget-'.$budget->id,
                    'primary' => $budget->title,
                    'secondary' => sprintf(
                        '%s · Event: %s · Allocated: ₱%s · Requested by %s',
                        $organization?->acronym ?: ($organization?->name ?? 'Organization'),
                        $budget->event?->title ?? 'not linked to an event',
                        number_format((float) $budget->allocated_amount, 2),
                        $requester
                    ),
                    'status' => 'Waiting for '.$this->reviewerName($req->required_role),
                    'status_tone' => 'warning',
                    'meta' => '₱'.number_format((float) $budget->allocated_amount, 2),
                    'href' => $href,
                    'action_label' => 'Review',
                ];
            })->all(),
        ];
    }

    // -------------------------------------------------------------------------
    // Intent 5: Organizations Without Admin / Returned Registrations
    // -------------------------------------------------------------------------

    private function buildOrganizationsWithoutAdmin(User $user, Collection $organizationIds): array
    {
        $role = $user->role;
        $orgIds = $this->scopedStudentOrganizationIds($user, false)->all();

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

        $href = $this->linkTo(
            $user,
            $role === 'SUPER_ADMIN' ? '/dashboard/super-admin/organizations' : '/dashboard/department-head/organizations'
        );

        return [
            'title' => 'Organization Leadership & Registration Gaps',
            'answer' => sprintf(
                '%d active student %s %s no active administrator, and %d organization %s returned for changes.',
                $noAdminOrgs->count(),
                Str::plural('organization', $noAdminOrgs->count()),
                $noAdminOrgs->count() === 1 ? 'has' : 'have',
                $returnedOrgs->count(),
                $returnedOrgs->count() === 1 ? 'registration was' : 'registrations were'
            ),
            'highlights' => [
                ['label' => 'Active without admin', 'value' => (string) $noAdminOrgs->count(), 'tone' => $noAdminOrgs->count() > 0 ? 'warning' : 'success'],
                ['label' => 'Returned registrations', 'value' => (string) $returnedOrgs->count(), 'tone' => $returnedOrgs->count() > 0 ? 'danger' : 'neutral'],
            ],
            'sections' => [
                [
                    'id' => 'orgs-without-admin',
                    'title' => 'Active Organizations Without an Administrator',
                    'description' => trim(($role === 'SUPER_ADMIN'
                        ? 'The Department Head names the admin of a college organization, and you name the admin of a university-wide one.'
                        : 'Open an organization and use Give access to name its head.').' '.$this->showingFirst($noAdminOrgs->count())),
                    'empty_message' => 'Every active organization has an organization head.',
                    'rows' => $noAdminOrgs->take(self::ROW_LIMIT)->map(fn ($org) => [
                        'id' => 'noadmin-'.$org->id,
                        'primary' => $org->acronym ? "{$org->name} ({$org->acronym})" : $org->name,
                        'secondary' => 'No organization head has been named yet',
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
                    'description' => $this->showingFirst($returnedOrgs->count()),
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

        $this->inSelectedSemester($query, 'tasks.academic_semester_id');

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

        $href = $this->linkTo(
            $user,
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

        $tasksAnswer = sprintf(
            '%d %s overdue, and %d %s still pending or in progress.',
            $overdueCount,
            $overdueCount === 1 ? 'task is' : 'tasks are',
            $openCount,
            $openCount === 1 ? 'task is' : 'tasks are'
        );

        return [
            'title' => 'Tasks & Officer Workload',
            'answer' => $role === 'SBO_OFFICER' ? 'Of the tasks assigned to you, '.$tasksAnswer : $tasksAnswer,
            'highlights' => [
                ['label' => 'Overdue tasks', 'value' => (string) $overdueCount, 'tone' => $overdueCount > 0 ? 'danger' : 'success'],
                ['label' => 'Open tasks', 'value' => (string) $openCount, 'tone' => 'primary'],
            ],
            'sections' => [
                [
                    'id' => 'tasks-workload-list',
                    'title' => 'Overdue & Active Tasks',
                    'description' => trim('Overdue tasks come first, then the earliest deadline. '.$this->showingFirst($overdueCount + $openCount)),
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

    /** A student who asks about a budget is told budgets are not theirs to see, before the fees that are. */
    private function withBudgetNote(User $user, string $question, array $payload): array
    {
        if ($user->role === 'STUDENT' && preg_match('~\bbudgets?\b~', Str::lower($question)) === 1) {
            $payload['answer'] = 'Organization budgets are not shown to students. '.$payload['answer'];
        }

        return $payload;
    }

    /** With $ownAccount an Admin or an officer reads what they owe as a member, the way a student does. */
    private function buildFinanceHealth(User $user, Collection $organizationIds, bool $ownAccount = false): array
    {
        $role = $user->role;

        if ($role === 'STUDENT' || $ownAccount) {
            $orgId = (int) $user->organization_id;
            $row = $this->balances->rows(collect([$user]), $orgId)->first();
            $owed = (float) ($row['total_debt'] ?? 0);
            $unpaidCount = (int) ($row['unpaid_invoice_count'] ?? 0);

            $invoiceQuery = Invoice::where('organization_id', $orgId)->where('student_id', $user->school_id);
            $invoiceTotal = (clone $invoiceQuery)->count();
            $invoices = $invoiceQuery
                ->with('payments')
                ->orderByDesc('created_at')
                ->orderByDesc('id')
                ->limit(self::ROW_LIMIT)
                ->get()
                ->map(fn (Invoice $invoice) => (object) $this->balances->invoiceData($invoice));

            return [
                'title' => 'Your Fees & Account Balance',
                'answer' => sprintf(
                    'You owe your organization ₱%s across %d open %s.',
                    number_format($owed, 2),
                    $unpaidCount,
                    Str::plural('invoice', $unpaidCount)
                ),
                'highlights' => [
                    ['label' => 'Total balance owed', 'value' => '₱'.number_format($owed, 2), 'tone' => $owed > 0 ? 'warning' : 'success'],
                    ['label' => 'Open invoices', 'value' => (string) $unpaidCount, 'tone' => $unpaidCount > 0 ? 'warning' : 'neutral'],
                ],
                'sections' => [
                    [
                        'id' => 'student-invoices',
                        'title' => 'Your Invoices & Collections',
                        'description' => $this->showingFirst($invoiceTotal, 'newest first'),
                        'empty_message' => 'No invoices have been issued to your account.',
                        'rows' => $invoices->map(fn ($inv) => [
                            'id' => 'inv-'.$inv->id,
                            'primary' => $inv->description ?: 'Invoice #'.$inv->id,
                            'secondary' => sprintf('Amount: ₱%s · Paid: ₱%s', number_format((float) $inv->amount_due, 2), number_format((float) $inv->amount_paid, 2)),
                            'status' => Str::headline($inv->status),
                            'status_tone' => match ($inv->status) {
                                'paid' => 'success',
                                'cancelled', 'waived' => 'neutral',
                                default => 'warning',
                            },
                            'meta' => $inv->due_date ? 'Due '.Carbon::parse($inv->due_date)->format('M j, Y') : 'Open',
                            'href' => $this->linkTo($user, '/dashboard/finance/statement-of-account'),
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

        $approvedBudgetQuery = Budget::query()
            ->whereIn('organization_id', $orgIds)
            ->where('submission_status', 'approved')
            ->tap(fn ($budgets) => SemesterScope::budgets($budgets, AcademicSemester::selected()));
        $budgetTotal = (clone $approvedBudgetQuery)->count();
        $approvedBudgets = (clone $approvedBudgetQuery)
            ->orderByDesc('allocated_amount')
            ->orderBy('id')
            ->limit(self::ROW_LIMIT)
            ->get(['id', 'organization_id', 'title', 'allocated_amount', 'remaining_amount']);
        $budgetOrgs = Organization::whereIn('id', $approvedBudgets->pluck('organization_id'))->get(['id', 'name', 'acronym'])->keyBy('id');
        $spentByBudget = Budget::spentAmounts($approvedBudgets->pluck('id'));

        $totals = (clone $approvedBudgetQuery)
            ->selectRaw('COALESCE(SUM(allocated_amount),0) as allocated, COALESCE(SUM(remaining_amount),0) as remaining')
            ->first();

        $allocated = (float) ($totals->allocated ?? 0);
        $remaining = (float) ($totals->remaining ?? 0);

        // The working behind "remaining": income posted against a budget is added to it and spending is taken off, so
        // the sentence shows both from the entries recorded against the approved budgets, never from the remaining column.
        $ledgerSums = "COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as income, COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as expense";
        $ledger = Transaction::whereIn('budget_id', (clone $approvedBudgetQuery)->select('id'))->selectRaw($ledgerSums)->first();
        $ledgerByBudget = Transaction::whereIn('budget_id', $approvedBudgets->pluck('id'))->selectRaw("budget_id, {$ledgerSums}")->groupBy('budget_id')->get()->keyBy('budget_id');
        $working = $this->budgetWorking($allocated, (float) ($ledger->income ?? 0), (float) ($ledger->expense ?? 0), $remaining);

        $unpaidInvoicesCount = DB::table('invoices')
            ->whereIn('organization_id', $orgIds)
            ->whereNotIn('status', ['paid', 'cancelled', 'waived'])
            ->count();

        $budgetHref = $this->linkTo($user, '/dashboard/finance/budget-allocation');
        $books = $this->ledgerPicture($orgIds);

        return [
            'title' => 'Budget Utilization & Financial Status',
            'answer' => sprintf(
                '%s approved budgets total ₱%s allocated with ₱%s remaining, and %d student %s %s unpaid.',
                ucfirst($this->ownerPhrase($user)),
                number_format($allocated, 2),
                number_format($remaining, 2),
                $unpaidInvoicesCount,
                Str::plural('invoice', $unpaidInvoicesCount),
                $unpaidInvoicesCount === 1 ? 'is' : 'are'
            ).($remaining > $allocated ? ' The remaining amount is higher than the amount allocated because income recorded against a budget is added to it.' : '').($working === null ? '' : ' Working: '.$working).$this->ledgerSentence($books),
            'highlights' => [
                ['label' => 'Approved allocated', 'value' => '₱'.number_format($allocated, 2), 'tone' => 'primary'],
                ['label' => 'Remaining budget', 'value' => '₱'.number_format($remaining, 2), 'tone' => 'success'],
                ['label' => 'Open student invoices', 'value' => (string) $unpaidInvoicesCount, 'tone' => $unpaidInvoicesCount > 0 ? 'warning' : 'neutral'],
                ...$this->ledgerHighlights($books),
            ],
            'sections' => [
                [
                    'id' => 'approved-budgets-list',
                    'title' => 'Approved Budgets',
                    'description' => $this->showingFirst($budgetTotal, 'largest allocation first'),
                    'empty_message' => 'No approved budgets are recorded yet.',
                    'rows' => $approvedBudgets->map(function ($b) use ($budgetOrgs, $spentByBudget, $ledgerByBudget, $budgetHref) {
                        $org = $budgetOrgs->get($b->organization_id);
                        $spent = (float) ($spentByBudget[$b->id] ?? 0);
                        $used = (float) $b->allocated_amount > 0 ? $spent / (float) $b->allocated_amount : 0;
                        // Shown only when it adds up and its spent figure is the one on the row; a cash advance makes them differ.
                        $entries = $ledgerByBudget->get($b->id);
                        $working = $entries !== null && abs((float) $entries->expense - $spent) < 0.005
                            ? $this->budgetWorking((float) $b->allocated_amount, (float) $entries->income, (float) $entries->expense, (float) $b->remaining_amount)
                            : null;

                        return [
                            'id' => 'bud-'.$b->id,
                            'primary' => $b->title.' — '.($org?->acronym ?: ($org?->name ?? 'Organization')),
                            'secondary' => sprintf('Allocated: ₱%s · Spent: ₱%s · Remaining: ₱%s', number_format((float) $b->allocated_amount, 2), number_format($spent, 2), number_format((float) $b->remaining_amount, 2)).($working === null ? '' : '. Working: '.$working),
                            'status' => round($used * 100).'% spent',
                            'status_tone' => $used >= 0.9 ? 'danger' : ($used >= 0.8 ? 'warning' : 'success'),
                            'meta' => '₱'.number_format((float) $b->remaining_amount, 2).' left',
                            'progress_percent' => round($used * 100),
                            'href' => $budgetHref,
                            'action_label' => 'Open budget',
                        ];
                    })->all(),
                ],
                ...$this->ledgerSections($books, $this->linkTo($user, '/dashboard/finance/financial-ledger')),
            ],
            'follow_ups' => [
                ['topic' => 'missing_submissions', 'label' => 'Missing financial reports', 'question' => "Which organizations haven't submitted compliance or financial reports?"],
                ['topic' => 'daily_priorities', 'label' => 'What should I do today?', 'question' => 'What should I do today?'],
            ],
        ];
    }

    // -------------------------------------------------------------------------
    // Report preparation: what stands between the organization and a clean financial report
    // -------------------------------------------------------------------------

    /**
     * What an Admin or officer should settle before sending the financial report, read from the same rules the report
     * checks use (FinancialReportChecks) over the selected semester, plus the budgets still waiting for approval, the
     * ledger entries linked to nothing, the deadline, the latest report and the organization's overdue and due-soon tasks.
     * Nothing here is written or sent.
     *
     * Query plans measured with EXPLAIN ANALYZE on MySQL 8.0.46 on 2026-11-25: index lookups only, under 0.1 ms. The task
     * lookup added in r24 (organization, unfinished status, soonest deadline, at most 60 rows) measured the same day on
     * the production MySQL (8 task rows, so the plan shape is what counts): the administrator shape reads
     * tasks_organization_id_index, filters, sorts the few rows and joins users on its primary key, 0.062 ms; the officer
     * shape reads tasks_assignment_recency_index on (organization_id, assigned_to), 0.012 ms. No table scan in either, and
     * the app sets no query timeout on the MySQL connection, so there is no limit to compare against.
     */
    private function buildReportPreparation(User $user): array
    {
        if (! in_array($user->role, ['ADMIN', 'SBO_OFFICER'], true)) {
            return [
                'title' => 'Before the financial report',
                'answer' => 'A financial report is prepared and sent by an organization\'s Admin and officers from its own records, so there is none to prepare on your account. The reports sent to you are under your approvals.',
                'highlights' => [],
                'sections' => [],
                'follow_ups' => [
                    ['topic' => 'pending_approvals', 'label' => 'What is waiting for me?', 'question' => 'What is waiting for my approval?'],
                ],
            ];
        }

        $orgId = (int) $user->organization_id;
        $semester = AcademicSemester::selected();
        $from = $semester?->starts_on?->toDateString() ?? today()->startOfYear()->toDateString();
        $to = $semester?->ends_on?->toDateString() ?? today()->toDateString();

        $findings = app(FinancialReportChecks::class)->forPeriod($orgId, $from, $to);
        $findingCount = count($findings);
        $highCount = count(array_filter($findings, fn (array $finding) => $finding['severity'] === 'high'));
        $receiptCount = count(array_filter($findings, fn (array $finding) => $finding['code'] === 'missing_receipt'));

        $unlinkedCount = Transaction::query()
            ->where('organization_id', $orgId)
            ->excludingCashAdvances()
            ->whereNull('budget_id')
            ->whereNull('event_id')
            ->whereDate('transaction_date', '>=', $from)
            ->whereDate('transaction_date', '<=', $to)
            ->count();

        $waiting = Budget::query()
            ->where('organization_id', $orgId)
            ->whereIn('submission_status', ['pending_department_head', 'pending_sao'])
            ->tap(fn ($budgets) => SemesterScope::budgets($budgets, $semester))
            ->orderBy('id')
            ->get(['id', 'title', 'allocated_amount', 'submission_status']);

        $deadline = FinancialReportDeadline::orderByDesc('id')->first();
        $deadlineDay = $deadline?->deadline_at?->copy()->startOfDay();
        $daysLeft = $deadlineDay === null ? null : (int) today()->diffInDays($deadlineDay, false);
        $latest = FinancialReport::where('organization_id', $orgId)->orderByDesc('id')->first(['id', 'title', 'submission_status']);

        $tasks = $this->reportPrepTasks($user, $orgId);
        $overdueTasks = $tasks->where('late', true);
        $dueSoonTasks = $tasks->where('late', false);

        $parts = [];
        $parts[] = $findingCount === 0
            ? 'The report checks found nothing to fix for '.$this->periodLabel($from, $to).'.'
            : sprintf('The report checks found %d %s to fix for %s, %d of them marked high.', $findingCount, $findingCount === 1 ? 'thing' : 'things', $this->periodLabel($from, $to), $highCount);
        if ($waiting->isNotEmpty()) {
            $parts[] = sprintf(
                '%d %s still waiting for approval, so %s not count as available: %s.',
                $waiting->count(),
                $waiting->count() === 1 ? 'budget is' : 'budgets are',
                $waiting->count() === 1 ? 'it does' : 'they do',
                $this->joinPhrases($waiting->take(3)->pluck('title')->all()).($waiting->count() > 3 ? ' and '.($waiting->count() - 3).' more' : '')
            );
        }
        if ($receiptCount > 0) {
            $parts[] = sprintf('%d %s no receipt reference.', $receiptCount, $receiptCount === 1 ? 'expense has' : 'expenses have');
        }
        if ($unlinkedCount > 0) {
            $parts[] = sprintf('%d ledger %s not linked to a budget or an event.', $unlinkedCount, $unlinkedCount === 1 ? 'entry is' : 'entries are');
        }
        $parts[] = match (true) {
            $deadline === null => 'No financial report deadline has been set yet.',
            $daysLeft > 1 => sprintf('The financial report deadline is %s, %d days away.', $deadlineDay->format('M j, Y'), $daysLeft),
            $daysLeft === 1 => sprintf('The financial report deadline is %s, tomorrow.', $deadlineDay->format('M j, Y')),
            $daysLeft === 0 => sprintf('The financial report deadline is %s, today.', $deadlineDay->format('M j, Y')),
            default => sprintf('The financial report deadline was %s, %d %s ago.', $deadlineDay->format('M j, Y'), abs($daysLeft), abs($daysLeft) === 1 ? 'day' : 'days'),
        };
        $parts[] = $latest === null
            ? 'No financial report has been created for the organization yet.'
            : sprintf('The latest report, %s, is %s.', $latest->title, Str::lower(Str::headline((string) $latest->submission_status)));
        if ($overdueTasks->isNotEmpty()) {
            $parts[] = sprintf(
                '%d %s overdue, %s: %s.',
                $overdueTasks->count(),
                $overdueTasks->count() === 1 ? 'task is' : 'tasks are',
                $user->role === 'SBO_OFFICER' ? 'assigned to you' : 'most relevant to finance and records first',
                $this->joinPhrases($overdueTasks->take(3)->pluck('title')->all()).($overdueTasks->count() > 3 ? ' and '.($overdueTasks->count() - 3).' more' : '')
            );
        }
        if ($dueSoonTasks->isNotEmpty()) {
            $parts[] = sprintf('%d more %s due within the next %d days.', $dueSoonTasks->count(), $dueSoonTasks->count() === 1 ? 'task is' : 'tasks are', self::DUE_SOON_DAYS);
        }

        $reportsHref = $this->linkTo($user, '/dashboard/finance/transaction-history');
        $ledgerHref = $this->linkTo($user, '/dashboard/finance/financial-ledger');
        $budgetsHref = $this->linkTo($user, '/dashboard/finance/budget-allocation');
        $tasksHref = $this->linkTo($user, $user->role === 'SBO_OFFICER' ? '/dashboard/tasks/assigned-tasks' : '/dashboard/tasks/task-board');

        $step = fn (string $id, string $primary, string $secondary, string $status, string $tone, ?string $href, string $label) => [
            'id' => 'report-prep-'.$id,
            'primary' => $primary,
            'secondary' => $secondary,
            'status' => $status,
            'status_tone' => $tone,
            'meta' => 'Before you send',
            'href' => $href,
            'action_label' => $label,
        ];
        $steps = array_values(array_filter([
            $findingCount > 0 ? $step('checks', 'Work through the report checks', sprintf('%d %s, most urgent first. Open the report and read the checks under Before you send.', $findingCount, $findingCount === 1 ? 'finding' : 'findings'), 'To do', 'warning', $reportsHref, 'Open Financial reports') : null,
            $receiptCount > 0 ? $step('receipts', 'Add the missing receipt references', sprintf('%d %s no receipt reference.', $receiptCount, $receiptCount === 1 ? 'expense has' : 'expenses have'), 'To do', 'warning', $ledgerHref, 'Open the ledger') : null,
            $unlinkedCount > 0 ? $step('unlinked', 'Link the entries that belong to a budget or an event', sprintf('%d ledger %s not linked to a budget or an event.', $unlinkedCount, $unlinkedCount === 1 ? 'entry is' : 'entries are'), 'To do', 'warning', $ledgerHref, 'Open the ledger') : null,
            $waiting->isNotEmpty() ? $step('budgets', 'Get the waiting budgets approved', sprintf('%d %s waiting for a decision, and a budget counts only once it is approved.', $waiting->count(), $waiting->count() === 1 ? 'budget is' : 'budgets are'), 'Waiting', 'info', $budgetsHref, 'Open Budget allocation') : null,
            $overdueTasks->isNotEmpty() ? $step('tasks', 'Finish the overdue tasks', sprintf('%d %s past the deadline: %s.', $overdueTasks->count(), $overdueTasks->count() === 1 ? 'task is' : 'tasks are', $this->joinPhrases($overdueTasks->take(3)->pluck('title')->all()).($overdueTasks->count() > 3 ? ' and '.($overdueTasks->count() - 3).' more' : '')), 'Overdue', 'danger', $tasksHref, 'Open tasks') : null,
            $step('send', 'Generate the report and send it', $deadline === null ? 'No deadline is set yet, so send it when the checks are clear.' : 'Send it before the deadline on '.$deadlineDay->format('M j, Y').'.', 'Do last', 'primary', $reportsHref, 'Open Financial reports'),
        ]));

        return [
            'title' => 'Before You Send The Financial Report',
            'answer' => implode(' ', $parts),
            'highlights' => [
                ['label' => 'Report deadline', 'value' => $deadlineDay === null ? 'Not set' : $deadlineDay->format('M j, Y'), 'tone' => $daysLeft !== null && $daysLeft < 0 ? 'danger' : 'primary'],
                ['label' => 'Checks to fix', 'value' => (string) $findingCount, 'tone' => $findingCount > 0 ? 'warning' : 'success'],
                ['label' => 'Budgets waiting', 'value' => (string) $waiting->count(), 'tone' => $waiting->isNotEmpty() ? 'warning' : 'success'],
                ['label' => 'Expenses without a receipt', 'value' => (string) $receiptCount, 'tone' => $receiptCount > 0 ? 'warning' : 'success'],
                ['label' => 'Entries not linked', 'value' => (string) $unlinkedCount, 'tone' => $unlinkedCount > 0 ? 'warning' : 'success'],
                ['label' => 'Overdue tasks', 'value' => (string) $overdueTasks->count(), 'tone' => $overdueTasks->isNotEmpty() ? 'danger' : 'success'],
            ],
            'sections' => [
                [
                    'id' => 'report-prep-steps',
                    'title' => 'What To Do, In Order',
                    'description' => 'Settle these, then generate the report. The checks never stop you from sending, and the reviewer sees the same list.',
                    'empty_message' => 'Nothing is standing in the way.',
                    'rows' => $steps,
                ],
                [
                    'id' => 'report-prep-findings',
                    'title' => 'What The Report Checks Found',
                    'description' => trim('Read over '.$this->periodLabel($from, $to).', most urgent first. '.$this->showingFirst($findingCount)),
                    'empty_message' => 'The report checks found nothing to fix.',
                    'rows' => array_map(fn (array $finding) => [
                        'id' => 'report-prep-finding-'.str_replace([':', ','], '-', FinancialReportChecks::keyOf($finding)),
                        'primary' => FinancialReportChecks::describe($finding),
                        'secondary' => Str::headline($finding['code']),
                        'status' => Str::headline($finding['severity']),
                        'status_tone' => ['high' => 'danger', 'medium' => 'warning', 'low' => 'info'][$finding['severity']] ?? 'info',
                        'meta' => $finding['amount'] === null ? 'No amount' : '₱'.number_format($finding['amount'], 2),
                        'href' => $reportsHref,
                        'action_label' => 'Open Financial reports',
                    ], array_slice($findings, 0, self::ROW_LIMIT)),
                ],
                [
                    'id' => 'report-prep-budgets',
                    'title' => 'Budgets Still Waiting For Approval',
                    'description' => 'A budget is available to spend only once it is approved.',
                    'empty_message' => 'No budget is waiting for approval.',
                    'rows' => $waiting->take(self::ROW_LIMIT)->map(fn (Budget $budget) => [
                        'id' => 'report-prep-budget-'.$budget->id,
                        'primary' => $budget->title,
                        'secondary' => 'Allocated: ₱'.number_format((float) $budget->allocated_amount, 2),
                        'status' => 'Waiting for '.$this->reviewerName($budget->submission_status === 'pending_sao' ? 'SUPER_ADMIN' : 'DEPARTMENT_HEAD'),
                        'status_tone' => 'warning',
                        'meta' => '₱'.number_format((float) $budget->allocated_amount, 2),
                        'href' => $budgetsHref,
                        'action_label' => 'Open Budget allocation',
                    ])->all(),
                ],
                [
                    'id' => 'report-prep-tasks',
                    'title' => 'Overdue And Due-Soon Tasks',
                    'description' => 'Overdue tasks first, the ones about finance and records before the rest, then the earliest deadline. '.$this->showingFirst($tasks->count()),
                    'empty_message' => 'No task is overdue or due within the next '.self::DUE_SOON_DAYS.' days.',
                    'rows' => $tasks->take(self::ROW_LIMIT)->map(fn (array $task) => [
                        'id' => 'report-prep-task-'.$task['id'],
                        'primary' => $task['title'],
                        'secondary' => 'Assigned to '.$task['assignee'].' · Due '.$task['due'],
                        'status' => $task['late'] ? 'Overdue' : 'Due soon',
                        'status_tone' => $task['late'] ? 'danger' : 'warning',
                        'meta' => $task['relevant'] ? 'Finance or records' : 'Task',
                        'href' => $tasksHref,
                        'action_label' => 'Open task',
                    ])->all(),
                ],
            ],
            'follow_ups' => [
                ['topic' => 'finance_health', 'label' => 'How is our finance?', 'question' => 'How is our finance?'],
                ['topic' => 'my_submissions', 'label' => 'Where do our submissions stand?', 'question' => 'Where do our submissions stand?'],
            ],
        ];
    }

    /**
     * The organization's unfinished tasks that are past their deadline or due within DUE_SOON_DAYS, ranked for someone
     * about to send the financial report: overdue before due soon, the ones about finance and records (fees, funds,
     * receipts, the member roster, reports) before the rest, then the earliest deadline. A task past its deadline and not
     * finished is overdue even before the nightly mark. An officer sees only the tasks assigned to them, as on the task list.
     *
     * @return Collection<int, array{id: int, title: string, assignee: string, due: string, late: bool, relevant: bool}>
     */
    private function reportPrepTasks(User $user, int $orgId): Collection
    {
        $query = DB::table('tasks')
            ->leftJoin('users', 'tasks.assigned_to', '=', 'users.school_id')
            ->where('tasks.organization_id', $orgId)
            ->whereIn('tasks.status', ['overdue', 'pending', 'in_progress'])
            ->where('tasks.deadline', '<=', now()->addDays(self::DUE_SOON_DAYS)->endOfDay());
        if ($user->role === 'SBO_OFFICER') {
            $query->where('tasks.assigned_to', $user->school_id);
        }
        $this->inSelectedSemester($query, 'tasks.academic_semester_id');

        return $query->orderBy('tasks.deadline')
            ->limit(60)
            ->get(['tasks.id', 'tasks.title', 'tasks.status', 'tasks.deadline', 'users.first_name', 'users.last_name'])
            ->map(function ($task): array {
                $deadline = Carbon::parse($task->deadline);

                return [
                    'id' => (int) $task->id,
                    'title' => (string) $task->title,
                    'assignee' => trim(($task->first_name ?? '').' '.($task->last_name ?? '')) ?: 'Unassigned',
                    'due' => $deadline->format('M j, Y'),
                    'late' => $task->status === 'overdue' || $deadline->isPast(),
                    'relevant' => preg_match(self::FINANCE_RECORDS_TASK_WORDS, (string) $task->title) === 1,
                    'at' => $deadline->getTimestamp(),
                ];
            })
            ->sortBy([['late', 'desc'], ['relevant', 'desc'], ['at', 'asc']])
            ->values()
            ->map(fn (array $task) => Arr::except($task, ['at']));
    }

    /** "Jun 1, 2026 to Dec 31, 2026", the span a report check reads. */
    private function periodLabel(string $from, string $to): string
    {
        return Carbon::parse($from)->format('M j, Y').' to '.Carbon::parse($to)->format('M j, Y');
    }

    /**
     * What the ledger itself holds for the selected semester, whether or not an entry is linked to a budget. A manual
     * entry, a verified collection or an invoice payment often carries no budget, so a picture built from approved
     * budgets alone reads 0.00 for an organization that has recorded money. It reads through LedgerScope, the same scope
     * behind the Ledger summary (organization, semester, no archived entry), so its net equals the Ledger page's.
     *
     * @param  array<int, int>  $orgIds
     * @return array{count: int, income: float, expense: float, unlinked_income: float, unlinked_expense: float, categories: array<int, array{category: string, income: float, expense: float, entries: int}>}
     */
    private function ledgerPicture(array $orgIds): array
    {
        $entries = LedgerScope::query(request(), $orgIds);

        $sum = fn (string $type, bool $unlinkedOnly = false) => "COALESCE(SUM(CASE WHEN type = '{$type}'".($unlinkedOnly ? ' AND budget_id IS NULL' : '').' THEN amount ELSE 0 END), 0)';
        $totals = (clone $entries)->selectRaw("COUNT(*) as entries, {$sum('income')} as income, {$sum('expense')} as expense, {$sum('income', true)} as unlinked_income, {$sum('expense', true)} as unlinked_expense")->first();

        $categories = (clone $entries)
            ->selectRaw("category, COUNT(*) as entries, {$sum('income')} as income, {$sum('expense')} as expense")
            ->groupBy('category')
            ->orderByRaw('SUM(amount) DESC')
            ->orderBy('category')
            ->limit(self::ROW_LIMIT)
            ->get()
            ->map(fn ($row) => [
                'category' => (string) $row->category,
                'income' => round((float) $row->income, 2),
                'expense' => round((float) $row->expense, 2),
                'entries' => (int) $row->entries,
            ])
            ->all();

        return [
            'count' => (int) ($totals->entries ?? 0),
            'income' => round((float) ($totals->income ?? 0), 2),
            'expense' => round((float) ($totals->expense ?? 0), 2),
            'unlinked_income' => round((float) ($totals->unlinked_income ?? 0), 2),
            'unlinked_expense' => round((float) ($totals->unlinked_expense ?? 0), 2),
            'categories' => $categories,
        ];
    }

    /** The ledger totals in a sentence, with the part that no budget accounts for; empty when the ledger holds nothing. */
    private function ledgerSentence(array $books): string
    {
        if ($books['count'] === 0) {
            return '';
        }

        $peso = fn (float $amount) => '₱'.number_format($amount, 2);
        $sentence = sprintf(
            ' The ledger shows %s income and %s expenses, so %s net.',
            $peso($books['income']),
            $peso($books['expense']),
            $peso($books['income'] - $books['expense'])
        );

        if ($books['unlinked_income'] > 0 || $books['unlinked_expense'] > 0) {
            $sentence .= sprintf(
                ' Of that, %s income and %s expenses are not linked to a budget.',
                $peso($books['unlinked_income']),
                $peso($books['unlinked_expense'])
            );
        }

        return $sentence;
    }

    private function ledgerHighlights(array $books): array
    {
        if ($books['count'] === 0) {
            return [];
        }

        $net = $books['income'] - $books['expense'];

        return [
            ['label' => 'Ledger income', 'value' => '₱'.number_format($books['income'], 2), 'tone' => 'success'],
            ['label' => 'Ledger expenses', 'value' => '₱'.number_format($books['expense'], 2), 'tone' => 'warning'],
            ['label' => 'Ledger net', 'value' => '₱'.number_format($net, 2), 'tone' => $net < 0 ? 'danger' : 'primary'],
        ];
    }

    private function ledgerSections(array $books, ?string $href): array
    {
        if ($books['categories'] === []) {
            return [];
        }

        return [[
            'id' => 'ledger-by-category',
            'title' => 'Ledger by Category',
            'description' => 'Largest total first.',
            'empty_message' => 'No ledger entries are recorded yet.',
            'rows' => array_map(fn (array $category) => [
                'id' => 'ledger-category-'.Str::slug($category['category']),
                'primary' => Str::headline($category['category']),
                'secondary' => sprintf('Income: ₱%s · Expenses: ₱%s', number_format($category['income'], 2), number_format($category['expense'], 2)),
                'status' => $category['income'] >= $category['expense'] ? 'Net in' : 'Net out',
                'status_tone' => $category['income'] >= $category['expense'] ? 'success' : 'warning',
                'meta' => $this->plural($category['entries'], 'entry'),
                'href' => $href,
                'action_label' => 'Open ledger',
            ], $books['categories']),
        ]];
    }

    // -------------------------------------------------------------------------
    // Intent 8: Merchandise Orders
    // -------------------------------------------------------------------------

    private function buildMerchandiseOrders(User $user): array
    {
        $role = $user->role;
        $orgId = (int) $user->organization_id;

        if (in_array($role, ['SUPER_ADMIN', 'DEPARTMENT_HEAD'], true)) {
            return [
                'title' => 'Merchandise Orders Queue',
                'answer' => 'Merchandise orders are handled by each student organization, so there is no order queue on your account. Ask the organization to check its own orders.',
                'sources' => self::NO_RECORD_SOURCES,
                'highlights' => [],
                'sections' => [],
                'follow_ups' => [
                    ['topic' => 'daily_priorities', 'label' => 'What should I do today?', 'question' => 'What should I do today?'],
                ],
            ];
        }

        $query = DB::table('orders')
            ->leftJoin('users', 'orders.student_id', '=', 'users.school_id')
            ->where('orders.organization_id', $orgId);

        if ($role === 'STUDENT') {
            $query->where('orders.student_id', $user->school_id);
        }

        $awaitingVerification = $this->ordersReadyForReview(clone $query)->count();
        $awaitingPayment = (clone $query)->where('orders.status', 'pending')->whereNull('orders.payment_proof_url')->where('orders.payment_method', 'gcash')->count();
        $readyToClaim = (clone $query)->where('orders.status', 'paid')->count();
        $queueTotal = (clone $query)->whereIn('orders.status', ['pending', 'paid'])->count();

        $orders = $query
            ->whereIn('orders.status', ['pending', 'paid'])
            ->orderByDesc('orders.updated_at')
            ->limit(self::ROW_LIMIT)
            ->get([
                'orders.id',
                'orders.total_price',
                'orders.status',
                'orders.officer_review_status',
                'orders.payment_method',
                'orders.payment_proof_url',
                'users.first_name',
                'users.last_name',
            ]);

        $href = $this->linkTo(
            $user,
            $role === 'STUDENT' ? '/dashboard/merchandise/my-orders' : '/dashboard/merchandise/manage-orders'
        );

        $orderPhrase = fn (int $count) => $count.' '.($role === 'STUDENT' ? 'of your orders' : Str::plural('order', $count));

        return [
            'title' => 'Merchandise Orders Queue',
            'answer' => sprintf(
                '%s %s waiting for payment verification, %s %s waiting for payment, and %s %s ready to be claimed.',
                $orderPhrase($awaitingVerification),
                $awaitingVerification === 1 ? 'is' : 'are',
                $orderPhrase($awaitingPayment),
                $awaitingPayment === 1 ? 'is' : 'are',
                $orderPhrase($readyToClaim),
                $readyToClaim === 1 ? 'is' : 'are'
            ),
            'highlights' => [
                ['label' => 'Awaiting verification', 'value' => (string) $awaitingVerification, 'tone' => $awaitingVerification > 0 ? 'warning' : 'neutral'],
                ['label' => 'Awaiting payment', 'value' => (string) $awaitingPayment, 'tone' => 'neutral'],
                ['label' => 'Ready to claim', 'value' => (string) $readyToClaim, 'tone' => $readyToClaim > 0 ? 'success' : 'neutral'],
            ],
            'sections' => [
                [
                    'id' => 'orders-active-list',
                    'title' => 'Pending & Claimable Merchandise Orders',
                    'description' => $this->showingFirst($queueTotal, 'most recently updated first'),
                    'empty_message' => 'No pending or unclaimed merchandise orders right now.',
                    'rows' => $orders->map(function ($ord) use ($href) {
                        $buyer = trim(($ord->first_name ?? '').' '.($ord->last_name ?? '')) ?: 'Student';
                        $needsReview = $ord->officer_review_status === 'pending' && ($ord->payment_proof_url || $ord->payment_method !== 'gcash');
                        [$status, $tone, $note] = match (true) {
                            $ord->status === 'paid' => ['Ready to claim', 'success', 'Paid'],
                            $needsReview => ['Awaiting verification', 'warning', $ord->payment_proof_url ? 'Payment proof uploaded' : 'No online payment proof needed'],
                            $ord->payment_proof_url === null => ['Awaiting payment', 'neutral', 'No payment proof uploaded yet'],
                            default => ['Reviewed', 'neutral', 'Payment proof reviewed'],
                        };

                        return [
                            'id' => 'ord-'.$ord->id,
                            'primary' => "Order ORD-{$ord->id} ({$buyer})",
                            'secondary' => 'Total: ₱'.number_format((float) $ord->total_price, 2).' · '.$note,
                            'status' => $status,
                            'status_tone' => $tone,
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

    /**
     * The items an organization is running low on, lowest first, from the stock the merchandise page shows: an item is low
     * at or under its own restock level and out at zero. Stock already has the units of unpaid orders taken out of it, so
     * those are shown beside it and never added back. Delisted and deleted items are not asked about.
     */
    private function buildMerchandiseStock(User $user): array
    {
        if (in_array($user->role, ['SUPER_ADMIN', 'DEPARTMENT_HEAD'], true)) {
            return [
                'title' => 'Merchandise Stock Levels',
                'answer' => 'Merchandise stock is handled by each student organization, so there is no stock on your account. Ask the organization to check its own stock.',
                'sources' => self::NO_RECORD_SOURCES,
                'highlights' => [],
                'sections' => [],
                'follow_ups' => [
                    ['topic' => 'daily_priorities', 'label' => 'What should I do today?', 'question' => 'What should I do today?'],
                ],
            ];
        }

        $orgId = (int) $user->organization_id;
        $low = DB::table('merchandise')
            ->where('organization_id', $orgId)
            ->whereNull('deleted_at')
            ->where('is_active', true)
            ->whereColumn('stock_quantity', '<=', 'low_stock_threshold');
        $total = (clone $low)->count();
        $outCount = (clone $low)->where('stock_quantity', 0)->count();
        $items = (clone $low)
            ->orderBy('stock_quantity')
            ->orderBy('name')
            ->orderBy('id')
            ->limit(self::ROW_LIMIT)
            ->get(['id', 'name', 'stock_quantity', 'low_stock_threshold']);

        $heldQuery = fn () => DB::table('orders')
            ->where('organization_id', $orgId)
            ->where('status', 'pending')
            ->where('stock_held', true);
        $heldByItem = $heldQuery()->whereIn('merchandise_id', $items->pluck('id'))->selectRaw('merchandise_id, SUM(quantity) as units')->groupBy('merchandise_id')->pluck('units', 'merchandise_id');
        $heldUnits = (int) $heldQuery()->whereIn('merchandise_id', (clone $low)->select('id'))->sum('quantity');

        $href = $this->linkTo($user, '/dashboard/merchandise/manage-inventory', '/dashboard/merchandise/order-merchandise');
        $actionLabel = $href !== null && str_contains($href, 'manage-inventory') ? 'Open inventory' : 'Open store';

        $named = $items->take(3)->map(fn ($item) => (int) $item->stock_quantity === 0
            ? $item->name.' is out of stock'
            : $item->name.' has '.(int) $item->stock_quantity.' left')->all();
        if ($total > 3) {
            $named[] = ($total - 3).' more';
        }

        return [
            'title' => 'Merchandise Stock Levels',
            'answer' => $total === 0
                ? 'Nothing is running low. Every active item is above its restock level.'
                : sprintf('%d %s restocking: %s.', $total, $total === 1 ? 'item needs' : 'items need', $this->joinPhrases($named))
                    .($heldUnits > 0
                        ? ($heldUnits === 1
                            ? ' 1 unit is held by an unpaid order and is not counted in the stock shown.'
                            : " {$heldUnits} units are held by unpaid orders and are not counted in the stock shown.")
                        : ''),
            'highlights' => [
                ['label' => 'Out of stock', 'value' => (string) $outCount, 'tone' => $outCount > 0 ? 'danger' : 'neutral'],
                ['label' => 'Low stock', 'value' => (string) ($total - $outCount), 'tone' => $total - $outCount > 0 ? 'warning' : 'neutral'],
                ['label' => 'Held by unpaid orders', 'value' => (string) $heldUnits, 'tone' => 'neutral'],
            ],
            'sections' => [
                [
                    'id' => 'merchandise-stock-list',
                    'title' => 'Items Running Low',
                    'description' => $this->showingFirst($total, 'lowest stock first'),
                    'empty_message' => 'No active item is at or under its restock level.',
                    'rows' => $items->map(fn ($item) => [
                        'id' => 'stock-'.$item->id,
                        'primary' => $item->name,
                        'secondary' => sprintf(
                            '%d left, restock at %d or fewer. %d held by unpaid orders.',
                            (int) $item->stock_quantity,
                            (int) $item->low_stock_threshold,
                            (int) ($heldByItem[$item->id] ?? 0)
                        ),
                        'status' => (int) $item->stock_quantity === 0 ? 'Out of stock' : 'Low',
                        'status_tone' => (int) $item->stock_quantity === 0 ? 'danger' : 'warning',
                        'meta' => (int) $item->stock_quantity.' left',
                        'href' => $href,
                        'action_label' => $actionLabel,
                    ])->all(),
                ],
            ],
            'follow_ups' => [
                ['topic' => 'merchandise_orders', 'label' => 'Which orders are waiting?', 'question' => 'Which merchandise orders are waiting?'],
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

        $semesterId = AcademicSemester::selected()?->id;
        // A student sees what has been approved. The people who run the events also see the ones still being planned, because
        // an event that is not approved yet is still coming up, and it is the one whose tasks they have to chase.
        $statuses = $role === 'STUDENT' ? ['approved', 'ongoing'] : ['planning', 'approved', 'ongoing'];
        $upcomingQuery = DB::table('events')
            ->join('organizations', 'organizations.id', '=', 'events.organization_id')
            ->whereIn('events.organization_id', $orgIds)
            ->whereIn('events.status', $statuses)
            ->where('events.end_time', '>=', now())
            ->when($semesterId, fn ($events) => $events->where('events.academic_semester_id', $semesterId));
        $upcomingTotal = (clone $upcomingQuery)->count();
        $upcomingEvents = $upcomingQuery
            ->orderBy('events.start_time')
            ->limit(self::ROW_LIMIT)
            ->get([
                'events.id',
                'events.title',
                'events.status',
                'events.start_time',
                'events.end_time',
                'events.location',
                'organizations.name as org_name',
                'organizations.acronym as org_acronym',
            ]);

        $staleEventsCount = $this->inSelectedSemester(DB::table('events')
            ->whereIn('organization_id', $orgIds)
            ->whereIn('status', ['approved', 'ongoing'])
            ->where('end_time', '<', now()), 'academic_semester_id')->count();

        $href = $this->linkTo($user, '/dashboard/events/activity-calendar');
        $closesEvents = in_array($role, ['ADMIN', 'SBO_OFFICER'], true);
        $eventTasks = $role === 'STUDENT' ? collect() : $this->tasksOfEvents($user, $upcomingEvents->pluck('id')->all());
        $taskCounts = $role === 'STUDENT' ? collect() : $this->taskCountsOfEvents($upcomingEvents->pluck('id')->all());
        $tasksLabel = $role === 'SBO_OFFICER' ? 'Your tasks on these events' : 'Tasks on these events';
        $taskHref = $this->linkTo($user, $role === 'SBO_OFFICER' ? '/dashboard/tasks/assigned-tasks' : '/dashboard/tasks/task-board');

        return [
            'title' => 'Upcoming Events & Attendance Status',
            'answer' => match (true) {
                $role === 'STUDENT' => sprintf('%s coming up for your organization.', ucfirst($this->plural($upcomingTotal, 'event').' '.$this->be($upcomingTotal))),
                $closesEvents => sprintf(
                    '%d %s upcoming or ongoing, and %d past %s still open and should be marked completed.',
                    $upcomingTotal,
                    $upcomingTotal === 1 ? 'event is' : 'events are',
                    $staleEventsCount,
                    $staleEventsCount === 1 ? 'event is' : 'events are'
                ),
                default => sprintf('%s upcoming or ongoing.', ucfirst($this->plural($upcomingTotal, 'event').' '.$this->be($upcomingTotal))),
            },
            'highlights' => [
                ['label' => 'Upcoming / ongoing', 'value' => (string) $upcomingTotal, 'tone' => 'primary'],
                ...($closesEvents ? [['label' => 'Needs closing', 'value' => (string) $staleEventsCount, 'tone' => $staleEventsCount > 0 ? 'warning' : 'neutral']] : []),
                ...($role === 'STUDENT' ? [] : [['label' => $tasksLabel, 'value' => (string) $eventTasks->count(), 'tone' => 'neutral']]),
            ],
            'sections' => [
                [
                    'id' => 'upcoming-events-list',
                    'title' => 'Scheduled & Ongoing Events',
                    'description' => $this->showingFirst($upcomingTotal, 'soonest first'),
                    'empty_message' => 'No upcoming events are currently scheduled.',
                    'rows' => $upcomingEvents->map(fn ($ev) => [
                        'id' => 'ev-'.$ev->id,
                        'primary' => $ev->title.' — '.($ev->org_acronym ?: $ev->org_name),
                        'secondary' => ($ev->location ?: 'Campus venue').' · Starts '.Carbon::parse($ev->start_time)->format('M j, Y g:i A').' · Ends '.Carbon::parse($ev->end_time)->format('M j, Y g:i A').($role === 'STUDENT' ? '' : ' · '.((int) ($taskCounts[$ev->id] ?? 0) === 0 ? 'No tasks yet' : $this->plural((int) $taskCounts[$ev->id], 'task'))),
                        'status' => Str::headline($ev->status),
                        'status_tone' => $ev->status === 'ongoing' ? 'success' : 'info',
                        'meta' => Carbon::parse($ev->start_time)->format('M j'),
                        'href' => $href,
                        'action_label' => 'View calendar',
                    ])->all(),
                ],
                ...($role === 'STUDENT' ? [] : [[
                    'id' => 'upcoming-event-tasks',
                    'title' => $role === 'SBO_OFFICER' ? 'Your Tasks On These Events' : 'Tasks On These Events',
                    'description' => trim('Every status, earliest deadline first. '.($role === 'SBO_OFFICER' ? 'Only the tasks assigned to you. ' : '').$this->showingFirst($eventTasks->count())),
                    'empty_message' => 'None of these events has a task yet.',
                    'rows' => $eventTasks->take(self::ROW_LIMIT)->map(function ($task) use ($taskHref) {
                        $assignee = trim(($task->first_name ?? '').' '.($task->last_name ?? '')) ?: 'Unassigned';

                        return [
                            'id' => 'evtask-'.$task->id,
                            'primary' => $task->title,
                            'secondary' => "For {$task->event_title} · Assigned to {$assignee} · Due ".($task->deadline ? Carbon::parse($task->deadline)->format('M j, Y') : 'no deadline'),
                            'status' => Str::headline($task->status),
                            'status_tone' => match ($task->status) {
                                'overdue' => 'danger',
                                'completed' => 'success',
                                'in_progress' => 'info',
                                default => 'warning',
                            },
                            'meta' => ((int) ($task->progress_percent ?? 0)).'% complete',
                            'href' => $taskHref,
                            'action_label' => 'Open task',
                        ];
                    })->all(),
                ]]),
            ],
            'follow_ups' => $role === 'STUDENT'
                ? [
                    ['topic' => 'daily_priorities', 'label' => 'What should I do today?', 'question' => 'What do I need to do today?'],
                    ['topic' => 'elections_status', 'label' => 'Can I vote?', 'question' => 'Are there elections I can vote in?'],
                ]
                : [
                    ['topic' => 'missing_submissions', 'label' => 'Missing event files?', 'question' => $closesEvents
                        ? "What compliance requirements, event files, or reports haven't we submitted?"
                        : "Which organizations haven't submitted compliance or financial reports?"],
                    ['topic' => 'daily_priorities', 'label' => 'What should I do today?', 'question' => 'What should I do today?'],
                ],
        ];
    }

    /**
     * Every task of each given event, whoever it is assigned to, so an officer's event row never says "No tasks yet" for
     * an event whose tasks belong to someone else.
     *
     * @param  array<int, int|string>  $eventIds
     * @return Collection<int, int>
     */
    private function taskCountsOfEvents(array $eventIds): Collection
    {
        if ($eventIds === []) {
            return collect();
        }

        return DB::table('tasks')
            ->whereIn('event_id', $eventIds)
            ->selectRaw('event_id, COUNT(*) as total')
            ->groupBy('event_id')
            ->pluck('total', 'event_id');
    }

    /**
     * The tasks that belong to the given events, whatever their status, earliest deadline first, with the event's title and
     * the assignee's name. An officer reads only the tasks assigned to them, the same cut the task list makes.
     *
     * @param  array<int, int|string>  $eventIds
     */
    private function tasksOfEvents(User $user, array $eventIds): Collection
    {
        if ($eventIds === []) {
            return collect();
        }

        return DB::table('tasks')
            ->join('events', 'events.id', '=', 'tasks.event_id')
            ->leftJoin('users', 'tasks.assigned_to', '=', 'users.school_id')
            ->whereIn('tasks.event_id', $eventIds)
            ->when($user->role === 'SBO_OFFICER', fn ($tasks) => $tasks->where('tasks.assigned_to', $user->school_id))
            ->orderBy('tasks.deadline')
            ->orderBy('tasks.id')
            ->get([
                'tasks.id',
                'tasks.event_id',
                'tasks.title',
                'tasks.status',
                'tasks.deadline',
                'tasks.progress_percent',
                'events.title as event_title',
                'users.first_name',
                'users.last_name',
            ]);
    }

    /**
     * A budget's four figures on one line for the record search. Income posted against a budget raises what is left, so
     * a remaining amount above the allocation is normal and the line says how it was reached. When the stored remaining
     * amount is not allocated plus income posted minus spent, the line says that instead: a real mismatch stays visible
     * and a correct figure is never presented as one.
     */
    private function budgetFigureLine(float $allocated, float $income, float $spent, float $remaining): string
    {
        $line = implode(' · ', array_filter([
            'Allocated: ₱'.number_format($allocated, 2),
            $income >= 0.005 ? 'Income posted: ₱'.number_format($income, 2) : null,
            'Spent: ₱'.number_format($spent, 2),
            'Remaining: ₱'.number_format($remaining, 2),
        ]));

        $working = $this->budgetWorking($allocated, $income, $spent, $remaining);
        if ($working !== null) {
            return $line.'. Working: '.$working;
        }

        $expected = $allocated + $income - $spent;

        return abs($expected - $remaining) < 0.005
            ? $line
            : sprintf('%s. These figures do not add up: allocated + income posted - spent is ₱%s, not the ₱%s shown.', $line, number_format($expected, 2), number_format($remaining, 2));
    }

    /**
     * "Allocated plus income posted, minus spent, equals what is left", written out so a remaining amount above the
     * allocation reads as checked. It is returned only when the figures from the ledger really add up to the remaining
     * amount on the budget, and only when there is income or spending to show.
     */
    private function budgetWorking(float $allocated, float $income, float $spent, float $remaining): ?string
    {
        if (($income < 0.005 && $spent < 0.005) || abs($allocated + $income - $spent - $remaining) >= 0.005) {
            return null;
        }

        return sprintf(
            '₱%s allocated + ₱%s income posted - ₱%s spent = ₱%s left.',
            number_format($allocated, 2),
            number_format($income, 2),
            number_format($spent, 2),
            number_format($remaining, 2)
        );
    }

    // -------------------------------------------------------------------------
    // Event readiness: one event, five checks, and who has to move next
    // -------------------------------------------------------------------------

    private const READINESS_FILLER_WORDS = [
        'is', 'are', 'was', 'will', 'be', 'the', 'our', 'my', 'we', 'it', 'its', 'ready', 'for', 'to', 'go', 'all', 'set', 'good',
        'how', 'prepared', 'on', 'track', 'readiness', 'of', 'a', 'an', 'yet', 'next', 'upcoming', 'this', 'that', 'event', 'events',
        'activity', 'activities', 'program', 'check', 'tell', 'me', 'about', 'whether', 'if', 'can', 'you', 'now', 'status', 'still',
        'almost', 'really', 'please', 'and', 'i', 'do', 'does', 'did', 'when', 'what', 'with', 'in', 'by', 'seminar', 'workshop',
        'assembly', 'summit', 'concert', 'ceremony', 'tournament', 'competition',
    ];

    private function normalizeWords(string $text): string
    {
        return trim((string) preg_replace('/[^a-z0-9]+/', ' ', Str::lower($text)));
    }

    /**
     * The events of this organization the question names, as titles inside the question first, then the title without its
     * year, then the words left once the question words are taken away. The first kind that finds any decides.
     *
     * @param  Collection<int, Event>  $events
     * @return Collection<int, Event>
     */
    private function eventsNamedIn(Collection $events, string $question): Collection
    {
        $q = $this->normalizeWords($question);
        $padded = " {$q} ";
        $candidate = trim(implode(' ', array_diff(explode(' ', $q), self::READINESS_FILLER_WORDS)));
        $titles = $events->mapWithKeys(fn (Event $event) => [$event->id => $this->normalizeWords((string) $event->title)]);
        $contains = fn (string $haystack, string $needle) => $needle !== '' && str_contains(" {$haystack} ", " {$needle} ");

        $tiers = [
            fn (string $title) => $contains($q, $title),
            fn (string $title) => strlen($withoutYear = trim((string) preg_replace('/\s(?:19|20)\d{2}$/', '', $title))) >= 3 && $withoutYear !== $title && $contains($q, $withoutYear),
            fn (string $title) => strlen($candidate) >= 3 && $contains($title, $candidate),
        ];

        foreach ($tiers as $tier => $matches) {
            $found = $events->filter(fn (Event $event) => $titles[$event->id] !== '' && $matches($titles[$event->id]));
            if ($found->isEmpty()) {
                continue;
            }
            // One event per title: the soonest one that has not passed, else the latest.
            $found = $found->groupBy(fn (Event $event) => $titles[$event->id])
                ->map(fn (Collection $same) => $same->first(fn (Event $event) => $event->end_time >= now()) ?? $same->last())
                ->values();
            if ($tier === 0 && $found->count() > 1) {
                $names = $found->map(fn (Event $event) => $titles[$event->id]);
                $longest = $found->filter(fn (Event $event) => $names->every(fn (string $other) => $other === $titles[$event->id] || str_contains(" {$titles[$event->id]} ", " {$other} ")));
                $found = $longest->isEmpty() ? $found : $longest->values();
            }

            return $found->sortBy([['start_time', 'asc'], ['id', 'asc']])->values();
        }

        return collect();
    }

    private function buildEventReadiness(User $user, string $question): array
    {
        if (! in_array($user->role, ['ADMIN', 'SBO_OFFICER'], true)) {
            return [
                'title' => 'Event readiness',
                'answer' => 'An event readiness checklist is kept by an organization head and officers from their own organization\'s records, so there is none on your account. What waits for your decision is under your approvals.',
                'sources' => self::NO_RECORD_SOURCES,
                'highlights' => [],
                'sections' => [],
                'follow_ups' => [
                    ['topic' => 'pending_approvals', 'label' => 'What is waiting for me?', 'question' => 'What is waiting for my approval?'],
                ],
            ];
        }

        $orgId = (int) $user->organization_id;
        $events = Event::where('organization_id', $orgId)->orderByDesc('start_time')->orderByDesc('id')->limit(300)->get()->sortBy([['start_time', 'asc'], ['id', 'asc']])->values();
        $upcoming = $events->filter(fn (Event $event) => in_array($event->status, ['planning', 'approved', 'ongoing'], true) && $event->end_time >= now())->values();
        $candidate = trim(implode(' ', array_diff(explode(' ', $this->normalizeWords($question)), self::READINESS_FILLER_WORDS)));
        $matches = $candidate === '' ? collect() : $this->eventsNamedIn($events, $question);

        if ($matches->count() > 1) {
            $count = $matches->count();
            $titles = $matches->pluck('title')->take(4)->all();
            $listed = $count > 4 ? [...array_slice($titles, 0, 3), ($count - 3).' more'] : $titles;

            return [
                'title' => 'Which event do you mean?',
                'answer' => sprintf('%s events match: %s. Tell me which one.', [2 => 'Two', 3 => 'Three', 4 => 'Four'][$count] ?? (string) $count, $this->joinPhrases($listed)),
                'highlights' => [],
                'sections' => [],
                'follow_ups' => array_map(fn (string $title) => ['topic' => 'event_readiness', 'label' => $title, 'question' => "Is {$title} ready?"], array_slice($titles, 0, 3)),
            ];
        }

        $event = $matches->first();
        if ($event === null && $candidate === '') {
            $event = $upcoming->first();
            if ($event === null) {
                return $this->noEventToCheck('Your organization has no upcoming event to check.', []);
            }
        }
        if ($event === null) {
            $next = $upcoming->take(3)->pluck('title')->all();

            return $this->noEventToCheck(
                'I could not find an event named like that in your organization.'
                    .($next === [] ? '' : sprintf(' Your next %s %s.', count($next) === 1 ? 'event is' : 'events are', $this->joinPhrases($next))),
                $next
            );
        }

        if (in_array($event->status, ['completed', 'cancelled'], true)) {
            return [
                'title' => $event->title.' readiness',
                'answer' => "{$event->title} is {$event->status}, so there is nothing left to get ready.",
                'highlights' => [],
                'sections' => [],
                'follow_ups' => [],
            ];
        }

        $checks = $this->readinessChecks($user, $event);
        $ready = count(array_filter($checks, fn (array $check) => $check['ready']));
        $moves = array_values(array_filter(array_column($checks, 'move')));
        $tasks = $checks[4];

        return [
            'title' => $event->title.' readiness',
            'answer' => sprintf('%s is %d of %d ready. ', $event->title, $ready, count($checks))
                .($moves === [] ? 'Nothing is waiting on anyone.' : 'Next moves: '.implode('; ', $moves).'.'),
            'highlights' => [
                ['label' => 'Ready', 'value' => sprintf('%d of %d', $ready, count($checks)), 'tone' => $ready === count($checks) ? 'success' : 'warning'],
                ['label' => 'Tasks done', 'value' => $tasks['done_label'], 'tone' => 'neutral'],
                ['label' => 'Overdue tasks', 'value' => (string) $tasks['overdue'], 'tone' => $tasks['overdue'] > 0 ? 'danger' : 'neutral'],
            ],
            'sections' => [
                [
                    'id' => 'event-readiness-checks',
                    'title' => 'Readiness checks',
                    'description' => $event->start_time ? 'Starts '.Carbon::parse($event->start_time)->format('M j, Y g:i A').'.' : null,
                    'empty_message' => 'No checks are available for this event.',
                    'rows' => array_map(fn (array $check) => [
                        'id' => 'ready-'.$check['key'].'-'.$event->id,
                        'primary' => $check['label'],
                        'secondary' => $check['detail'],
                        'status' => $check['status'],
                        'status_tone' => $check['status'] === 'Not ready' ? 'warning' : ($check['status'] === 'Ready' ? 'success' : 'neutral'),
                        'meta' => match ($check['status']) {
                            'Ready' => 'Done',
                            'Not required' => 'Not needed',
                            default => 'Next: '.$check['owner'],
                        },
                        'href' => $check['href'],
                        'action_label' => $check['action_label'],
                    ], $checks),
                ],
            ],
            'follow_ups' => [
                ['topic' => 'tasks_workload', 'label' => 'Who has overdue tasks?', 'question' => 'Who has overdue or pending tasks in our organization?'],
                ['topic' => 'daily_priorities', 'label' => 'What should I do today?', 'question' => 'What should I do today?'],
            ],
        ];
    }

    private function noEventToCheck(string $answer, array $nextTitles): array
    {
        return [
            'title' => 'Event readiness',
            'answer' => $answer,
            'highlights' => [],
            'sections' => [],
            'follow_ups' => array_map(fn (string $title) => ['topic' => 'event_readiness', 'label' => $title, 'question' => "Is {$title} ready?"], array_slice($nextTitles, 0, 2)),
        ];
    }

    /**
     * The five checks for one event, in the order a head works through them. A check with nothing to do reads Not
     * required and counts as ready; one that is not ready names whose move it is.
     *
     * @return array<int, array{key: string, label: string, ready: bool, status: string, detail: string, owner: string, move: ?string, href: ?string, action_label: string}>
     */
    private function readinessChecks(User $user, Event $event): array
    {
        $eventsHref = $this->linkTo($user, "/dashboard/events/manage-events?event={$event->id}", '/dashboard/events/activity-calendar');
        $check = fn (string $key, string $label, string $status, string $detail, string $owner, ?string $move, ?string $href, string $action) => [
            'key' => $key, 'label' => $label, 'ready' => $status !== 'Not ready', 'status' => $status, 'detail' => $detail,
            'owner' => $owner, 'move' => $status === 'Not ready' ? $move : null, 'href' => $href, 'action_label' => $action,
        ];
        $you = 'your organization';

        // 1. The event's own approval.
        $stage = $this->eventApprovals->describe([$event])[$event->id]['approval_stage'] ?? 'not_submitted';
        [$approvalDetail, $approvalOwner, $approvalMove] = match ($stage) {
            'approved' => ['The event is approved.', $you, null],
            'awaiting_department_head' => ['Waiting for the Department Head to decide.', 'the Department Head', 'the Department Head decides the event'],
            'awaiting_sao' => ['Waiting for the SAO to decide.', 'the SAO', 'the SAO decides the event'],
            'rejected' => ['The Department Head sent the event back.', $you, 'your organization revises and resubmits the event'],
            'requirements_returned' => ['The SAO sent the event files back.', $you, 'your organization fixes the returned files'],
            'awaiting_requirements' => ['The required files are not all uploaded yet.', $you, 'your organization uploads the required files'],
            'ready_for_sao' => ['The Department Head approved the event. It has not been sent to the SAO yet.', $you, 'your organization sends the event to the SAO'],
            default => ['The event has not been sent for approval yet.', $you, 'your organization sends the event for approval'],
        };
        $approval = $check('approval', 'Event approval', $stage === 'approved' ? 'Ready' : 'Not ready', $approvalDetail, $approvalOwner, $approvalMove, $eventsHref, 'Open event');

        // 2. The venue booking, newest request first.
        $booking = DB::table('venue_bookings')
            ->leftJoin('venues', 'venues.id', '=', 'venue_bookings.venue_id')
            ->where('venue_bookings.event_id', $event->id)
            ->orderByDesc('venue_bookings.id')
            ->first(['venue_bookings.status', 'venue_bookings.off_campus_location', 'venues.name as venue_name']);
        $venueName = $booking?->venue_name ?: ($booking?->off_campus_location ?: 'The venue');
        $venue = match (true) {
            $booking === null => $check('venue', 'Venue booking', 'Not ready', 'No venue booking has been requested yet.', $you, 'your organization books the venue', null, 'Open venues'),
            $booking->status === 'approved' => $check('venue', 'Venue booking', 'Ready', "{$venueName}, booking approved.", 'the SAO', null, null, 'Open venues'),
            $booking->status === 'rejected' => $check('venue', 'Venue booking', 'Not ready', "{$venueName}, booking returned.", $you, 'your organization books another venue', null, 'Open venues'),
            default => $check('venue', 'Venue booking', 'Not ready', "{$venueName}, booking pending.", 'the SAO', 'the SAO decides the venue booking', null, 'Open venues'),
        };
        $venue['href'] = $this->linkTo($user, "/dashboard/venues?event={$event->id}", '/dashboard/venues');

        // 3. The budget filed for the event.
        $budgets = DB::table('budgets')->where('event_id', $event->id)->orderByDesc('id')->get(['allocated_amount', 'submission_status']);
        $approvedBudgets = $budgets->where('submission_status', 'approved');
        $budgetHref = $this->linkTo($user, "/dashboard/finance/budget-allocation?event={$event->id}", '/dashboard/finance/budget-allocation');
        // An officer whose access leaves out finance is shown that a budget is approved, not how much it is.
        $showAmount = $user->role !== 'SBO_OFFICER' || $this->intentAllowed($user, 'finance_health');
        $approvedDetail = $showAmount
            ? '₱'.number_format((float) $approvedBudgets->sum('allocated_amount'), 2).' approved for this event.'
            : 'A budget is approved for this event.';
        $budget = match (true) {
            $approvedBudgets->isNotEmpty() => $check('budget', 'Budget', 'Ready', $approvedDetail, 'the Department Head', null, $budgetHref, 'Open budget'),
            $budgets->isEmpty() && ! $event->requires_budget => $check('budget', 'Budget', 'Not required', 'No budget is required for this event.', $you, null, $budgetHref, 'Open budget'),
            $budgets->isEmpty() => $check('budget', 'Budget', 'Not ready', 'No budget request has been filed yet.', $you, 'your organization files the budget request', $budgetHref, 'Open budget'),
            $budgets->first()->submission_status === 'pending_department_head' => $check('budget', 'Budget', 'Not ready', 'Budget request is waiting for the Department Head.', 'the Department Head', 'the Department Head decides the budget', $budgetHref, 'Open budget'),
            $budgets->first()->submission_status === 'pending_sao' => $check('budget', 'Budget', 'Not ready', 'Budget request is waiting for the SAO.', 'the SAO', 'the SAO decides the budget', $budgetHref, 'Open budget'),
            $budgets->first()->submission_status === 'rejected' => $check('budget', 'Budget', 'Not ready', 'The budget request was returned.', $you, 'your organization revises the budget request', $budgetHref, 'Open budget'),
            default => $check('budget', 'Budget', 'Not ready', 'The budget request is a draft.', $you, 'your organization submits the budget request', $budgetHref, 'Open budget'),
        };

        // 4. The files the SAO asks for: uploaded, then marked.
        $requiredIds = EventRequirement::activeForEvent($event)->where('is_optional', false)->pluck('id');
        $uploaded = EventRequirementFile::where('event_id', $event->id)->get(['id', 'requirement_id']);
        $uploadedRequired = $uploaded->whereIn('requirement_id', $requiredIds)->count();
        $returned = $uploaded->isEmpty() ? 0 : EventRequirementFileReview::where('status', 'needs_changes')->whereIn('event_requirement_file_id', $uploaded->pluck('id'))->distinct()->count('event_requirement_file_id');
        $required = $requiredIds->count();
        $files = match (true) {
            $required === 0 => $check('files', 'Required files', 'Not required', 'No required files apply to this event.', $you, null, $eventsHref, 'Open files'),
            $uploadedRequired < $required => $check('files', 'Required files', 'Not ready', "{$uploadedRequired} of {$required} required files uploaded".($returned > 0 ? ", {$returned} returned for changes." : '.'), $you, 'your organization uploads the missing files', $eventsHref, 'Open files'),
            $returned > 0 => $check('files', 'Required files', 'Not ready', "{$required} of {$required} required files uploaded, {$returned} returned for changes.", $you, 'your organization fixes the returned files', $eventsHref, 'Open files'),
            $stage === 'approved' => $check('files', 'Required files', 'Ready', "{$required} of {$required} required files uploaded and approved.", 'the SAO', null, $eventsHref, 'Open files'),
            default => $check('files', 'Required files', 'Ready', "{$required} of {$required} required files uploaded, waiting for review.", 'the SAO', null, $eventsHref, 'Open files'),
        };

        // 5. The tasks set for the event; one past its deadline and not finished is overdue even before the nightly mark.
        $tasks = DB::table('tasks')->where('event_id', $event->id)->orderBy('deadline')->orderBy('id')->get(['title', 'status', 'deadline', 'assigned_to']);
        $open = $tasks->where('status', '!=', 'completed');
        $overdue = $open->filter(fn ($task) => $task->status === 'overdue' || Carbon::parse($task->deadline)->isPast());
        $next = $overdue->first() ?? $open->first();
        // An officer sees other people's tasks as counts only; a task is named when it is the officer's own.
        $nameable = $next !== null && ($user->role !== 'SBO_OFFICER' || (string) $next->assigned_to === (string) $user->school_id);
        $assignee = ! $nameable || $next->assigned_to === null ? null : DB::table('users')->where('school_id', $next->assigned_to)->first(['first_name', 'last_name']);
        $assigneeName = $assignee === null ? null : trim($assignee->first_name.' '.$assignee->last_name);
        $done = $tasks->count() - $open->count();
        $taskDetail = "{$done} of {$tasks->count()} tasks done".($overdue->isEmpty() ? '.' : ", {$overdue->count()} overdue.");
        $tasksCheck = match (true) {
            $tasks->isEmpty() => $check('tasks', 'Tasks', 'Not required', 'No tasks are set for this event.', $you, null, null, 'Open tasks'),
            $open->isEmpty() => $check('tasks', 'Tasks', 'Ready', $taskDetail, $you, null, null, 'Open tasks'),
            ! $nameable => $check('tasks', 'Tasks', 'Not ready', $taskDetail, $you, 'your organization finishes the open tasks', null, 'Open tasks'),
            default => $check('tasks', 'Tasks', 'Not ready', $taskDetail, $assigneeName ?: $you, $assigneeName ? "{$assigneeName} finishes {$next->title}" : "your organization assigns {$next->title}", null, 'Open tasks'),
        };
        $tasksCheck['href'] = $this->linkTo($user, '/dashboard/tasks/task-board', '/dashboard/tasks/assigned-tasks');
        $tasksCheck['done_label'] = $tasks->isEmpty() ? 'No tasks' : "{$done} of {$tasks->count()}";
        $tasksCheck['overdue'] = $overdue->count();

        return [$approval, $venue, $budget, $files, $tasksCheck];
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
            $signedSigs = $sigs->whereIn('status', ['signed', 'approved', 'cleared']);
            $signed = $signedSigs->count();
            $signatory = fn ($sig) => match (Str::lower((string) $sig->required_role)) {
                'organization' => 'your organization',
                'department_head' => 'the Department Head',
                'sao' => 'the SAO',
                default => 'a signatory',
            };
            $named = fn ($group) => $this->joinPhrases($group->map($signatory)->unique()->values()->all());
            $clearanceSentences = array_values(array_filter([
                $signed > 0 ? ucfirst($named($signedSigs)).' '.($signed === 1 ? 'has' : 'have').' signed.' : null,
                $pending > 0 ? ucfirst($named($sigs->where('status', 'pending'))).' '.($pending === 1 ? 'has' : 'have').' not signed yet.' : null,
                $held > 0 ? ucfirst($named($sigs->where('status', 'held'))).' '.($held === 1 ? 'is' : 'are').' holding your clearance'
                    .(filled($sigs->where('status', 'held')->first()->remarks) ? ': "'.Str::limit(trim((string) $sigs->where('status', 'held')->first()->remarks), 160).'"' : '').'.' : null,
            ]));

            return [
                'title' => 'Your Clearance Signatories Breakdown',
                'answer' => $sigs->isEmpty()
                    ? 'No clearance signatures are assigned to your account yet.'
                    : implode(' ', $clearanceSentences),
                'highlights' => [
                    ['label' => 'Signed', 'value' => (string) $signed, 'tone' => 'success'],
                    ['label' => 'Pending', 'value' => (string) $pending, 'tone' => $pending > 0 ? 'warning' : 'neutral'],
                    ['label' => 'Held', 'value' => (string) $held, 'tone' => $held > 0 ? 'danger' : 'neutral'],
                ],
                'sections' => [
                    [
                        'id' => 'student-clearance-lines',
                        'title' => 'Signatory Statuses',
                        'description' => null,
                        'empty_message' => 'No active clearance period signatures are assigned to your account.',
                        'rows' => $sigs->map(fn ($sig) => [
                            'id' => 'sig-'.$sig->id,
                            'primary' => match (Str::lower((string) $sig->required_role)) {
                                'organization' => $sig->org_name ?: 'Your organization',
                                'department_head' => 'Department Head',
                                'sao' => 'SAO',
                                default => Str::headline((string) $sig->required_role),
                            },
                            'secondary' => $sig->remarks ?: match ($sig->status) {
                                'pending' => 'Has not signed yet',
                                'held' => 'On hold',
                                default => 'Cleared',
                            },
                            'status' => match ($sig->status) {
                                'pending' => 'Waiting for '.$signatory($sig),
                                'held' => 'Held by '.$signatory($sig),
                                default => Str::headline($sig->status),
                            },
                            'status_tone' => match ($sig->status) {
                                'held' => 'danger',
                                'pending' => 'warning',
                                default => 'success',
                            },
                            'meta' => $sig->signed_at ? Carbon::parse($sig->signed_at)->format('M j') : 'Open',
                            'href' => $this->linkTo($user, '/dashboard/my-clearance'),
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
            $query->where('clearance_signatures.required_role', 'department_head')
                ->whereIn('clearance_signatures.organization_id', $organizationIds->all());
        } else {
            $query->where('clearance_signatures.required_role', 'organization')
                ->where('clearance_signatures.organization_id', (int) $user->organization_id);
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

        $href = $this->linkTo(
            $user,
            $role === 'SUPER_ADMIN' ? '/dashboard/super-admin/clearances' : '/dashboard/clearances'
        );

        return [
            'title' => 'Pending & Held Student Clearances',
            'answer' => sprintf(
                '%d clearance %s waiting for your signature, and %d %s on hold.',
                $pendingCount,
                $pendingCount === 1 ? 'line is' : 'lines are',
                $heldCount,
                $heldCount === 1 ? 'is' : 'are'
            ),
            'highlights' => [
                ['label' => 'Pending signatures', 'value' => (string) $pendingCount, 'tone' => $pendingCount > 0 ? 'warning' : 'success'],
                ['label' => 'Held clearances', 'value' => (string) $heldCount, 'tone' => $heldCount > 0 ? 'danger' : 'neutral'],
            ],
            'sections' => [
                [
                    'id' => 'clearance-queue-rows',
                    'title' => 'Students Awaiting Clearance Action',
                    'description' => $this->showingFirst($pendingCount + $heldCount, 'most recently updated first'),
                    'empty_message' => 'All student clearance lines in your queue have been processed.',
                    'rows' => $rows->map(fn ($r) => [
                        'id' => 'clr-'.$r->id,
                        'primary' => "{$r->first_name} {$r->last_name} ({$r->school_id})",
                        'secondary' => $r->remarks ?: ($r->status === 'held' ? 'On hold' : 'Waiting for your signature'),
                        'status' => Str::headline($r->status),
                        'status_tone' => $r->status === 'held' ? 'danger' : 'warning',
                        'meta' => $r->status === 'held' ? 'On hold' : 'Waiting for your signature',
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
            : $user->electionOrganizationIds();
        $memberView = $role === 'STUDENT'
            || ($role === 'SBO_OFFICER' && $user->activeProfile() !== null && ! $user->activeProfile()->allowsModule('elections'));

        if ($memberView) {
            return $this->buildMemberElections($user);
        }

        $electionQuery = DB::table('elections')
            ->join('organizations', 'organizations.id', '=', 'elections.organization_id')
            ->whereIn('elections.organization_id', $orgIds)
            ->whereIn('elections.status', ['active', 'upcoming'])
            ->whereNull('elections.cancelled_at')
            ->when($memberView, fn ($elections) => $elections->whereNotNull('elections.finalized_at'))
            ->when(AcademicSemester::selected()?->id, fn ($elections, $semesterId) => $elections
                ->where(fn ($period) => $period->where('elections.academic_semester_id', $semesterId)->orWhereNull('elections.academic_semester_id')));
        $activeCount = (clone $electionQuery)->where('elections.status', 'active')->count();
        $upcomingCount = (clone $electionQuery)->where('elections.status', 'upcoming')->count();

        $elections = $electionQuery
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

        return [
            'title' => 'Active & Upcoming Elections',
            'answer' => sprintf(
                '%d %s open for voting now, and %d %s coming up.',
                $activeCount,
                $activeCount === 1 ? 'election is' : 'elections are',
                $upcomingCount,
                $upcomingCount === 1 ? 'election is' : 'elections are'
            ),
            'highlights' => [
                ['label' => 'Active elections', 'value' => (string) $activeCount, 'tone' => $activeCount > 0 ? 'primary' : 'neutral'],
                ['label' => 'Upcoming elections', 'value' => (string) $upcomingCount, 'tone' => 'neutral'],
            ],
            'sections' => [
                [
                    'id' => 'elections-status-list',
                    'title' => 'Elections Schedule',
                    'description' => $this->showingFirst($activeCount + $upcomingCount, 'closing soonest first'),
                    'empty_message' => 'No active or upcoming elections right now.',
                    'rows' => $elections->map(fn ($el) => [
                        'id' => 'el-'.$el->id,
                        'primary' => $el->title.' — '.($el->org_acronym ?: $el->org_name),
                        'secondary' => 'Closes '.Carbon::parse($el->end_time)->format('M j, Y g:i A'),
                        'status' => Str::headline($el->status),
                        'status_tone' => $el->status === 'active' ? 'success' : 'info',
                        'meta' => Carbon::parse($el->end_time)->diffForHumans(),
                        'href' => $this->linkTo($user, $el->status === 'active' ? '/dashboard/elections/cast-vote' : '/dashboard/elections/election-info', '/dashboard/elections'),
                        'action_label' => $el->status === 'active' ? 'Open election' : 'View details',
                    ])->all(),
                ],
            ],
            'follow_ups' => [
                ['topic' => 'daily_priorities', 'label' => 'What should I do today?', 'question' => 'What should I do today?'],
            ],
        ];
    }

    /** What a voter can do in each election open to them: vote now, already voted, not on the voter list, or wait. */
    private function buildMemberElections(User $user): array
    {
        $schoolId = (int) $user->school_id;
        $elections = Election::with('organization:id,name,acronym')
            ->whereIn('organization_id', $user->votingOrganizationIds())
            ->whereNull('cancelled_at')
            ->whereNotNull('finalized_at')
            ->where(fn ($open) => $open->whereIn('status', ['active', 'upcoming'])->orWhere('phase', 'runoff'))
            ->when(AcademicSemester::selected()?->id, fn ($query, $semesterId) => $query
                ->where(fn ($period) => $period->where('academic_semester_id', $semesterId)->orWhereNull('academic_semester_id')))
            ->orderBy('end_time')
            ->get();

        $counts = ['open' => 0, 'voted' => 0, 'unlisted' => 0];
        $upcoming = 0;
        $rows = [];
        foreach ($elections as $election) {
            $round = $election->openRound();
            $organization = $election->organization?->acronym ?: $election->organization?->name;
            $title = $election->title.($organization ? ' — '.$organization : '');

            if ($round === null) {
                if ($election->start_time === null || ! $election->start_time->isFuture()) {
                    continue;
                }
                $upcoming++;
                $rows[] = [
                    'id' => 'el-'.$election->id,
                    'primary' => $title,
                    'secondary' => 'Voting opens '.$election->start_time->format('M j, Y g:i A'),
                    'status' => 'Coming up',
                    'status_tone' => 'info',
                    'meta' => $election->start_time->diffForHumans(),
                    'href' => $this->linkTo($user, '/dashboard/elections/election-info', '/dashboard/elections'),
                    'action_label' => 'View details',
                ];

                continue;
            }

            $closes = $round === 2 ? $election->runoff_ends_at : $election->end_time;
            $state = match (true) {
                ElectionBallot::hasVoted($election->id, $schoolId, $round) => 'voted',
                ! $election->listsVoter($schoolId) => 'unlisted',
                default => 'open',
            };
            $counts[$state]++;

            $rows[] = [
                'id' => 'el-'.$election->id,
                'primary' => $title,
                'secondary' => ($round === 2 ? 'Runoff closes ' : 'Closes ').$closes->format('M j, Y g:i A'),
                'status' => ['voted' => 'You have voted', 'unlisted' => 'You are not on the voter list', 'open' => 'You can vote now'][$state],
                'status_tone' => ['voted' => 'success', 'unlisted' => 'warning', 'open' => 'info'][$state],
                'meta' => $closes->diffForHumans(),
                'href' => $state === 'open'
                    ? $this->linkTo($user, '/dashboard/elections/cast-vote', '/dashboard/elections')
                    : $this->linkTo($user, '/dashboard/elections/election-info', '/dashboard/elections'),
                'action_label' => $state === 'open' ? 'Cast vote' : 'View details',
            ];
        }

        ['open' => $canVote, 'voted' => $voted, 'unlisted' => $notListed] = $counts;
        $answer = $rows === []
            ? 'No election is open or coming up for you right now.'
            : sprintf('You can vote in %s now; you have already voted in %d.', $this->plural($canVote, 'election'), $voted)
                .($notListed > 0 ? ' You are not on the voter list for '.$this->plural($notListed, 'election').'.' : '')
                .($upcoming > 0 ? ' '.ucfirst($this->plural($upcoming, 'election')).' '.$this->be($upcoming).' coming up.' : '');

        return [
            'title' => 'Your Elections',
            'answer' => $answer,
            'highlights' => [
                ['label' => 'You can vote in', 'value' => (string) $canVote, 'tone' => $canVote > 0 ? 'primary' : 'neutral'],
                ['label' => 'Already voted', 'value' => (string) $voted, 'tone' => $voted > 0 ? 'success' : 'neutral'],
                ['label' => 'Coming up', 'value' => (string) $upcoming, 'tone' => 'neutral'],
            ],
            'sections' => [
                [
                    'id' => 'elections-status-list',
                    'title' => 'Elections Schedule',
                    'description' => $this->showingFirst(count($rows), 'closing soonest first'),
                    'empty_message' => 'No active or upcoming elections right now.',
                    'rows' => array_slice($rows, 0, self::ROW_LIMIT),
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
        if ($user->role === 'STUDENT') {
            return $this->buildOwnGrievances($user);
        }

        if (! in_array($user->role, ['SUPER_ADMIN', 'ADMIN'], true)) {
            return [
                'title' => 'Student Grievances',
                'answer' => 'Grievances are read by the organization head and the SAO, so there is no grievance queue on your account.',
                'highlights' => [],
                'sections' => [],
                'follow_ups' => [
                    ['topic' => 'daily_priorities', 'label' => 'What should I do today?', 'question' => 'What should I do today?'],
                ],
            ];
        }

        $isSao = $user->role === 'SUPER_ADMIN';
        $grievanceQuery = $this->openGrievancesQuery()->when(! $isSao, fn ($rows) => $rows->where('organization_id', $user->organization_id));
        $openCount = (clone $grievanceQuery)->count();
        $urgentCount = (clone $grievanceQuery)->whereRaw('LOWER(urgency) in (?, ?)', ['high', 'critical'])->count();
        $openGrievances = $grievanceQuery
            ->orderByRaw("CASE WHEN LOWER(urgency) = 'critical' THEN 0 WHEN LOWER(urgency) = 'high' THEN 1 WHEN LOWER(urgency) = 'medium' THEN 2 ELSE 3 END")
            ->orderByDesc('created_at')
            ->limit(self::ROW_LIMIT)
            ->get(['id', 'title', 'category', 'urgency', 'status', 'created_at']);

        $href = $this->linkTo($user, $isSao ? '/dashboard/super-admin/grievances' : '/dashboard/grievances');

        return [
            'title' => $isSao ? 'Student Grievance Queue (SAO)' : 'Grievances Addressed to Your Organization',
            'answer' => sprintf(
                '%d %s unresolved, and %d of them %s high or critical urgency.',
                $openCount,
                $openCount === 1 ? 'grievance is' : 'grievances are',
                $urgentCount,
                $this->be($urgentCount)
            ),
            'highlights' => [
                ['label' => 'Unresolved grievances', 'value' => (string) $openCount, 'tone' => $openCount > 0 ? 'warning' : 'success'],
                ['label' => 'High / critical urgency', 'value' => (string) $urgentCount, 'tone' => $urgentCount > 0 ? 'danger' : 'neutral'],
            ],
            'sections' => [
                [
                    'id' => $isSao ? 'sao-grievances-list' : 'org-grievances-list',
                    'title' => 'Open Student Grievances',
                    'description' => 'Most urgent first. Student names are not shown here.'.($openCount > self::ROW_LIMIT ? ' Showing the first '.self::ROW_LIMIT." of {$openCount}." : ''),
                    'empty_message' => 'No unresolved student grievances in the queue.',
                    'rows' => $openGrievances->map(fn ($g) => [
                        'id' => 'grv-'.$g->id,
                        'primary' => $g->title ?: ('Grievance #'.$g->id),
                        'secondary' => 'Category: '.Str::headline($g->category ?: 'General'),
                        'status' => Str::headline($g->urgency ?: 'normal').' urgency',
                        'status_tone' => in_array(Str::lower((string) $g->urgency), ['high', 'critical'], true) ? 'danger' : 'warning',
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

    /** A student's own grievances: the same list the My grievances page opens, with status only. */
    private function buildOwnGrievances(User $user): array
    {
        $own = DB::table('grievances')->whereNull('deleted_at')->where('submitted_by', $user->school_id);
        $filed = (clone $own)->count();
        $open = (clone $own)->whereNotIn('status', ['resolved', 'dismissed'])->count();
        $grievances = $own->orderByDesc('created_at')->orderByDesc('id')->limit(self::ROW_LIMIT)->get(['id', 'title', 'category', 'status', 'created_at']);
        $href = $this->linkTo($user, '/dashboard/my-grievances');

        return [
            'title' => 'Your Grievances',
            'answer' => $filed === 0
                ? 'You have not filed a grievance. If you have a concern, you can file it on the My grievances page.'
                : sprintf('You have filed %s, and %s still open.', $this->plural($filed, 'grievance'), $open === 0 ? 'none is' : $open.' '.($open === 1 ? 'is' : 'are')),
            'highlights' => [
                ['label' => 'Filed by you', 'value' => (string) $filed, 'tone' => 'neutral'],
                ['label' => 'Still open', 'value' => (string) $open, 'tone' => $open > 0 ? 'warning' : 'success'],
            ],
            'sections' => [
                [
                    'id' => 'own-grievances-list',
                    'title' => 'Your Grievances',
                    'description' => $this->showingFirst($filed, 'newest first'),
                    'empty_message' => 'You have not filed a grievance.',
                    'rows' => $grievances->map(fn ($g) => [
                        'id' => 'grv-'.$g->id,
                        'primary' => $g->title ?: ('Grievance #'.$g->id),
                        'secondary' => 'Category: '.Str::headline($g->category ?: 'General').' · Filed '.Carbon::parse($g->created_at)->format('M j, Y'),
                        'status' => Str::headline($g->status),
                        'status_tone' => in_array($g->status, ['resolved', 'dismissed'], true) ? 'success' : 'warning',
                        'meta' => null,
                        'href' => $href,
                        'action_label' => 'Open',
                    ])->all(),
                ],
            ],
            'follow_ups' => [
                ['topic' => 'daily_priorities', 'label' => 'What do I need to do today?', 'question' => 'What do I need to do today?'],
            ],
        ];
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private function missingComplianceRequirementsForOrganization(int $organizationId, ?User $user = null): array
    {
        $academicYear = $this->accreditation->currentAcademicYear();
        if ($academicYear === null) {
            return [];
        }

        $semesterId = AcademicSemester::active()?->id;
        $requirementTypes = ComplianceRequirementType::inYear($academicYear, AcademicSemester::active()?->academic_year_id)
            ->where('is_active', true)
            ->where('category', 'organization')
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
                    'href' => $user ? $this->linkTo($user, '/dashboard/compliance') : null,
                    'action_label' => 'Upload',
                ];
            }
        }

        return $missing;
    }

    /** The first path the signed-in profile may open, so a link is never one the client sends the person away from. The dean's office staff open every page the dean does, as well as their own home. */
    private function linkTo(User $user, string ...$paths): ?string
    {
        $roles = array_values(array_unique([(string) $user->profileRole(), $user->approvalRole()]));
        foreach ($paths as $path) {
            foreach ($roles as $role) {
                $href = $this->routeAccess->hrefFor($role, $path);
                if ($href !== null) {
                    return $href;
                }
            }
        }

        return null;
    }

    private function complianceReviewLink(User $user, string $saoPath, string $organizationPath): ?string
    {
        return $this->linkTo($user, ...match ($user->role) {
            'SUPER_ADMIN' => [$saoPath],
            'DEPARTMENT_HEAD' => ['/dashboard/department-head/compliance', '/dashboard/department-head/documents'],
            default => [$organizationPath],
        });
    }

    private function showingFirst(int $total, ?string $order = null): ?string
    {
        if ($total === 0) {
            return null;
        }

        if ($total > self::ROW_LIMIT) {
            return 'Showing the first '.self::ROW_LIMIT." of {$total}".($order ? ", {$order}." : '.');
        }

        return $order ? ucfirst($order).'.' : null;
    }

    private function scopedStudentOrganizationIds(User $user, bool $activeOnly = true): Collection
    {
        if ($user->role === 'SUPER_ADMIN') {
            return DB::table('organizations')
                ->where('organization_type', 'STUDENT_ORGANIZATION')
                ->when($activeOnly, fn ($organizations) => $organizations->where('lifecycle_status', 'active'))
                ->pluck('id');
        }

        if ($user->role === 'DEPARTMENT_HEAD') {
            $scoped = collect($user->scopedOrganizationIds());

            return $activeOnly ? $this->activeOrganizationIds($scoped) : $scoped;
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

    private function enrichWithFormattedBlocksAndCharts(array $payload, string $intent): array
    {
        $sections = array_map(function (array $section): array {
            $rows = array_map(function (array $row): array {
                $row['progress_percent'] = $this->inferRowProgressPercent($row);
                if (($row['href'] ?? null) === null) {
                    unset($row['action_label']);
                }

                return $row;
            }, $section['rows'] ?? []);
            $section['rows'] = $rows;

            return $section;
        }, $payload['sections'] ?? []);

        $payload['sections'] = $sections;
        $payload['charts'] = $this->buildChartsForPayload($payload, $intent);
        $payload['formatted_blocks'] = $this->buildFormattedBlocks($payload);

        return $payload;
    }

    private function inferRowProgressPercent(array $row): ?int
    {
        if (isset($row['progress_percent']) && is_numeric($row['progress_percent'])) {
            return max(0, min(100, (int) round((float) $row['progress_percent'])));
        }

        $meta = (string) ($row['meta'] ?? '');
        if (preg_match('/^(\d+)\s*\/\s*(\d+)/', $meta, $matches)) {
            $num = (int) $matches[1];
            $den = (int) $matches[2];

            return $den > 0 ? max(0, min(100, (int) round(($num / $den) * 100))) : 0;
        }

        if (preg_match('/(\d+(?:\.\d+)?)%\s*complete/i', $meta, $matches)) {
            return max(0, min(100, (int) round((float) $matches[1])));
        }

        return null;
    }

    private function buildChartsForPayload(array $payload, string $intent): array
    {
        $allRows = collect($payload['sections'] ?? [])
            ->filter(fn (array $sec) => ($sec['layout'] ?? null) !== 'steps')
            ->flatMap(fn (array $sec) => $sec['rows'] ?? []);
        $grouped = $allRows->groupBy(fn (array $row) => $row['status'] ?? 'Listed');

        if ($allRows->count() < 6 || $grouped->count() < 3) {
            return [];
        }

        $totalRows = $allRows->count();
        $statusItems = [];

        foreach ($grouped as $statusLabel => $groupRows) {
            $first = $groupRows->first();
            $count = $groupRows->count();
            $statusItems[] = [
                'label' => (string) $statusLabel,
                'value' => $count,
                'display_value' => $count.' '.($count === 1 ? 'item' : 'items'),
                'percent' => max(8, min(100, (int) round(($count / $totalRows) * 100))),
                'share_percent' => (int) round(($count / $totalRows) * 100),
                'tone' => (string) ($first['status_tone'] ?? 'primary'),
            ];
        }

        return [[
            'id' => $intent.'-status-distribution',
            'type' => 'distribution',
            'title' => 'Record Status Breakdown',
            'subtitle' => 'Across '.$this->plural($totalRows, 'record'),
            'items' => array_values($statusItems),
        ]];
    }

    private function buildFormattedBlocks(array $payload): array
    {
        $allRows = collect($payload['sections'] ?? [])->flatMap(fn (array $sec) => $sec['rows'] ?? []);
        $topRows = $allRows->take(4)->map(fn (array $row) => [
            'label' => $row['primary'] ?? '',
            'detail' => $row['secondary'] ?? '',
            'status' => $row['status'] ?? null,
            'status_tone' => $row['status_tone'] ?? 'neutral',
            'meta' => $row['meta'] ?? null,
            'href' => $row['href'] ?? null,
            'action_label' => $row['action_label'] ?? 'Open',
        ])->values()->all();

        $firstActionRow = $allRows->first(fn (array $row) => ! empty($row['href']));

        return [
            'headline' => $payload['title'] ?? 'AI Operational Briefing',
            'summary' => $payload['answer'] ?? '',
            'key_findings' => $topRows,
            'recommended_action' => $firstActionRow ? [
                'title' => $firstActionRow['primary'],
                'detail' => $firstActionRow['secondary'] ?? 'Highest priority item requiring attention.',
                'href' => $firstActionRow['href'],
                'action_label' => $firstActionRow['action_label'] ?? 'Open record',
            ] : null,
        ];
    }

    private function enhanceWithModel(User $user, string $question, array $payload, array $rag = []): ?array
    {
        $chunks = array_slice($rag['chunks'] ?? [], 0, 8);
        $topChunks = array_map(fn (array $chunk) => [
            'domain' => $chunk['domain'],
            'primary' => $chunk['primary'],
            'secondary' => $chunk['secondary'],
            'status' => $chunk['status'],
            'meta' => $chunk['meta'],
            'quoted_text' => ($chunk['quotable'] ?? false) ? $chunk['excerpt'] ?? null : null,
        ], $chunks);
        $chunksById = collect($rag['chunks'] ?? [])->keyBy('id');

        $facts = [
            'role' => $user->role,
            'position' => $this->positionTitle($user),
            'question' => $question,
            'deterministic_answer' => $payload['answer'],
            'highlights' => $payload['highlights'],
            'retrieved_rag_chunks' => $topChunks,
            'sections' => array_map(fn (array $s) => [
                'title' => $s['title'],
                'rows' => array_map(function (array $row) use ($chunksById): array {
                    $chunk = $chunksById->get($row['id'] ?? null);
                    if ($chunk !== null) {
                        $row['secondary'] = $chunk['secondary'];
                        $row['quoted_text'] = ($chunk['quotable'] ?? false) ? $chunk['excerpt'] ?? null : null;
                    }

                    return $row;
                }, array_slice($s['rows'] ?? [], 0, 6)),
            ], $payload['sections'] ?? []),
        ];

        $result = $this->ai->generate(
            instructions: AiInstructions::askAi(),
            input: json_encode($facts, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
            maxOutputTokens: 280,
            temperature: 0.1,
        );

        if ($result === null) {
            return null;
        }

        $plain = $this->ai->plainText($result['text']);
        if ($plain === '' || ! $this->ai->preservesNumericFacts($plain, $facts) || $this->namesPersonNotInFacts($plain, $facts)) {
            return null;
        }

        return [
            'text' => $plain,
            'model' => $result['model'],
        ];
    }

    /**
     * Words that start a sentence or name a role or a page in everyday answers. A run of capitalised words made only of
     * these and of words the facts contain is not a person the model made up.
     */
    private const COMMON_CAPITALISED_WORDS = [
        'a', 'about', 'after', 'all', 'also', 'an', 'and', 'any', 'are', 'as', 'ask', 'at', 'because', 'before', 'both', 'but', 'by',
        'check', 'choose', 'click', 'contact', 'create', 'do', 'each', 'every', 'finally', 'first', 'for', 'from', 'go', 'good', 'great',
        'have', 'here', 'how', 'if', 'in', 'is', 'it', 'its', 'just', 'keep', 'make', 'next', 'no', 'not', 'note', 'now', 'of', 'on',
        'once', 'only', 'open', 'or', 'our', 'please', 'remember', 'review', 'see', 'select', 'send', 'so', 'some', 'start', 'still',
        'that', 'the', 'then', 'there', 'these', 'they', 'this', 'those', 'tip', 'to', 'today', 'tomorrow', 'use', 'visit', 'we', 'what',
        'when', 'where', 'which', 'while', 'who', 'why', 'with', 'yes', 'yesterday', 'you', 'your',
        'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
        'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
        'admin', 'affairs', 'college', 'dean', 'department', 'head', 'officer', 'officers', 'office', 'organization', 'organizations',
        'record', 'records', 'search', 'student', 'students', 'super',
    ];

    /**
     * True when the text names someone: two or more capitalised words in a row, one of which neither the facts sent to the
     * model nor everyday wording explains. A made-up name is refused the way a made-up number is, and the record answer
     * is shown instead. Refusing too much is safe; showing an invented person is not.
     */
    private function namesPersonNotInFacts(string $text, array $facts): bool
    {
        // A run after "the" or before page, section and similar words is the name of a page, not of a person.
        $capitalisedRun = '/(?<!\bthe )(?<!\bThe )\b(?>\p{Lu}\p{Ll}{1,24}(?: \p{Lu}\p{Ll}{1,24}){1,4})\b(?! (?:page|pages|section|tab|screen|form|report|module|list|menu|board|calendar|view|dashboard)\b)/u';
        if (preg_match_all($capitalisedRun, $text, $runs) === 0 || $runs[0] === []) {
            return false;
        }

        $factText = json_encode($facts, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) ?: '';
        preg_match_all('/\p{L}{2,40}/u', $factText, $factWords);
        $known = array_flip(array_map(fn (string $word) => mb_strtolower($word), $factWords[0]));
        $common = array_flip(self::COMMON_CAPITALISED_WORDS);

        foreach ($runs[0] as $run) {
            foreach (explode(' ', $run) as $word) {
                $lower = mb_strtolower($word);
                if (! isset($known[$lower]) && ! isset($common[$lower])) {
                    return true;
                }
            }
        }

        return false;
    }

    // -------------------------------------------------------------------------
    // Hybrid Semantic Search & Retrieval-Augmented Generation (RAG) Engine
    // -------------------------------------------------------------------------

    private function retrieveRagContext(User $user, string $question, Collection $organizationIds, bool $build = true): array
    {
        $corpus = $build ? $this->buildKnowledgeCorpus($user, $organizationIds, $question) : [];
        $corpusSize = count($corpus);
        $domainsSearched = collect($corpus)->pluck('domain')->unique()->count();

        $queryTokens = $this->tokenizeWithSynonyms($question);
        $rawQueryTokens = $this->extractRawTokens($question);
        $queryVector = $this->computeSemanticVector($question);
        $matchedConcepts = $this->activeConceptLabels($queryVector);

        if ($corpusSize === 0) {
            return [
                'chunks' => [],
                'corpus_size' => 0,
                'domains_searched' => 0,
                'matched_concepts' => $matchedConcepts,
                'matched_entities' => [],
                'top_confidence' => 0,
            ];
        }

        // Document frequencies for BM25, with each document tokenised once
        $docTokens = [];
        $docFreq = [];
        $totalLength = 0;

        foreach ($corpus as $idx => $doc) {
            $docTokens[$idx] = $this->extractRawTokens($doc['search_text']);
            $totalLength += max(1, count($docTokens[$idx]));
            foreach (array_unique($docTokens[$idx]) as $tok) {
                $docFreq[$tok] = ($docFreq[$tok] ?? 0) + 1;
            }
        }

        $avgDocLength = $totalLength / max(1, $corpusSize);
        $matchedEntities = [];
        $scored = [];
        $questionLower = Str::lower($question);

        foreach ($corpus as $idx => $doc) {
            $bm25 = $this->bm25Score($queryTokens, $docTokens[$idx], $docFreq, $corpusSize, max(1, count($docTokens[$idx])), $avgDocLength);

            $docVector = $this->computeSemanticVector($doc['search_text']);
            $cosine = $this->cosineSimilarity($queryVector, $docVector);

            // Entity & exact phrase matching boost
            $entityBoost = 0.0;
            $namesEntity = false;
            $primaryLower = Str::lower($doc['primary'].' '.($doc['secondary'] ?? ''));
            foreach ($doc['entity_terms'] ?? [] as $entityTerm) {
                $entityLower = Str::lower(trim((string) $entityTerm));
                if ($entityLower !== '' && strlen($entityLower) >= 3 && $this->containsWord($questionLower, $entityLower)) {
                    $entityBoost += 1.6;
                    $namesEntity = true;
                    $matchedEntities[$entityTerm] = $entityTerm;
                }
            }

            foreach ($rawQueryTokens as $rTok) {
                if (strlen($rTok) >= 3 && Str::contains($primaryLower, $rTok)) {
                    $entityBoost += 0.45;
                }
            }

            $trigram = $this->trigramSimilarity($question, $doc['primary']);

            // Combined hybrid relevance score
            $rawScore = ($bm25 * 0.42) + ($cosine * 1.35) + $entityBoost + ($trigram * 0.65);

            if ($rawScore > 0.12) {
                $confidence = max(15, min(99, (int) round(min(1.0, $rawScore / 2.2) * 100)));
                $doc['relevance_score'] = round($rawScore, 4);
                $doc['relevance_percent'] = $confidence;
                $doc['names_entity'] = $namesEntity;
                $scored[] = $doc;
            }
        }

        usort($scored, fn (array $a, array $b) => $b['relevance_score'] <=> $a['relevance_score']);
        $topChunks = array_slice($scored, 0, 16);
        $topConfidence = $topChunks !== [] ? (int) $topChunks[0]['relevance_percent'] : 0;

        return [
            'chunks' => $topChunks,
            'corpus_size' => $corpusSize,
            'domains_searched' => $domainsSearched,
            'matched_concepts' => $matchedConcepts !== [] ? $matchedConcepts : ['General Operational Knowledge'],
            'matched_entities' => array_values($matchedEntities),
            'top_confidence' => $topConfidence,
        ];
    }

    private function containsWord(string $haystack, string $needle): bool
    {
        return preg_match('/(?<![\pL\pN])'.preg_quote($needle, '/').'(?![\pL\pN])/u', $haystack) === 1;
    }

    /** What a person reads under a record: the facts, then the free text somebody typed into it. */
    private function displaySecondary(array $chunk): string
    {
        return $chunk['secondary'].(! empty($chunk['excerpt']) ? ' · '.$chunk['excerpt'] : '');
    }

    private function buildSemanticRagPayload(User $user, string $question, array $rag, Collection $organizationIds): array
    {
        $chunks = collect($rag['chunks'] ?? []);

        if ($chunks->isEmpty()) {
            $fallback = $this->buildDailyPriorities($user, $organizationIds);
            $fallback['title'] = 'Search results and briefing';
            $fallback['answer'] = sprintf(
                'I looked through %s your account can open for "%s" and found no close match, so here is your briefing and priority queue.',
                $this->plural((int) ($rag['corpus_size'] ?? 0), 'record'),
                $question
            );

            return $fallback;
        }

        $grouped = $chunks->groupBy('domain');
        $sections = [];

        foreach ($grouped as $domainTitle => $domainChunks) {
            $sections[] = [
                'id' => 'rag-sec-'.Str::slug((string) $domainTitle),
                'title' => (string) $domainTitle,
                'description' => sprintf('Records that match "%s".', Str::limit($question, 48)),
                'empty_message' => 'No records here.',
                'rows' => $domainChunks->take(10)->map(fn (array $c) => [
                    'id' => $c['id'],
                    'primary' => $c['primary'],
                    'secondary' => $this->displaySecondary($c),
                    'status' => $c['status'],
                    'status_tone' => $c['status_tone'],
                    'meta' => $c['meta'],
                    'progress_percent' => $c['progress_percent'] ?? null,
                    'href' => $c['href'],
                    'action_label' => $c['action_label'] ?? 'Open',
                ])->values()->all(),
            ];
        }

        $topThree = $chunks->take(3)->map(
            fn (array $c) => Str::contains($c['primary'], $c['status']) ? $c['primary'] : sprintf('%s (%s)', $c['primary'], $c['status'])
        )->implode('; ');

        $actionNeededCount = $chunks->filter(
            fn (array $c) => in_array($c['status_tone'], ['danger', 'warning'], true)
        )->count();

        $answer = sprintf(
            'Found %s out of %d checked. The closest: %s.',
            $this->plural($chunks->count(), 'record'),
            $rag['corpus_size'] ?? $chunks->count(),
            $topThree
        );

        $highlights = [
            [
                'label' => 'Matching records',
                'value' => (string) $chunks->count(),
                'tone' => 'primary',
            ],
            [
                'label' => 'Sections matched',
                'value' => (string) $grouped->count(),
                'tone' => 'success',
            ],
            [
                'label' => 'Needs attention',
                'value' => (string) $actionNeededCount,
                'tone' => $actionNeededCount > 0 ? 'warning' : 'success',
            ],
        ];

        $followUps = array_map(
            fn (array $prompt) => ['topic' => $prompt['topic'], 'label' => $prompt['label'], 'question' => $prompt['question']],
            array_slice($this->starterPrompts($user), 0, 3)
        );

        return [
            'title' => 'Records matching: '.Str::limit($question, 54),
            'answer' => $answer,
            'highlights' => $highlights,
            'sections' => $sections,
            'follow_ups' => $followUps,
        ];
    }

    private function augmentWithRagMatches(array $payload, array $rag): array
    {
        $matchedEntities = $rag['matched_entities'] ?? [];
        $chunks = collect($rag['chunks'] ?? []);

        if ($chunks->isEmpty()) {
            return $payload;
        }

        $existingIds = collect($payload['sections'] ?? [])
            ->flatMap(fn (array $s) => collect($s['rows'] ?? [])->pluck('primary'))
            ->map(fn ($t) => Str::lower((string) $t))
            ->all();

        $highConfidenceExtras = $chunks
            ->filter(fn (array $c) => ($c['names_entity'] ?? false) && ($c['relevance_percent'] ?? 0) >= 65 && ! in_array(Str::lower($c['primary']), $existingIds, true))
            ->take(3)
            ->values();

        if ($matchedEntities !== [] && $highConfidenceExtras->isNotEmpty()) {
            $payload['sections'][] = [
                'id' => 'rag-augmented-context',
                'title' => 'Related records',
                'description' => 'Other records that mention '.implode(', ', array_slice($matchedEntities, 0, 3)).'.',
                'empty_message' => 'No other records match.',
                'rows' => $highConfidenceExtras->map(fn (array $c) => [
                    'id' => $c['id'],
                    'primary' => $c['primary'],
                    'secondary' => $this->displaySecondary($c),
                    'status' => $c['status'],
                    'status_tone' => $c['status_tone'],
                    'meta' => $c['meta'],
                    'progress_percent' => $c['progress_percent'] ?? null,
                    'href' => $c['href'],
                    'action_label' => $c['action_label'] ?? 'Open',
                ])->all(),
            ];
        }

        return $payload;
    }

    private const CORPUS_PAGES = [
        'organizations' => ['SUPER_ADMIN' => '/dashboard/super-admin/organizations', 'DEPARTMENT_HEAD' => '/dashboard/department-head/organizations', 'ADMIN' => '/dashboard/compliance'],
        'leaders' => ['SUPER_ADMIN' => '/dashboard/super-admin/users', 'DEPARTMENT_HEAD' => '/dashboard/department-head/people', 'ADMIN' => '/dashboard/admin/users', 'SBO_OFFICER' => '/dashboard/admin/users'],
        'budgets' => ['DEPARTMENT_HEAD' => '/dashboard/finance/budget-allocation', 'ADMIN' => '/dashboard/finance/budget-allocation', 'SBO_OFFICER' => '/dashboard/finance/budget-allocation'],
        'ledger' => ['DEPARTMENT_HEAD' => '/dashboard/finance/financial-ledger', 'ADMIN' => '/dashboard/finance/financial-ledger', 'SBO_OFFICER' => '/dashboard/finance/financial-ledger'],
        'merchandise' => ['ADMIN' => '/dashboard/merchandise/manage-inventory', 'SBO_OFFICER' => '/dashboard/merchandise/order-merchandise', 'STUDENT' => '/dashboard/merchandise/order-merchandise'],
        'events' => ['ADMIN' => '/dashboard/events/manage-events', 'SBO_OFFICER' => '/dashboard/events/activity-calendar', 'DEPARTMENT_HEAD' => '/dashboard/events/activity-calendar', 'STUDENT' => '/dashboard/events/activity-calendar'],
        'venues' => ['SUPER_ADMIN' => '/dashboard/super-admin/venues', 'ADMIN' => '/dashboard/venues', 'SBO_OFFICER' => '/dashboard/venues'],
        'tasks' => ['ADMIN' => '/dashboard/tasks/task-board', 'SBO_OFFICER' => '/dashboard/tasks/assigned-tasks'],
        'candidates' => ['ADMIN' => '/dashboard/elections/manage-candidates', 'SBO_OFFICER' => '/dashboard/elections', 'DEPARTMENT_HEAD' => '/dashboard/elections', 'STUDENT' => '/dashboard/elections'],
        'announcements' => ['SUPER_ADMIN' => '/dashboard/super-admin/announcements', 'ADMIN' => '/dashboard/announcements/view-announcements', 'SBO_OFFICER' => '/dashboard/announcements/view-announcements', 'DEPARTMENT_HEAD' => '/dashboard/announcements/view-announcements', 'STUDENT' => '/dashboard/announcements/view-announcements'],
        'compliance' => ['SUPER_ADMIN' => '/dashboard/super-admin/compliance', 'DEPARTMENT_HEAD' => '/dashboard/department-head/compliance', 'ADMIN' => '/dashboard/compliance'],
    ];

    /** The dean's office staff open documents where a Department Head opens college compliance. */
    private const CORPUS_FALLBACKS = ['compliance' => '/dashboard/department-head/documents'];

    /** The sidebar name of the screen where this person reviews accreditation requirements, null when they have none. */
    private function complianceScreenName(User $user): ?string
    {
        $href = $this->corpusHref($user, 'compliance');
        if ($href === null) {
            return null;
        }
        $path = parse_url($href, PHP_URL_PATH) ?: $href;
        $screen = collect(app(HowToGuideLibrary::class)->screensFor($user))->first(fn (array $row) => $row['href'] === $path);

        return $screen['screen'] ?? null;
    }

    private function corpusHref(User $user, string $page): ?string
    {
        return $this->linkTo($user, ...array_filter([self::CORPUS_PAGES[$page][$user->role] ?? null, $user->role === 'DEPARTMENT_HEAD' ? (self::CORPUS_FALLBACKS[$page] ?? null) : null]));
    }

    /** @return array{0: string, 1: array<int, string>}|null an ORDER BY that puts rows matching a word of the question first, or null when the question has no searchable word */
    private function questionPriority(string $question, array $columns): ?array
    {
        $terms = array_slice(array_values(array_filter($this->extractRawTokens($question), fn (string $t) => strlen($t) >= 3)), 0, 8);
        if ($terms === []) {
            return null;
        }

        $clauses = [];
        $bindings = [];
        foreach ($terms as $term) {
            foreach ($columns as $column) {
                $clauses[] = "LOWER({$column}) LIKE ?";
                $bindings[] = '%'.$term.'%';
            }
        }

        return ['CASE WHEN '.implode(' OR ', $clauses).' THEN 0 ELSE 1 END', $bindings];
    }

    private function buildKnowledgeCorpus(User $user, Collection $organizationIds, string $question = ''): array
    {
        $role = $user->role;
        $orgIds = in_array($role, ['SUPER_ADMIN', 'DEPARTMENT_HEAD'], true)
            ? $organizationIds->map(fn ($id) => (int) $id)->all()
            : [(int) $user->organization_id];

        if ($orgIds === []) {
            return [];
        }

        $corpus = [];
        $showCompliance = $role !== 'STUDENT' && $this->moduleAllowed($user, 'compliance');

        // 1. Organizations & Accreditation Status
        $orgPriority = $this->questionPriority($question, ['name', 'acronym', 'college']);
        $organizations = DB::table('organizations')
            ->whereIn('id', $orgIds)
            ->when($orgPriority !== null, fn ($query) => $query->orderByRaw($orgPriority[0], $orgPriority[1]))
            ->orderBy('name')
            ->limit(30)
            ->get(['id', 'name', 'acronym', 'college', 'lifecycle_status', 'is_university_wide', 'review_remarks']);

        $accreditationByOrg = $this->accreditation->forOrganizations($organizations->pluck('id'));
        $reviewScreen = $showCompliance ? $this->complianceScreenName($user) : null;

        foreach ($organizations as $org) {
            $accStatus = $accreditationByOrg[$org->id] ?? 'incomplete';
            $label = ($org->acronym ? "{$org->acronym} — " : '').$org->name;
            // An accreditation that is not settled is read and followed up on the compliance screen, never on Organization applications, which only decides new organizations.
            $followUp = $reviewScreen !== null && in_array($accStatus, ['incomplete', 'returned', 'pending_review'], true) ? ' · Review its accreditation in '.$reviewScreen : '';

            $corpus[] = [
                'id' => 'rag-org-'.$org->id,
                'domain' => 'Organizations & Accreditation',
                'primary' => $label,
                'secondary' => sprintf(
                    'College: %s · Status: %s · Accreditation: %s%s',
                    $org->college ?: ($org->is_university_wide ? 'University-wide' : 'General'),
                    Str::headline((string) $org->lifecycle_status),
                    Str::headline((string) $accStatus),
                    $followUp
                ),
                'excerpt' => $showCompliance && $org->review_remarks ? "Remarks: {$org->review_remarks}" : null,
                'quotable' => true,
                'status' => Str::headline((string) $org->lifecycle_status),
                'status_tone' => $org->lifecycle_status === 'active' ? match ($accStatus) {
                    'accredited' => 'success',
                    'not_applicable' => 'neutral',
                    default => 'warning',
                } : 'danger',
                'meta' => 'Accreditation: '.Str::headline((string) $accStatus),
                'progress_percent' => match ($accStatus) {
                    'accredited' => 100,
                    'pending_review' => 75,
                    'returned' => 35,
                    'not_applicable' => null,
                    default => 50,
                },
                'href' => $this->corpusHref($user, 'organizations'),
                'action_label' => 'View organization',
                'entity_terms' => array_filter([$org->name, $org->acronym, $org->college]),
                'search_text' => implode(' ', array_filter([
                    'organization club society council accreditation registration status',
                    $org->name,
                    $org->acronym,
                    $org->college,
                    $org->lifecycle_status,
                    $accStatus,
                    $showCompliance ? $org->review_remarks : null,
                ])),
            ];
        }

        // 2. Leadership, Admins & Officers Directory: one row per active profile, so an officer added to a second organization is listed there.
        $showLeaders = $role === 'STUDENT' || $this->moduleAllowed($user, 'members');
        $showContact = $role !== 'STUDENT';
        $leaderPriority = $this->questionPriority($question, ['users.first_name', 'users.last_name', 'account_profiles.position_title', 'organizations.name', 'organizations.acronym']);
        $leaders = $showLeaders
            ? DB::table('account_profiles')
                ->join('users', 'users.school_id', '=', 'account_profiles.user_school_id')
                ->leftJoin('organizations', 'organizations.id', '=', 'account_profiles.organization_id')
                ->where(function ($q) use ($orgIds, $role) {
                    $q->whereIn('account_profiles.organization_id', $orgIds);
                    if ($role === 'SUPER_ADMIN') {
                        $q->orWhere('account_profiles.role', 'DEPARTMENT_HEAD');
                    }
                })
                ->whereIn('account_profiles.role', ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD'])
                ->where('account_profiles.account_status', 'active')
                ->where('users.account_status', 'active')
                ->when($leaderPriority !== null, fn ($query) => $query->orderByRaw($leaderPriority[0], $leaderPriority[1]))
                ->orderBy('organizations.name')
                ->orderBy('account_profiles.role')
                ->orderBy('users.last_name')
                ->limit(60)
                ->get([
                    'account_profiles.id as profile_id',
                    'users.school_id',
                    'users.first_name',
                    'users.last_name',
                    'account_profiles.role',
                    'account_profiles.position_title',
                    'users.email',
                    'users.department',
                    'organizations.name as org_name',
                    'organizations.acronym as org_acronym',
                ])
            : collect();

        foreach ($leaders as $leader) {
            $fullName = trim($leader->first_name.' '.$leader->last_name);
            $orgLabel = $leader->org_acronym ?: ($leader->org_name ?: ($leader->department ?: 'Campus'));
            $position = $leader->position_title ?: $this->roleTitle($leader->role);

            $corpus[] = [
                'id' => 'rag-leader-'.$leader->profile_id,
                'domain' => 'Leadership & Officers Directory',
                'primary' => "{$fullName} ({$position})",
                'secondary' => $showContact
                    ? sprintf(
                        'Organization: %s · Role: %s · ID: %s · Email: %s',
                        $orgLabel,
                        $this->roleTitle($leader->role),
                        $leader->school_id,
                        $leader->email
                    )
                    : sprintf('Organization: %s · Role: %s', $orgLabel, $this->roleTitle($leader->role)),
                'status' => $position,
                'status_tone' => $leader->role === 'ADMIN' ? 'success' : 'info',
                'meta' => $showContact ? 'ID #'.$leader->school_id : $orgLabel,
                'href' => $this->corpusHref($user, 'leaders'),
                'action_label' => 'Directory',
                'entity_terms' => array_filter([$fullName, trim($leader->last_name.' '.$leader->first_name), $showContact ? (string) $leader->school_id : null]),
                'search_text' => implode(' ', array_filter([
                    'who is officer leader admin president vice secretary treasurer auditor adviser dean directory roster member position email contact',
                    $fullName,
                    $position,
                    $leader->role,
                    $orgLabel,
                    $leader->org_name,
                    $showContact ? $leader->email : null,
                    $showContact ? (string) $leader->school_id : null,
                ])),
            ];
        }

        // 3. Budgets & Financial Health
        $showFinance = $role !== 'STUDENT' && $this->moduleAllowed($user, 'finance');
        $budgets = $showFinance
            ? DB::table('budgets')
                ->join('organizations', 'organizations.id', '=', 'budgets.organization_id')
                ->whereIn('budgets.organization_id', $orgIds)
                ->where('budgets.submission_status', 'approved')
                ->orderByDesc('budgets.updated_at')
                ->limit(25)
                ->get([
                    'budgets.id',
                    'budgets.title',
                    'budgets.allocated_amount',
                    'budgets.remaining_amount',
                    'budgets.submission_status',
                    'organizations.name as org_name',
                    'organizations.acronym as org_acronym',
                ])
            : collect();
        $spentByBudget = Budget::spentAmounts($budgets->pluck('id'));
        $incomeByBudget = Budget::incomeAmounts($budgets->pluck('id'));

        foreach ($budgets as $b) {
            $allocated = (float) $b->allocated_amount;
            $remaining = (float) $b->remaining_amount;
            $spent = (float) $spentByBudget[$b->id];
            $income = (float) $incomeByBudget[$b->id];
            $usedPct = $allocated > 0 ? max(0, min(100, (int) round(($spent / $allocated) * 100))) : 0;
            $orgLabel = $b->org_acronym ?: $b->org_name;
            $budgetTitle = $b->title ?: 'Operational';
            $budgetStatus = $b->submission_status ?: 'approved';

            $corpus[] = [
                'id' => 'rag-budget-'.$b->id,
                'domain' => 'Finance, Budgets & Ledger',
                'primary' => "{$orgLabel} — {$budgetTitle} Budget",
                'secondary' => $this->budgetFigureLine($allocated, $income, $spent, $remaining),
                'status' => Str::headline((string) $budgetStatus),
                'status_tone' => $budgetStatus === 'approved' ? ($usedPct > 90 ? 'warning' : 'success') : 'info',
                'meta' => '₱'.number_format($remaining, 2).' left',
                'progress_percent' => $usedPct,
                'href' => $this->corpusHref($user, 'budgets'),
                'action_label' => 'Open budget',
                'entity_terms' => array_filter([$budgetTitle, $b->org_acronym, $b->org_name]),
                'search_text' => implode(' ', array_filter([
                    'budget finance financial allocated remaining spent money fund category utilization',
                    $budgetTitle,
                    $budgetStatus,
                    $orgLabel,
                    $b->org_name,
                ])),
            ];
        }

        // 4. Ledger Transactions (Income & Expenses)
        if ($showFinance) {
            $transactions = DB::table('transactions')
                ->join('organizations', 'organizations.id', '=', 'transactions.organization_id')
                ->whereNull('transactions.archived_at')
                ->whereIn('transactions.organization_id', $orgIds)
                ->orderByDesc('transactions.transaction_date')
                ->limit(25)
                ->get([
                    'transactions.id',
                    'transactions.type',
                    'transactions.category',
                    'transactions.amount',
                    'transactions.description',
                    'transactions.receipt_reference',
                    'transactions.transaction_date',
                    'organizations.name as org_name',
                    'organizations.acronym as org_acronym',
                ]);
            $cashAdvanceKinds = Transaction::cashAdvanceKinds($transactions->pluck('id'));

            foreach ($transactions as $tx) {
                $orgLabel = $tx->org_acronym ?: $tx->org_name;
                $amount = (float) $tx->amount;
                $isExpense = Str::lower((string) $tx->type) === 'expense';
                $advance = $cashAdvanceKinds[$tx->id] ?? null;

                $corpus[] = [
                    'id' => 'rag-tx-'.$tx->id,
                    'domain' => 'Finance, Budgets & Ledger',
                    'primary' => Str::headline((string) ($tx->category ?: $tx->type)).' ('.$orgLabel.')',
                    'secondary' => sprintf(
                        '%s · Category: %s · Receipt: %s · Date: %s',
                        $advance ? 'Cash advance '.$advance : Str::headline((string) $tx->type),
                        $tx->category ?: 'General',
                        $tx->receipt_reference ?: 'N/A',
                        $tx->transaction_date ? Carbon::parse($tx->transaction_date)->format('M j, Y') : 'Recent'
                    ),
                    'excerpt' => $tx->description ? "Note: {$tx->description}" : null,
                    'quotable' => true,
                    'status' => $advance ? 'Cash advance '.$advance : ($isExpense ? 'Expense' : 'Income'),
                    'status_tone' => $advance ? 'neutral' : ($isExpense ? 'warning' : 'success'),
                    'meta' => '₱'.number_format($amount, 2),
                    'href' => $this->corpusHref($user, 'ledger'),
                    'action_label' => 'View ledger',
                    'entity_terms' => array_filter([$tx->category, $tx->description, $tx->receipt_reference, $orgLabel]),
                    'search_text' => implode(' ', array_filter([
                        'transaction ledger expense income spent receipt payment money financial',
                        $advance ? 'cash advance' : null,
                        $tx->type,
                        $tx->category,
                        $tx->description,
                        $tx->receipt_reference,
                        $orgLabel,
                    ])),
                ];
            }
        }

        // 5. Merchandise Catalog, Inventory Stock & Orders: only the Admin sees items switched off.
        $merchandiseItems = DB::table('merchandise')
            ->join('organizations', 'organizations.id', '=', 'merchandise.organization_id')
            ->whereNull('merchandise.deleted_at')
            ->whereIn('merchandise.organization_id', $orgIds)
            ->when($role !== 'ADMIN', fn ($q) => $q->where('merchandise.is_active', true))
            ->orderBy('merchandise.name')
            ->limit(25)
            ->get([
                'merchandise.id',
                'merchandise.name',
                'merchandise.category',
                'merchandise.description',
                'merchandise.price',
                'merchandise.stock_quantity',
                'merchandise.low_stock_threshold',
                'merchandise.is_active',
                'organizations.name as org_name',
                'organizations.acronym as org_acronym',
            ]);

        foreach ($merchandiseItems as $item) {
            $stock = (int) $item->stock_quantity;
            $threshold = max(1, (int) ($item->low_stock_threshold ?: 10));
            $isLow = $stock <= $threshold;
            $orgLabel = $item->org_acronym ?: $item->org_name;

            $corpus[] = [
                'id' => 'rag-merch-'.$item->id,
                'domain' => 'Merchandise & Store Inventory',
                'primary' => "{$item->name} ({$orgLabel})",
                'secondary' => sprintf(
                    'Category: %s · Price: ₱%s · Stock: %s',
                    $item->category ?: 'Apparel & Merch',
                    number_format((float) $item->price, 2),
                    $this->plural($stock, 'unit')
                ),
                'excerpt' => $item->description ? Str::limit($item->description, 60) : null,
                'quotable' => true,
                'status' => $stock <= 0 ? 'Out of stock' : ($isLow ? 'Low stock' : 'In stock'),
                'status_tone' => $stock <= 0 ? 'danger' : ($isLow ? 'warning' : 'success'),
                'meta' => '₱'.number_format((float) $item->price, 2)." · {$stock} in stock",
                'progress_percent' => min(100, (int) round(($stock / max(20, $threshold * 3)) * 100)),
                'href' => $this->corpusHref($user, 'merchandise'),
                'action_label' => 'Open store',
                'entity_terms' => array_filter([$item->name, $item->category, $orgLabel]),
                'search_text' => implode(' ', array_filter([
                    'merchandise merch store shop catalog product item price stock inventory low stock shirt lanyard hoodie',
                    $item->name,
                    $item->category,
                    $item->description,
                    $orgLabel,
                ])),
            ];
        }

        // 6. Events & Campus Venue Bookings: an officer limited away from events cannot open either page.
        $showEvents = $this->moduleAllowed($user, 'events');
        $events = $showEvents
            ? DB::table('events')
                ->join('organizations', 'organizations.id', '=', 'events.organization_id')
                ->whereIn('events.organization_id', $orgIds)
                ->when(
                    in_array($role, ['STUDENT', 'SBO_OFFICER'], true),
                    fn ($q) => $q->whereIn('events.status', ['approved', 'ongoing', 'completed'])
                )
                ->orderByDesc('events.start_time')
                ->limit(25)
                ->get([
                    'events.id',
                    'events.title',
                    'events.description',
                    'events.location',
                    'events.status',
                    'events.start_time',
                    'events.end_time',
                    'organizations.name as org_name',
                    'organizations.acronym as org_acronym',
                ])
            : collect();

        foreach ($events as $ev) {
            $orgLabel = $ev->org_acronym ?: $ev->org_name;
            $corpus[] = [
                'id' => 'rag-event-'.$ev->id,
                'domain' => 'Events, Attendance & Venues',
                'primary' => "{$ev->title} — {$orgLabel}",
                'secondary' => sprintf(
                    'Location: %s · Starts: %s · Status: %s',
                    $ev->location ?: 'Campus Venue',
                    $ev->start_time ? Carbon::parse($ev->start_time)->format('M j, Y g:i A') : 'TBA',
                    Str::headline((string) $ev->status)
                ),
                'status' => Str::headline((string) $ev->status),
                'status_tone' => in_array($ev->status, ['approved', 'ongoing', 'completed'], true) ? 'success' : 'warning',
                'meta' => $ev->start_time ? Carbon::parse($ev->start_time)->format('M j, Y') : 'Scheduled',
                'href' => $this->corpusHref($user, 'events'),
                'action_label' => 'View event',
                'entity_terms' => array_filter([$ev->title, $ev->location, $orgLabel]),
                'search_text' => implode(' ', array_filter([
                    'event activity program assembly seminar calendar schedule attendance venue location',
                    $ev->title,
                    $ev->description,
                    $ev->location,
                    $ev->status,
                    $orgLabel,
                ])),
            ];
        }

        $venues = $showEvents
            ? DB::table('venues')
                ->where('is_active', true)
                ->orderBy('name')
                ->limit(15)
                ->get(['id', 'name', 'location', 'capacity'])
            : collect();

        foreach ($venues as $venue) {
            $corpus[] = [
                'id' => 'rag-venue-'.$venue->id,
                'domain' => 'Events, Attendance & Venues',
                'primary' => "Venue: {$venue->name}",
                'secondary' => sprintf('Location: %s · Capacity: %d attendees', $venue->location ?: 'Main Campus', (int) $venue->capacity),
                'status' => 'Active venue',
                'status_tone' => 'info',
                'meta' => 'Cap: '.number_format((int) $venue->capacity),
                'href' => $this->corpusHref($user, 'venues'),
                'action_label' => 'View venues',
                'entity_terms' => array_filter([$venue->name, $venue->location]),
                'search_text' => implode(' ', array_filter([
                    'venue room hall auditorium gymnasium court booking reservation capacity location',
                    $venue->name,
                    $venue->location,
                    (string) $venue->capacity,
                ])),
            ];
        }

        // 7. Tasks & Officer Workload (Non-student roles)
        if ($role !== 'STUDENT' && $this->moduleAllowed($user, 'tasks')) {
            $tasksQuery = DB::table('tasks')
                ->leftJoin('users', 'users.school_id', '=', 'tasks.assigned_to')
                ->whereIn('tasks.organization_id', $orgIds);

            if ($role === 'SBO_OFFICER') {
                $tasksQuery->where('tasks.assigned_to', $user->school_id);
            }

            $tasks = $tasksQuery
                ->orderByDesc('tasks.updated_at')
                ->limit(25)
                ->get([
                    'tasks.id',
                    'tasks.title',
                    'tasks.description',
                    'tasks.status',
                    'tasks.priority',
                    'tasks.progress_percent',
                    'tasks.deadline',
                    'users.first_name',
                    'users.last_name',
                ]);

            foreach ($tasks as $t) {
                $assignee = trim(($t->first_name ?? '').' '.($t->last_name ?? '')) ?: 'Unassigned';
                $pct = (int) ($t->progress_percent ?? 0);

                $corpus[] = [
                    'id' => 'rag-task-'.$t->id,
                    'domain' => 'Officer Tasks & Workload',
                    'primary' => $t->title,
                    'secondary' => sprintf(
                        'Assignee: %s · Priority: %s · Due: %s',
                        $assignee,
                        Str::headline((string) ($t->priority ?: 'medium')),
                        $t->deadline ? Carbon::parse($t->deadline)->format('M j, Y') : 'No deadline'
                    ),
                    'status' => Str::headline((string) $t->status),
                    'status_tone' => $t->status === 'overdue' ? 'danger' : ($t->status === 'completed' ? 'success' : 'warning'),
                    'meta' => "{$pct}% complete",
                    'progress_percent' => $pct,
                    'href' => $this->corpusHref($user, 'tasks'),
                    'action_label' => 'Open task',
                    'entity_terms' => array_filter([$t->title, $assignee, $t->first_name, $t->last_name]),
                    'search_text' => implode(' ', array_filter([
                        'task workload assignment todo deliverable officer deadline progress',
                        $t->title,
                        $t->description,
                        $t->status,
                        $t->priority,
                        $assignee,
                    ])),
                ];
            }
        }

        // 8. Elections, Positions & Candidates: a student, and an officer limited away from elections, read an election as a member does.
        $memberView = $role === 'STUDENT' || ! $this->moduleAllowed($user, 'elections');
        $candidates = DB::table('candidates')
            ->join('elections', 'elections.id', '=', 'candidates.election_id')
            ->join('users', 'users.school_id', '=', 'candidates.user_id')
            ->join('election_positions', 'election_positions.id', '=', 'candidates.position_id')
            ->leftJoin('partylists', 'partylists.id', '=', 'candidates.partylist_id')
            ->whereIn('elections.organization_id', $orgIds)
            ->when(
                $memberView,
                fn ($q) => $q->whereNotNull('elections.finalized_at')->whereNull('elections.cancelled_at')->whereIn('elections.status', ['active', 'closed'])
            )
            ->orderBy('election_positions.id')
            ->limit(25)
            ->get([
                'candidates.id',
                'candidates.platform',
                'users.first_name',
                'users.last_name',
                'election_positions.title as position_title',
                'partylists.name as partylist_name',
                'partylists.acronym as partylist_acronym',
                'elections.title as election_title',
                'elections.status as election_status',
            ]);

        foreach ($candidates as $cand) {
            $candName = trim($cand->first_name.' '.$cand->last_name);
            $party = $cand->partylist_acronym ?: ($cand->partylist_name ?: 'Independent');

            $corpus[] = [
                'id' => 'rag-cand-'.$cand->id,
                'domain' => 'Elections, Partylists & Candidates',
                'primary' => "{$candName} — Candidate for {$cand->position_title}",
                'secondary' => sprintf(
                    'Partylist: %s · Election: %s',
                    $party,
                    $cand->election_title
                ),
                'excerpt' => $cand->platform ? 'Platform: '.Str::limit($cand->platform, 70) : null,
                'quotable' => false,
                'status' => Str::headline((string) $cand->election_status),
                'status_tone' => $cand->election_status === 'active' ? 'success' : 'info',
                'meta' => $party,
                'href' => $this->corpusHref($user, 'candidates'),
                'action_label' => 'View ballot',
                'entity_terms' => array_filter([$candName, $cand->first_name, $cand->last_name, $cand->position_title, $party, $cand->election_title]),
                'search_text' => implode(' ', array_filter([
                    'election candidate ballot vote voting partylist position platform running',
                    $candName,
                    $cand->position_title,
                    $party,
                    $cand->partylist_name,
                    $cand->platform,
                    $cand->election_title,
                ])),
            ];
        }

        // 9. Official Announcements & Bulletins: the posts the role's own feed would list.
        $seesEveryAudience = $role === 'ADMIN' || ($role === 'SBO_OFFICER' && $this->moduleAllowed($user, 'announcements'));
        $announcementOrgIds = $role === 'SUPER_ADMIN' ? [(int) $user->organization_id] : $orgIds;
        $announcements = DB::table('announcements')
            ->leftJoin('organizations', 'organizations.id', '=', 'announcements.organization_id')
            ->where(function ($q) use ($announcementOrgIds, $role, $user) {
                $q->whereIn('announcements.organization_id', $announcementOrgIds);
                if ($role !== 'SUPER_ADMIN') {
                    $q->orWhere(fn ($global) => $global->whereIn('announcements.announcement_source', ['SAO', 'COMPLIANCE'])
                        ->whereExists(fn ($recipient) => $recipient->select(DB::raw(1))
                            ->from('announcement_recipients')
                            ->whereColumn('announcement_recipients.announcement_id', 'announcements.id')
                            ->where('announcement_recipients.user_id', $user->school_id)));
                }
            })
            ->where('announcements.is_published', true)
            ->where('announcements.approval_status', 'approved')
            ->where(fn ($q) => $q->whereNull('announcements.scheduled_at')->orWhere('announcements.scheduled_at', '<=', now()))
            ->where(fn ($q) => $q->whereNull('announcements.expires_at')->orWhere('announcements.expires_at', '>', now()))
            ->when(
                ! $seesEveryAudience,
                fn ($q) => $q->whereIn('announcements.target_role', ['all', $role])
            )
            ->orderByDesc('announcements.is_pinned')
            ->orderByDesc('announcements.created_at')
            ->limit(20)
            ->get([
                'announcements.id',
                'announcements.title',
                'announcements.body',
                'announcements.category',
                'announcements.is_pinned',
                'announcements.is_important',
                'announcements.published_at',
                'organizations.acronym as org_acronym',
                'organizations.name as org_name',
            ]);

        foreach ($announcements as $ann) {
            $orgLabel = $ann->org_acronym ?: ($ann->org_name ?: 'University');
            $corpus[] = [
                'id' => 'rag-ann-'.$ann->id,
                'domain' => 'Official Announcements & Bulletins',
                'primary' => $ann->title,
                'secondary' => sprintf(
                    'Source: %s · Category: %s',
                    $orgLabel,
                    Str::headline((string) ($ann->category ?: 'General'))
                ),
                'excerpt' => Str::limit(strip_tags((string) $ann->body), 80),
                'quotable' => true,
                'status' => $ann->is_pinned ? 'Pinned' : ($ann->is_important ? 'Important' : 'Published'),
                'status_tone' => $ann->is_important ? 'warning' : ($ann->is_pinned ? 'info' : 'success'),
                'meta' => $ann->published_at ? Carbon::parse($ann->published_at)->format('M j, Y') : 'Published',
                'href' => $this->corpusHref($user, 'announcements'),
                'action_label' => 'Read post',
                'entity_terms' => array_filter([$ann->title, $ann->category, $orgLabel]),
                'search_text' => implode(' ', array_filter([
                    'announcement bulletin news post broadcast notice pinned important',
                    $ann->title,
                    $ann->body,
                    $ann->category,
                    $orgLabel,
                ])),
            ];
        }

        // 10. Compliance Submissions
        $submissions = $showCompliance
            ? DB::table('organization_compliance_submissions')
                ->join('organizations', 'organizations.id', '=', 'organization_compliance_submissions.organization_id')
                ->join('compliance_requirement_types', 'compliance_requirement_types.id', '=', 'organization_compliance_submissions.requirement_type_id')
                ->whereIn('organization_compliance_submissions.organization_id', $orgIds)
                ->orderByDesc('organization_compliance_submissions.submitted_at')
                ->limit(25)
                ->get([
                    'organization_compliance_submissions.id',
                    'organization_compliance_submissions.status',
                    'organization_compliance_submissions.remarks',
                    'organization_compliance_submissions.file_original_name',
                    'organizations.name as org_name',
                    'organizations.acronym as org_acronym',
                    'compliance_requirement_types.name as req_name',
                    'compliance_requirement_types.academic_year',
                ])
            : collect();

        foreach ($submissions as $sub) {
            $orgLabel = $sub->org_acronym ?: $sub->org_name;
            $corpus[] = [
                'id' => 'rag-comp-'.$sub->id,
                'domain' => 'Compliance & Accreditation Files',
                'primary' => "{$orgLabel} — {$sub->req_name}",
                'secondary' => sprintf(
                    'File: %s · A.Y. %s',
                    $sub->file_original_name ?: 'Document',
                    $sub->academic_year
                ),
                'excerpt' => $sub->remarks ? "Remarks: {$sub->remarks}" : null,
                'quotable' => true,
                'status' => Str::headline((string) $sub->status),
                'status_tone' => $sub->status === 'approved' ? 'success' : ($sub->status === 'returned' ? 'danger' : 'warning'),
                'meta' => $sub->academic_year,
                'progress_percent' => $sub->status === 'approved' ? 100 : ($sub->status === 'submitted' ? 75 : 25),
                'href' => $this->corpusHref($user, 'compliance'),
                'action_label' => 'Open compliance',
                'entity_terms' => array_filter([$sub->req_name, $orgLabel, $sub->org_name, $sub->file_original_name]),
                'search_text' => implode(' ', array_filter([
                    'compliance accreditation requirement document file submission uploaded constitution cbl',
                    $sub->req_name,
                    $sub->status,
                    $orgLabel,
                    $sub->org_name,
                    $sub->remarks,
                ])),
            ];
        }

        return $corpus;
    }

    private function computeSemanticVector(string $text): array
    {
        $lower = Str::lower($text);
        $dimensions = [
            'Priorities & Daily Overview' => ['today', 'priority', 'priorities', 'overview', 'summary', 'briefing', 'checklist', 'action plan'],
            'Missing & Overdue Compliance' => ['missing', 'unsubmitted', 'incomplete', 'lacking', 'not submitted', 'haven\'t', 'hasn\'t', 'overdue'],
            'Submitted Documents & Files' => ['submitted', 'uploaded', 'compliance', 'accreditation', 'requirement', 'constitution', 'by-laws', 'cbl', 'document'],
            'Organizations & Governance' => ['organization', 'club', 'society', 'council', 'college', 'registration', 'lifecycle', 'university-wide'],
            'Leadership & Officers Roster' => ['officer', 'leader', 'admin', 'president', 'vice', 'secretary', 'treasurer', 'auditor', 'adviser', 'dean', 'directory', 'roster', 'member', 'who is', 'email'],
            'Approvals & Endorsements' => ['approval', 'approve', 'endorse', 'endorsement', 'review', 'pending', 'sign-off', 'waiting'],
            'Finance, Budgets & Ledger' => ['finance', 'financial', 'budget', 'allocated', 'remaining', 'spent', 'expense', 'income', 'transaction', 'receipt', 'ledger', 'cash advance', 'collection', 'fee', 'invoice', 'debt', 'balance'],
            'Events, Attendance & Venues' => ['event', 'activity', 'program', 'seminar', 'assembly', 'attendance', 'check-in', 'calendar', 'venue', 'room', 'auditorium', 'gym', 'hall', 'capacity', 'booking'],
            'Officer Tasks & Workload' => ['task', 'workload', 'assigned', 'assignee', 'todo', 'deliverable', 'deadline', 'progress', 'delegation'],
            'Merchandise & Store Inventory' => ['merchandise', 'merch', 'store', 'shop', 'catalog', 'product', 'item', 'shirt', 'lanyard', 'hoodie', 'price', 'stock', 'inventory', 'order', 'claim'],
            'Clearances & Elections' => ['clearance', 'signatory', 'signature', 'held', 'election', 'vote', 'voting', 'ballot', 'turnout', 'candidate', 'partylist', 'platform', 'position'],
            'Announcements & Grievances' => ['announcement', 'bulletin', 'news', 'post', 'broadcast', 'pinned', 'grievance', 'complaint', 'concern', 'urgent'],
        ];

        $vec = [];
        $normSq = 0.0;

        foreach ($dimensions as $label => $keywords) {
            $score = 0.0;
            foreach ($keywords as $kw) {
                if (Str::contains($lower, $kw) && preg_match('/(?<![\pL\pN])'.preg_quote($kw, '/').'(?:s|es)?(?![\pL\pN])/u', $lower) === 1) {
                    $score += 1.0;
                }
            }
            $vec[$label] = $score;
            $normSq += $score * $score;
        }

        $norm = sqrt($normSq);
        if ($norm > 0) {
            foreach ($vec as $k => $v) {
                $vec[$k] = $v / $norm;
            }
        }

        return $vec;
    }

    private function activeConceptLabels(array $vector): array
    {
        $active = [];
        foreach ($vector as $label => $weight) {
            if ($weight >= 0.25) {
                $active[] = $label;
            }
        }

        return array_slice($active, 0, 4);
    }

    private function cosineSimilarity(array $vecA, array $vecB): float
    {
        $dot = 0.0;
        foreach ($vecA as $k => $v) {
            $dot += $v * ($vecB[$k] ?? 0.0);
        }

        return max(0.0, min(1.0, $dot));
    }

    private function extractRawTokens(string $text): array
    {
        $clean = preg_replace('/[^\pL\pN\s-]/u', ' ', Str::lower($text)) ?? '';
        $parts = preg_split('/\s+/u', trim($clean)) ?: [];
        $stopwords = [
            'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'had', 'her', 'was',
            'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'man', 'new', 'now', 'old',
            'see', 'two', 'way', 'who', 'boy', 'did', 'its', 'let', 'put', 'say', 'she', 'too', 'use',
            'what', 'when', 'where', 'which', 'with', 'have', 'from', 'this', 'that', 'they', 'will',
            'would', 'there', 'their', 'about', 'tell', 'show', 'give', 'list', 'please', 'many', 'much',
            'does', 'need', 'still',
        ];

        return array_values(array_filter(
            $parts,
            fn (string $t) => strlen($t) >= 2 && ! in_array($t, $stopwords, true)
        ));
    }

    private function tokenizeWithSynonyms(string $question): array
    {
        $tokens = $this->extractRawTokens($question);
        $synonymMap = [
            'president' => ['admin', 'leader', 'president', 'officer'],
            'officers' => ['officer', 'sbo', 'admin', 'leader', 'position'],
            'officer' => ['officer', 'sbo', 'admin', 'leader'],
            'admins' => ['admin', 'administrator', 'president', 'adviser'],
            'dean' => ['department', 'head', 'dean', 'college'],
            'money' => ['budget', 'finance', 'transaction', 'amount', 'allocated', 'remaining'],
            'spent' => ['expense', 'transaction', 'budget', 'remaining'],
            'expenses' => ['expense', 'transaction', 'ledger', 'receipt'],
            'merch' => ['merchandise', 'stock', 'price', 'order', 'store'],
            'stock' => ['merchandise', 'quantity', 'inventory', 'low'],
            'items' => ['merchandise', 'product', 'stock', 'price'],
            'rooms' => ['venue', 'location', 'capacity', 'booking'],
            'venues' => ['venue', 'location', 'capacity', 'booking'],
            'candidates' => ['candidate', 'election', 'partylist', 'position', 'platform'],
            'news' => ['announcement', 'bulletin', 'published'],
            'posts' => ['announcement', 'bulletin', 'published'],
        ];

        $expanded = $tokens;
        foreach ($tokens as $tok) {
            if (isset($synonymMap[$tok])) {
                foreach ($synonymMap[$tok] as $syn) {
                    $expanded[] = $syn;
                }
            }
        }

        return array_values(array_unique($expanded));
    }

    private function bm25Score(array $queryTokens, array $docTokens, array $docFreq, int $corpusSize, int $docLen, float $avgDocLen): float
    {
        if ($queryTokens === [] || $docTokens === []) {
            return 0.0;
        }

        $tfMap = array_count_values($docTokens);
        $k1 = 1.5;
        $b = 0.75;
        $score = 0.0;

        foreach ($queryTokens as $qTok) {
            $tf = $tfMap[$qTok] ?? 0;
            if ($tf === 0) {
                continue;
            }
            $df = $docFreq[$qTok] ?? 0;
            $idf = log(1.0 + (($corpusSize - $df + 0.5) / ($df + 0.5)));
            $num = $tf * ($k1 + 1.0);
            $den = $tf + $k1 * (1.0 - $b + $b * ($docLen / max(1.0, $avgDocLen)));
            $score += $idf * ($num / $den);
        }

        return $score;
    }

    private function trigramSimilarity(string $a, string $b): float
    {
        $trigramsA = $this->charTrigrams($a);
        $trigramsB = $this->charTrigrams($b);

        if ($trigramsA === [] || $trigramsB === []) {
            return 0.0;
        }

        $intersect = count(array_intersect($trigramsA, $trigramsB));
        $union = count(array_unique(array_merge($trigramsA, $trigramsB)));

        return $union > 0 ? $intersect / $union : 0.0;
    }

    private function charTrigrams(string $text): array
    {
        $clean = preg_replace('/[^a-z0-9]/', '', Str::lower($text)) ?? '';
        $len = strlen($clean);
        if ($len < 3) {
            return $clean !== '' ? [$clean] : [];
        }

        $grams = [];
        for ($i = 0; $i <= $len - 3; $i++) {
            $grams[] = substr($clean, $i, 3);
        }

        return array_values(array_unique($grams));
    }

    private function recentQueries(User $user): array
    {
        $topics = [...self::TOPICS, ...AskAiRoleIntents::INTENTS];

        return AiOutput::where('requested_by', $user->school_id)
            ->where('feature_type', 'ASK_AI_ASSISTANT')
            ->when(
                $user->organization_id === null,
                fn ($query) => $query->whereNull('organization_id'),
                fn ($query) => $query->where('organization_id', $user->organization_id)
            )
            ->where('structured_input->role', $user->role)
            ->whereNotIn('context_version', [AskAiChatService::CHAT_AUDIT_VERSION, AskAiChatService::ACTION_AUDIT_VERSION])
            ->where('decision_status', '!=', 'superseded')
            ->orderByDesc('id')
            ->limit(5)
            ->get(['id', 'prompt_text', 'output_text', 'created_at', 'structured_input'])
            ->map(function (AiOutput $out) use ($topics) {
                $topic = $out->structured_input['topic'] ?? $out->structured_input['intent'] ?? null;

                return [
                    'id' => $out->id,
                    'question' => $out->prompt_text,
                    'answer' => $out->output_text,
                    'topic' => in_array($topic, $topics, true) ? $topic : null,
                    'asked_at' => $out->created_at?->toIso8601String(),
                ];
            })
            ->all();
    }

    private function roleLabel(string $role): string
    {
        return match ($role) {
            'SUPER_ADMIN' => 'SAO assistant',
            'DEPARTMENT_HEAD' => 'College assistant',
            'ADMIN' => 'Organization assistant',
            'SBO_OFFICER' => 'Officer assistant',
            default => 'Student assistant',
        };
    }

    private function roleName(string $role): string
    {
        return match ($role) {
            'SUPER_ADMIN' => 'the SAO',
            'DEPARTMENT_HEAD' => 'the Department Head',
            'ADMIN' => 'an organization head',
            'SBO_OFFICER' => 'an officer',
            default => 'a student',
        };
    }

    /** The position a person holds, as a label rather than inside a sentence. */
    private function roleTitle(string $role): string
    {
        return match ($role) {
            'SUPER_ADMIN' => 'SAO',
            'DEPARTMENT_HEAD' => 'Department Head',
            'ADMIN' => 'Organization Head',
            'SBO_OFFICER' => 'Officer',
            default => 'Student',
        };
    }

    /** Who a waiting request is waiting for. */
    private function reviewerName(string $requiredRole): string
    {
        return match (Str::upper($requiredRole)) {
            'SUPER_ADMIN', 'SAO' => 'the SAO',
            'DEPARTMENT_HEAD' => 'the Department Head',
            'ADMIN', 'ORGANIZATION' => 'the organization head',
            default => 'a reviewer',
        };
    }

    /** Whose records an answer covers, as a possessive that opens a sentence. */
    private function ownerPhrase(User $user): string
    {
        return match ($user->role) {
            'SUPER_ADMIN' => "all organizations'",
            'DEPARTMENT_HEAD' => "your college's organizations'",
            default => "your organization's",
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
                    'label' => "What's on my desk today",
                    'question' => 'What should I do today across student organizations?',
                    'description' => 'The registrations, files, approvals, venue bookings, grievances and clearances waiting for you, most urgent first.',
                ],
                [
                    'id' => 'sao-applications',
                    'topic' => 'applications_queue',
                    'label' => 'Applications to approve',
                    'question' => 'Which organization applications are waiting for my approval?',
                    'description' => 'The applications the Department Heads have endorsed, oldest first.',
                ],
                [
                    'id' => 'sao-missing',
                    'topic' => 'missing_submissions',
                    'label' => 'Who is behind on requirements',
                    'question' => "Which organizations haven't submitted their requirements?",
                    'description' => 'The organizations that still owe compliance files or financial reports.',
                ],
                [
                    'id' => 'sao-submitted',
                    'topic' => 'submitted_documents',
                    'label' => 'Files waiting for review',
                    'question' => 'Who has sent files that I still need to review?',
                    'description' => 'Compliance files and reports that organizations have sent and nobody has reviewed yet.',
                ],
                [
                    'id' => 'sao-grievances',
                    'topic' => 'grievances_status',
                    'label' => 'Urgent student concerns',
                    'question' => 'Are there any urgent student grievances I should read first?',
                    'description' => 'The open grievances, with the high and critical ones first.',
                ],
                [
                    'id' => 'sao-howto-dean',
                    'topic' => 'how_to_guide',
                    'label' => 'Invite a dean',
                    'question' => 'How do I invite a Department Head?',
                    'description' => 'The steps for sending a college its Department Head invitation link.',
                ],
            ],
            'DEPARTMENT_HEAD' => [
                [
                    'id' => 'dh-today',
                    'topic' => 'daily_priorities',
                    'label' => "What's on my desk today",
                    'question' => 'What should I do today for my college?',
                    'description' => 'The requests to endorse, returned registrations and organizations without a head, most urgent first.',
                ],
                [
                    'id' => 'dh-approvals',
                    'topic' => 'pending_approvals',
                    'label' => 'Waiting for my approval',
                    'question' => 'What is waiting for my approval right now?',
                    'description' => 'The events, budgets, reports and elections that need the Department Head.',
                ],
                [
                    'id' => 'dh-no-admin',
                    'topic' => 'organizations_without_admin',
                    'label' => 'Which organizations need a head',
                    'question' => 'Which organizations in my college have no head yet?',
                    'description' => 'The active organizations in your college without an organization head, and the returned registrations.',
                ],
                [
                    'id' => 'dh-missing',
                    'topic' => 'missing_submissions',
                    'label' => 'Who is behind on requirements',
                    'question' => 'Which of our organizations are behind on requirements?',
                    'description' => 'The organizations in your college with missing compliance files or financial reports.',
                ],
                [
                    'id' => 'dh-events',
                    'topic' => 'events_attendance',
                    'label' => 'Events in my college',
                    'question' => 'What events are coming up in my college?',
                    'description' => 'The approved and ongoing events across your college organizations.',
                ],
                [
                    'id' => 'dh-howto-endorse',
                    'topic' => 'how_to_guide',
                    'label' => 'Endorse an application',
                    'question' => 'How do I endorse an application?',
                    'description' => 'The steps for reviewing and endorsing an organization application.',
                ],
            ],
            'ADMIN' => [
                [
                    'id' => 'adm-today',
                    'topic' => 'daily_priorities',
                    'label' => "What's on my desk today",
                    'question' => 'What should I do today for our organization?',
                    'description' => 'The overdue tasks, requests, missing files and orders that need you, most urgent first.',
                ],
                [
                    'id' => 'adm-missing',
                    'topic' => 'missing_submissions',
                    'label' => 'What we still owe SAO',
                    'question' => "What haven't we submitted yet?",
                    'description' => 'The compliance files and event requirements your organization has not sent or that were returned.',
                ],
                [
                    'id' => 'adm-finance',
                    'topic' => 'finance_health',
                    'label' => 'Our budget and unpaid fees',
                    'question' => 'How much budget is left, and how many student invoices are unpaid?',
                    'description' => 'The approved budgets with what is left of each, and the open student invoices.',
                ],
                [
                    'id' => 'adm-tasks',
                    'topic' => 'tasks_workload',
                    'label' => 'Overdue tasks',
                    'question' => 'Who has overdue or unfinished tasks?',
                    'description' => 'The overdue and open tasks, who has each one and when it is due.',
                ],
                [
                    'id' => 'adm-orders',
                    'topic' => 'merchandise_orders',
                    'label' => 'Orders needing action',
                    'question' => 'Which merchandise orders need my attention?',
                    'description' => 'The orders with a payment proof to check and the paid orders waiting to be claimed.',
                ],
                [
                    'id' => 'adm-howto-event',
                    'topic' => 'how_to_guide',
                    'label' => 'Plan an event',
                    'question' => 'How do I create an event?',
                    'description' => 'The steps for creating an event, uploading its requirements and booking a venue.',
                ],
            ],
            'SBO_OFFICER' => [
                [
                    'id' => 'off-today',
                    'topic' => 'daily_priorities',
                    'label' => "What's on my desk today",
                    'question' => 'What should I do today as an officer?',
                    'description' => 'Your tasks, the orders waiting for a payment check and the events that need you.',
                ],
                [
                    'id' => 'off-tasks',
                    'topic' => 'tasks_workload',
                    'label' => 'My tasks',
                    'question' => 'Which tasks are mine, and which are overdue?',
                    'description' => 'The tasks assigned to you, with their deadlines and progress.',
                ],
                [
                    'id' => 'off-orders',
                    'topic' => 'merchandise_orders',
                    'label' => 'Orders to check',
                    'question' => 'Which orders need payment checking or claiming?',
                    'description' => 'The student orders with a payment proof to check and the paid orders ready for pickup.',
                ],
                [
                    'id' => 'off-events',
                    'topic' => 'events_attendance',
                    'label' => 'Events to run',
                    'question' => 'What events need check-in today?',
                    'description' => 'The events happening now and the ended ones that still need closing.',
                ],
                [
                    'id' => 'off-finance',
                    'topic' => 'finance_health',
                    'label' => 'Our budget, read only',
                    'question' => 'How much budget does our organization have left?',
                    'description' => 'The approved budgets and what is left of each. You can read them but not change them.',
                ],
                [
                    'id' => 'off-howto-orders',
                    'topic' => 'how_to_guide',
                    'label' => 'Verify an order',
                    'question' => 'How do I verify an order?',
                    'description' => 'The steps for checking a GCash proof and releasing an item at the claim desk.',
                ],
            ],
            default => [
                [
                    'id' => 'stu-today',
                    'topic' => 'daily_priorities',
                    'label' => "What's on my plate",
                    'question' => 'What do I need to do today?',
                    'description' => 'Your clearance, fees, ballots and orders in one list.',
                ],
                [
                    'id' => 'stu-clearance',
                    'topic' => 'clearances_status',
                    'label' => "Who hasn't signed",
                    'question' => "Who hasn't signed my clearance yet, and why?",
                    'description' => 'Each signatory on your clearance and whether they have signed.',
                ],
                [
                    'id' => 'stu-fees',
                    'topic' => 'finance_health',
                    'label' => 'What I owe',
                    'question' => 'What fees do I still need to pay?',
                    'description' => 'Your open invoices, what you have paid and what is left.',
                ],
                [
                    'id' => 'stu-orders',
                    'topic' => 'merchandise_orders',
                    'label' => 'My orders',
                    'question' => 'Is my merchandise order ready to claim?',
                    'description' => 'Your orders that are being checked and the paid ones ready to claim.',
                ],
                [
                    'id' => 'stu-elections',
                    'topic' => 'elections_status',
                    'label' => 'Can I vote',
                    'question' => 'Is there an election I can vote in right now?',
                    'description' => 'The elections open to you, and whether you have already voted.',
                ],
                [
                    'id' => 'stu-fee-usage',
                    'topic' => 'fee_usage',
                    'label' => 'Where my fees go',
                    'question' => 'Where do my membership fees go?',
                    'description' => 'How the fees your organization collected were spent, once the SAO has approved the report.',
                ],
            ],
        };
    }
}
