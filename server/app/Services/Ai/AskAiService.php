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
use App\Models\Invoice;
use App\Models\Organization;
use App\Models\OrganizationApplicantGrant;
use App\Models\OrganizationApplication;
use App\Models\OrganizationComplianceSubmission;
use App\Models\Transaction;
use App\Models\User;
use App\Services\ApprovalEntityLabel;
use App\Services\Compliance\AccreditationStatusService;
use App\Services\Dashboard\ClientRouteAccess;
use App\Services\StudentAccountBalances;
use App\Support\SemesterScope;
use Illuminate\Database\Eloquent\Builder as EloquentBuilder;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class AskAiService
{
    private const ROW_LIMIT = 12;

    private const INTENT_MODULES = [
        'missing_submissions' => 'compliance',
        'submitted_documents' => 'compliance',
        'clearances_status' => 'compliance',
        'finance_health' => 'finance',
        'merchandise_orders' => 'merchandise',
        'events_attendance' => 'events',
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
        'merchandise_orders',
        'events_attendance',
        'clearances_status',
        'elections_status',
        'grievances_status',
        'semantic_rag',
        'how_to_guide',
    ];

    // Most specific first: the first pattern that matches the lowercased question decides the intent. 'missing_requirements'
    // is the plainer wording of missing_submissions, tried only after the task and file questions that share its words.
    private const INTENT_PATTERNS = [
        'daily_priorities' => '~\b(?:what (?:should|do|can|must) (?:i|we) (?:need to )?do today|what to do today|what(?:\'s| is) on (?:my|our) (?:desk|plate|list|agenda)|daily (?:priorities|briefing|checklist)|(?:action plan|checklist|priorities) (?:for )?today|today\'s (?:priorities|action plan)|where (?:do|should) (?:i|we) start|what needs (?:me|my attention|our attention))\b~',
        'organizations_without_admin' => '~\b(?:(?:without|no|missing|lacking|lacks?|needs?|needing|awaiting|vacant)(?: \w+){0,3} (?:admins?|administrators?|org(?:anization)? heads?|(?<!department )heads?)|(?:admins?|administrators?|org(?:anization)? heads?)(?: \w+){0,3} (?:missing|needed|vacant|unfilled)|returned registrations?)\b~',
        'semantic_rag' => '~\b(?:who (?:are|is) the (?:officers|president|vice|secretary|treasurer|auditor|advis[eo]r|dean|candidates)|officer directory|leadership roster|list of officers|organization members|stocks?|inventory|catalog|price of|low stock|partylist|platform|tell me about|compare|search|everything about)\b~',
        'grievances_status' => '~\b(?:grievances?|complaints?|concerns?)\b~',
        'clearances_status' => '~\b(?:clearances?|signator(?:y|ies)|signed my clearance)\b~',
        'missing_submissions' => '~\b(?:(?:haven\'t|havent|hasn\'t|hasnt|have not|has not|not|never|yet to|failed to|still need to|didn\'t|didnt)(?: \w+){0,3} (?:submit|submitted|upload|uploaded|file|filed|passed)|unsubmitted|overdue reports?)\b~',
        'submitted_documents' => '~\b(?:who (?:has |have |had )?(?:submitted|sent|uploaded|filed)|(?:already|recently) submitted|submitted (?:documents?|files?|compliance|reports?|requirements?)|what (?:have|did) (?:we|i) (?:already )?submit(?:ted)?|what documents were submitted|files? (?:\w+ ){0,6}review)\b~',
        'elections_status' => '~\b(?:elections?|votes?|voted|voting|voters?|ballots?|turnout|candidates?)\b~',
        'merchandise_orders' => '~\b(?:(?<!in )orders?|merch(?:andise)?|claim(?:s|ed|ing)?|payment proofs?|verify payments?|pick-?up)\b~',
        'tasks_workload' => '~\b(?:tasks?|workloads?|assigned|assignees?|assign|delegate|delegation|to-?do)\b~',
        'missing_requirements' => '~\b(?:missing|incomplete|lacking|outstanding|requirements?|compliance|deadlines?|accreditation)\b~',
        'pending_approvals' => '~\b(?:approvals?|approve|approving|endorse\w*|pending review|waiting for (?:my |our |the )?(?:review|approval|decision)|my decision|venues?|bookings?|(?:pending|new|waiting|awaiting) registrations?|applications?)\b~',
        'finance_health' => '~\b(?:budgets?|finance|finances|financial|spent|spending|spend|fees?|invoices?|debts?|owe|owed|owes|owing|unpaid|collections?|paid|balances?|receipts?|payments?|dues|how much (?:is |do we have |do i have )?(?:left|remaining))\b~',
        'events_attendance' => '~\b(?:events?|attendance|attendees?|calendar|check[- ]?in)\b~',
    ];

    private const ROLE_INTENT_CAPABILITIES = [
        'applications_queue' => ['Organization applications', 'The applications waiting for your decision, and who each one is waiting for.'],
        'my_submissions' => ['Where our submissions stand', 'Where your event proposals, budget requests and reports are, and who has to act on them next.'],
        'ai_tools' => ['The AI tools', 'What each tool does, who can use it and where to open it.'],
        'fee_usage' => ['Where my fees go', 'How the fees your organization collected were spent, once the SAO has approved the report.'],
    ];

    private const STUDENT_REDIRECTS = [
        'tasks_workload' => ['organization tasks, which are given to officers', 'The closest thing for you is your own list for today, and I can show it.', 'daily_priorities'],
        'pending_approvals' => ['approval queues, which officers, the Department Head and the SAO review', 'I can show your clearance, your fees and your orders instead.', 'clearances_status'],
        'missing_submissions' => ['the compliance files that organizations send to the SAO', 'I can show which signatures are still missing on your own clearance.', 'clearances_status'],
        'submitted_documents' => ['the compliance files that organizations send to the SAO', 'I can show which signatures are still missing on your own clearance.', 'clearances_status'],
        'organizations_without_admin' => ['the list of organizations that still need an organization head', 'I can show what you need to do today instead.', 'daily_priorities'],
        'grievances_status' => ['the grievance queue that the SAO reads', 'If you have a concern of your own, you can file it on the My grievances page.', 'daily_priorities'],
    ];

    private const STUDENT_INTENTS = [
        'daily_priorities',
        'finance_health',
        'merchandise_orders',
        'events_attendance',
        'clearances_status',
        'elections_status',
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
     * @return array{first_name: string, role: string, scope: string, today: string, semester: ?string}
     */
    public function chatContext(User $user): array
    {
        $semester = AcademicSemester::active();

        return [
            'first_name' => (string) $user->first_name,
            'role' => $this->roleName($user->role),
            'scope' => $this->scopeLabel($user),
            'today' => now()->format('l, F j, Y'),
            'semester' => $semester === null ? null : trim(($semester->academicYear?->label ? 'AY '.$semester->academicYear->label.' · ' : '').$this->semesterLabel((int) $semester->number)),
        ];
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
        $answer = 'I can read the records your account can already open and put them in plain words. As '.$this->roleName($user->role).' for '.$this->scopeLabel($user).", you can ask me things like:\n\n"
            .implode("\n", $lines)
            ."\n\nI can also take you to where things get done. Say what you want to do, for example \"".(self::REQUEST_EXAMPLES[$user->role] ?? 'I want to create an event')."\", and I will tell you whether you are ready and open the right page. Here is what I can help you start:\n\n"
            .implode("\n", $this->capabilityGuideLines($user->role))
            ."\n\nI can also explain how HIUSA works step by step, help you draft a message or an agenda, and remember things you ask me to keep in mind (say \"remember that ...\"). I only read: I never approve, assign or publish anything for you.";

        return $this->enrichWithFormattedBlocksAndCharts([
            'title' => 'What I can help with',
            'answer' => $answer,
            'highlights' => [],
            'sections' => [],
            'follow_ups' => array_map(fn (array $q) => ['topic' => $q['topic'], 'label' => $q['label'], 'question' => $q['question']], array_slice($prompts, 0, 3)),
            'model_name' => null,
        ], 'capabilities');
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

        $roleIntent = $this->roleIntents->match($question, $role);
        if ($roleIntent !== null) {
            return $roleIntent;
        }

        // "I wanna create an org", "book a venue", "can you post an announcement": someone saying what they want to do
        // is taken to the guide for it, after the role intents above have claimed their own wording.
        if ($this->isActionRequest($q)) {
            return 'how_to_guide';
        }

        foreach (self::INTENT_PATTERNS as $intent => $pattern) {
            if (preg_match($pattern, $q) !== 1) {
                continue;
            }

            return match ($intent) {
                'missing_requirements' => 'missing_submissions',
                'grievances_status' => $role === 'SUPER_ADMIN' ? 'grievances_status' : 'semantic_rag',
                default => $intent,
            };
        }

        return 'semantic_rag';
    }

    private function answer(User $user, string $question, string $intent, bool $allowModel, bool $callModel = true): array
    {
        if ($intent === 'how_to_guide') {
            return $this->answerHowTo($user, $question);
        }

        if (! $this->intentAllowed($user, $intent)) {
            return $this->enrichWithFormattedBlocksAndCharts($this->refusal($user, $intent), $intent);
        }

        $organizationIds = $this->scopedStudentOrganizationIds($user);
        $rag = $this->retrieveRagContext($user, $question, $organizationIds, $intent === 'semantic_rag' || $allowModel);

        if ($intent === 'semantic_rag') {
            $payload = $this->buildSemanticRagPayload($user, $question, $rag, $organizationIds);
        } else {
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
                'applications_queue', 'my_submissions', 'ai_tools', 'fee_usage' => $this->roleIntents->build($user, $intent, $question),
                default => $this->buildDailyPriorities($user, $organizationIds),
            };

            if ($allowModel) {
                $payload = $this->augmentWithRagMatches($payload, $rag);
            }
        }

        $payload['follow_ups'] = array_values(array_filter(
            $payload['follow_ups'] ?? [],
            fn (array $followUp) => $this->intentAllowed($user, $followUp['topic'])
        ));

        $modelName = null;
        if ($allowModel && $callModel) {
            $enhanced = $this->enhanceWithModel($user, $question, $payload, $rag);
            if ($enhanced !== null) {
                $payload['answer'] = $enhanced['text'];
                $modelName = $enhanced['model'];
            }
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

        return $this->enrichWithFormattedBlocksAndCharts($payload, $intent);
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
        'imperative' => '~^'.self::REQUEST_OPENERS.'(?:(?:please|pls|just|now|then)\s+)*(?!(?:open|close)\s+(?!an?\b|the\b|my\b|our\b|new\b))'.self::REQUEST_VERBS.'(?!\s+(?:on|about|of|is|are|was|were|has|have|had|for|by|status|history|summary|count|total|details?|number|dates?|times?|results?)\b)\s+\S~',
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
            $href = $this->routeAccess->hrefFor($role, $this->guides->stepPath($step, $role));
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
        $form = isset($guide['open_path']) ? $this->routeAccess->hrefFor($role, $guide['open_path']) : null;
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
    private function buildHowToRequest(User $user, array $guide, bool $accessible, array $related): array
    {
        if (! $accessible) {
            return $this->buildHowToWhoCan($user, $guide, $related);
        }

        $payload = $this->buildHowToGuide($user, $guide, true, $related);
        $start = $this->howToStart($user, $guide);

        if ($start !== null) {
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
            $answer .= ' From your records: '.implode(' ', $stands);
        }
        if ($start !== null) {
            $answer .= ' The "'.$start['label'].'" button below takes you there, and the steps are listed under it.';
        }

        $payload['title'] = $guide['title'];
        $payload['answer'] = $answer;

        return $payload;
    }

    /** A request this role cannot carry out: say who can, then offer the closest thing this person can do. */
    private function buildHowToWhoCan(User $user, array $guide, array $related): array
    {
        $role = $user->role;
        $doers = array_map(fn (string $r) => self::ROLE_DOERS[$r] ?? $r, $guide['roles']);
        $nearest = $this->howToNearest($user, $guide, $related);

        $answer = sprintf('%s cannot %s in HIUSA; that is done by %s.', self::ROLE_SELF[$role] ?? 'Your role', $this->howToAction($guide), $this->joinPhrases($doers));
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
            'title' => $guide['title'],
            'answer' => $answer,
            'highlights' => [
                ['label' => 'Your access', 'value' => 'Other role', 'tone' => 'warning'],
                ['label' => 'Done by', 'value' => implode(', ', array_map(fn (string $r) => HowToGuideLibrary::ROLE_NAMES[$r] ?? $r, $guide['roles'])), 'tone' => 'info'],
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
            $href = $this->routeAccess->hrefFor($role, $path);
            if ($href !== null) {
                return $row($label, $phrase, $href);
            }
        }

        $home = $this->routeAccess->hrefFor($role, self::ROLE_HOME[$role] ?? null);

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
                ? $row('applications', $this->plural($waiting, 'application').' '.$this->be($waiting).' waiting for your decision', null, 'Waiting', 'warning', $this->routeAccess->hrefFor($role, '/dashboard/organization-applications'), 'Open applications')
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
        $result = $this->guides->search($question, $role);
        $guide = $result['best'];

        $request = $this->isActionRequest($this->plainQuestion($question));

        if ($guide === null) {
            $payload = $this->buildHowToCatalog($user, $question, $request);
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
        $steps = array_values($guide['steps']);
        $stepCount = count($steps);
        $allowedRoles = array_map(
            fn (string $r) => HowToGuideLibrary::ROLE_NAMES[$r] ?? $r,
            $guide['roles']
        );

        $stepRows = [];
        $paths = [];
        foreach ($steps as $index => $step) {
            $href = $accessible ? $this->routeAccess->hrefFor($role, $this->guides->stepPath($step, $role)) : null;
            if ($href !== null) {
                $paths[strtok($href, '?')] = true;
            }
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
                ['label' => 'Your access', 'value' => $accessible ? 'Allowed' : 'Other role', 'tone' => $accessible ? 'success' : 'warning'],
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
                    'href' => $this->routeAccess->hrefFor($user->role, '/dashboard/super-admin/academic-years'),
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

        $rows = array_map(function (array $g) use ($role) {
            $firstPath = null;
            foreach ($g['steps'] as $step) {
                $firstPath = $this->routeAccess->hrefFor($role, $this->guides->stepPath($step, $role));
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
            'answer' => sprintf(
                $request
                    ? 'I could not tell which task you mean by "%s". I can take you to the right page for %s for %s, so say which one you want to start, for example "%s".'
                    : 'I could not match "%s" to one procedure. I can walk you through %s for %s, so ask about any of them, for example "%s".',
                Str::limit($question, 80),
                $this->plural(count($guides), $request ? 'task' : 'guide'),
                HowToGuideLibrary::ROLE_NAMES[$role] ?? $role,
                $request ? (self::REQUEST_EXAMPLES[$role] ?? 'I want to create an event') : ($guides[0]['question'] ?? 'How do I use Ask AI?')
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
                    'href' => $this->routeAccess->hrefFor($role, '/dashboard/super-admin/grievances'),
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
                    'href' => $this->routeAccess->hrefFor($role, '/dashboard/super-admin/organizations?status=pending'),
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
                    'href' => $this->routeAccess->hrefFor($role, '/dashboard/super-admin/compliance?tab=review'),
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
                    'href' => $this->routeAccess->hrefFor($role, '/dashboard/super-admin/compliance?tab=event-reviews'),
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
                    'href' => $this->routeAccess->hrefFor($role, '/dashboard/super-admin/compliance?tab=financial'),
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
                    'href' => $this->routeAccess->hrefFor($role, '/dashboard/super-admin/organization-approvals'),
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
                    'href' => $this->routeAccess->hrefFor($role, '/dashboard/super-admin/venues'),
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
                    'href' => $this->routeAccess->hrefFor($role, '/dashboard/super-admin/clearances'),
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
                    'href' => $this->routeAccess->hrefFor($role, '/dashboard/super-admin/compliance'),
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
                    'href' => $this->routeAccess->hrefFor($role, '/dashboard/department-head/approvals'),
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
                    'href' => $this->routeAccess->hrefFor($role, '/dashboard/department-head/approvals'),
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
                    'href' => $this->routeAccess->hrefFor($role, '/dashboard/department-head/organizations'),
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
                    'href' => $this->routeAccess->hrefFor($role, '/dashboard/department-head/organizations'),
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
            $orgId = (int) $user->organization_id;
            $balanceRow = $this->balances->rows(collect([$user]), $orgId)->first();
            $owedTotal = (float) ($balanceRow['total_debt'] ?? 0);
            $invoiceDebt = (float) ($balanceRow['invoice_debt'] ?? 0);
            $reservedOrderDebt = (float) ($balanceRow['reserved_order_debt'] ?? 0);
            $unpaidInvoices = (int) ($balanceRow['unpaid_invoice_count'] ?? 0);
            $reservedOrders = (int) ($balanceRow['pending_order_count'] ?? 0);

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
                    'href' => $this->routeAccess->hrefFor($role, '/dashboard/my-clearance'),
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
                    'href' => $this->routeAccess->hrefFor($role, '/dashboard/finance/statement-of-account'),
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
                    'href' => $this->routeAccess->hrefFor($role, '/dashboard/merchandise/my-orders'),
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
                    'href' => $this->routeAccess->hrefFor($role, '/dashboard/elections/cast-vote'),
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
                    'href' => $this->routeAccess->hrefFor($role, '/dashboard/merchandise/my-orders'),
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
                : 'You are all caught up today. Nothing is held on your clearance, you owe nothing and no ballot is waiting for you.';

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
                'href' => $this->routeAccess->hrefFor($role, $isOfficer ? '/dashboard/tasks/assigned-tasks' : '/dashboard/tasks/task-board'),
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
                'href' => $this->routeAccess->hrefFor($role, '/dashboard/approvals'),
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
                'href' => $this->routeAccess->hrefFor($role, '/dashboard/compliance'),
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
                'href' => $this->routeAccess->hrefFor($role, '/dashboard/merchandise/manage-orders'),
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
                'href' => $this->routeAccess->hrefFor($role, $isOfficer ? '/dashboard/events/activity-calendar' : '/dashboard/events/manage-events'),
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
                'href' => $this->routeAccess->hrefFor($role, $isOfficer ? '/dashboard/tasks/assigned-tasks' : '/dashboard/tasks/task-board'),
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
                ? ComplianceRequirementType::where('academic_year', $academicYear)
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
                    'href' => $this->routeAccess->hrefFor($role, '/dashboard/super-admin/organizations?status=pending'),
                    'action_label' => 'Review',
                ])->all(),
            ];
        }

        $requestsPhrase = $totalPendingApprovals.' approval '.Str::plural('request', $totalPendingApprovals);
        $answer = $role === 'SUPER_ADMIN'
            ? sprintf(
                '%s %s waiting for your review, and %d student %s %s waiting for a registration decision.',
                $requestsPhrase,
                $totalPendingApprovals === 1 ? 'is' : 'are',
                $pendingRegCount,
                Str::plural('organization', $pendingRegCount),
                $pendingRegCount === 1 ? 'is' : 'are'
            )
            : sprintf('%s %s waiting for your review.', $requestsPhrase, $totalPendingApprovals === 1 ? 'is' : 'are');

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
                    'description' => $this->showingFirst($totalPendingApprovals, 'oldest first'),
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

        return [
            'title' => 'Tasks & Officer Workload',
            'answer' => sprintf(
                '%d %s overdue, and %d %s still pending or in progress.',
                $overdueCount,
                $overdueCount === 1 ? 'task is' : 'tasks are',
                $openCount,
                $openCount === 1 ? 'task is' : 'tasks are'
            ),
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

    private function buildFinanceHealth(User $user, Collection $organizationIds): array
    {
        $role = $user->role;

        if ($role === 'STUDENT') {
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

        $unpaidInvoicesCount = DB::table('invoices')
            ->whereIn('organization_id', $orgIds)
            ->whereNotIn('status', ['paid', 'cancelled', 'waived'])
            ->count();

        $budgetHref = $this->linkTo($user, '/dashboard/finance/budget-allocation');

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
                    'description' => $this->showingFirst($budgetTotal, 'largest allocation first'),
                    'empty_message' => 'No approved budgets are recorded yet.',
                    'rows' => $approvedBudgets->map(function ($b) use ($budgetOrgs, $spentByBudget, $budgetHref) {
                        $org = $budgetOrgs->get($b->organization_id);
                        $spent = (float) ($spentByBudget[$b->id] ?? 0);
                        $used = (float) $b->allocated_amount > 0 ? $spent / (float) $b->allocated_amount : 0;

                        return [
                            'id' => 'bud-'.$b->id,
                            'primary' => $b->title.' — '.($org?->acronym ?: ($org?->name ?? 'Organization')),
                            'secondary' => sprintf('Allocated: ₱%s · Spent: ₱%s · Remaining: ₱%s', number_format((float) $b->allocated_amount, 2), number_format($spent, 2), number_format((float) $b->remaining_amount, 2)),
                            'status' => round($used * 100).'% spent',
                            'status_tone' => $used >= 0.9 ? 'danger' : ($used >= 0.8 ? 'warning' : 'success'),
                            'meta' => '₱'.number_format((float) $b->remaining_amount, 2).' left',
                            'progress_percent' => round($used * 100),
                            'href' => $budgetHref,
                            'action_label' => 'Open budget',
                        ];
                    })->all(),
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

        if (in_array($role, ['SUPER_ADMIN', 'DEPARTMENT_HEAD'], true)) {
            return [
                'title' => 'Merchandise Orders Queue',
                'answer' => 'Merchandise orders are handled by each student organization, so there is no order queue on your account. Ask the organization to check its own orders.',
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
        $upcomingQuery = DB::table('events')
            ->join('organizations', 'organizations.id', '=', 'events.organization_id')
            ->whereIn('events.organization_id', $orgIds)
            ->whereIn('events.status', ['approved', 'ongoing'])
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
                        'secondary' => ($ev->location ?: 'Campus venue').' · Starts '.Carbon::parse($ev->start_time)->format('M j, Y g:i A'),
                        'status' => Str::headline($ev->status),
                        'status_tone' => $ev->status === 'ongoing' ? 'success' : 'info',
                        'meta' => Carbon::parse($ev->start_time)->format('M j'),
                        'href' => $href,
                        'action_label' => 'View calendar',
                    ])->all(),
                ],
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
        if ($user->role !== 'SUPER_ADMIN') {
            return $this->buildDailyPriorities($user, $this->scopedStudentOrganizationIds($user));
        }

        $grievanceQuery = $this->openGrievancesQuery();
        $openCount = (clone $grievanceQuery)->count();
        $urgentCount = (clone $grievanceQuery)->whereRaw('LOWER(urgency) in (?, ?)', ['high', 'critical'])->count();
        $openGrievances = $grievanceQuery
            ->orderByRaw("CASE WHEN LOWER(urgency) = 'critical' THEN 0 WHEN LOWER(urgency) = 'high' THEN 1 WHEN LOWER(urgency) = 'medium' THEN 2 ELSE 3 END")
            ->orderByDesc('created_at')
            ->limit(self::ROW_LIMIT)
            ->get(['id', 'title', 'category', 'urgency', 'status', 'created_at']);

        $href = $this->linkTo($user, '/dashboard/super-admin/grievances');

        return [
            'title' => 'Student Grievance Queue (SAO)',
            'answer' => sprintf(
                '%d %s unresolved, and %d of them %s high or critical urgency.',
                $openCount,
                $openCount === 1 ? 'grievance is' : 'grievances are',
                $urgentCount,
                $urgentCount === 1 ? 'is' : 'are'
            ),
            'highlights' => [
                ['label' => 'Unresolved grievances', 'value' => (string) $openCount, 'tone' => $openCount > 0 ? 'warning' : 'success'],
                ['label' => 'High / critical urgency', 'value' => (string) $urgentCount, 'tone' => $urgentCount > 0 ? 'danger' : 'neutral'],
            ],
            'sections' => [
                [
                    'id' => 'sao-grievances-list',
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
        $requirementTypes = ComplianceRequirementType::where('academic_year', $academicYear)
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

    /** The first path the signed-in profile may open, so a link is never one the client sends the person away from. */
    private function linkTo(User $user, string ...$paths): ?string
    {
        foreach ($paths as $path) {
            $href = $this->routeAccess->hrefFor((string) $user->profileRole(), $path);
            if ($href !== null) {
                return $href;
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
        if ($plain === '' || ! $this->ai->preservesNumericFacts($plain, $facts)) {
            return null;
        }

        return [
            'text' => $plain,
            'model' => $result['model'],
        ];
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
            $primaryLower = Str::lower($doc['primary'].' '.($doc['secondary'] ?? ''));
            foreach ($doc['entity_terms'] ?? [] as $entityTerm) {
                $entityLower = Str::lower(trim((string) $entityTerm));
                if ($entityLower !== '' && strlen($entityLower) >= 3 && $this->containsWord($questionLower, $entityLower)) {
                    $entityBoost += 1.6;
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
            fn (array $c) => sprintf('%s (%s)', $c['primary'], $c['status'])
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
            ->filter(fn (array $c) => ($c['relevance_percent'] ?? 0) >= 65 && ! in_array(Str::lower($c['primary']), $existingIds, true))
            ->take(6)
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

    private function corpusHref(string $role, string $page): ?string
    {
        return $this->routeAccess->hrefFor($role, self::CORPUS_PAGES[$page][$role] ?? null);
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

        foreach ($organizations as $org) {
            $accStatus = $accreditationByOrg[$org->id] ?? 'incomplete';
            $label = ($org->acronym ? "{$org->acronym} — " : '').$org->name;

            $corpus[] = [
                'id' => 'rag-org-'.$org->id,
                'domain' => 'Organizations & Accreditation',
                'primary' => $label,
                'secondary' => sprintf(
                    'College: %s · Status: %s · Accreditation: %s',
                    $org->college ?: ($org->is_university_wide ? 'University-wide' : 'General'),
                    Str::headline((string) $org->lifecycle_status),
                    Str::headline((string) $accStatus)
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
                'href' => $this->corpusHref($role, 'organizations'),
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
                'href' => $this->corpusHref($role, 'leaders'),
                'action_label' => 'Directory',
                'entity_terms' => array_filter([$fullName, $leader->first_name, $leader->last_name, $position, $leader->org_acronym, $showContact ? (string) $leader->school_id : null]),
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

        foreach ($budgets as $b) {
            $allocated = (float) $b->allocated_amount;
            $remaining = (float) $b->remaining_amount;
            $spent = (float) $spentByBudget[$b->id];
            $usedPct = $allocated > 0 ? max(0, min(100, (int) round(($spent / $allocated) * 100))) : 0;
            $orgLabel = $b->org_acronym ?: $b->org_name;
            $budgetTitle = $b->title ?: 'Operational';
            $budgetStatus = $b->submission_status ?: 'approved';

            $corpus[] = [
                'id' => 'rag-budget-'.$b->id,
                'domain' => 'Finance, Budgets & Ledger',
                'primary' => "{$orgLabel} — {$budgetTitle} Budget",
                'secondary' => sprintf(
                    'Allocated: ₱%s · Spent: ₱%s · Remaining: ₱%s',
                    number_format($allocated, 2),
                    number_format($spent, 2),
                    number_format($remaining, 2)
                ),
                'status' => Str::headline((string) $budgetStatus),
                'status_tone' => $budgetStatus === 'approved' ? ($usedPct > 90 ? 'warning' : 'success') : 'info',
                'meta' => '₱'.number_format($remaining, 2).' left',
                'progress_percent' => $usedPct,
                'href' => $this->corpusHref($role, 'budgets'),
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
                    'href' => $this->corpusHref($role, 'ledger'),
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
                'href' => $this->corpusHref($role, 'merchandise'),
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
                'href' => $this->corpusHref($role, 'events'),
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
                'href' => $this->corpusHref($role, 'venues'),
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
                    'href' => $this->corpusHref($role, 'tasks'),
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
                'href' => $this->corpusHref($role, 'candidates'),
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
                'href' => $this->corpusHref($role, 'announcements'),
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
                'href' => $this->corpusHref($role, 'compliance'),
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
