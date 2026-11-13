<?php

namespace App\Services\Ai;

use App\Contracts\TextGenerator;
use App\Models\AcademicSemester;
use App\Models\AiOutput;
use App\Models\ApprovalRequest;
use App\Models\Budget;
use App\Models\ComplianceRequirementType;
use App\Models\Election;
use App\Models\ElectionBallot;
use App\Models\Event;
use App\Models\EventRequirement;
use App\Models\EventRequirementFile;
use App\Models\Organization;
use App\Models\OrganizationComplianceSubmission;
use App\Models\User;
use App\Services\ApprovalEntityLabel;
use App\Services\Compliance\AccreditationStatusService;
use App\Services\Dashboard\ClientRouteAccess;
use App\Services\StudentAccountBalances;
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
        'tasks_workload' => 'tasks',
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
            'semantic_rag',
            'how_to_guide',
        ];

        if ($topic !== null && in_array($topic, $validTopics, true)) {
            return $topic;
        }

        $q = Str::lower($question);

        // Procedural "how do I ..." questions get step-by-step guidance. Data
        // questions such as "how many" / "how much" / "how is our budget"
        // deliberately do not match and keep flowing to the data intents.
        if ($this->isHowToQuestion($q)) {
            return 'how_to_guide';
        }

        if (Str::contains($q, [
            'what should i do today',
            'what do i need to do today',
            'what to do today',
            'daily priorities',
            'daily briefing',
            'action plan today',
            'my checklist today',
        ])) {
            return 'daily_priorities';
        }

        // Dynamic RAG intents for leadership/roster, catalog inventory, ledger transactions, venues, announcements, candidates, or specific entity queries
        if (Str::contains($q, [
            'who are the officers',
            'who is the president',
            'who is the vice',
            'who is the secretary',
            'who is the treasurer',
            'who is the auditor',
            'who is the adviser',
            'who is the dean',
            'officer directory',
            'leadership roster',
            'list of officers',
            'organization members',
            'stock',
            'inventory',
            'catalog',
            'price of',
            'how much is',
            'low stock',
            'transaction',
            'expense',
            'income',
            'receipt',
            'cash advance',
            'ledger',
            'announcement',
            'bulletin',
            'pinned post',
            'who are the candidates',
            'partylist',
            'platform',
            'tell me about',
            'compare',
            'search',
            'everything about',
        ])) {
            return 'semantic_rag';
        }

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
            return $role === 'SUPER_ADMIN' ? 'grievances_status' : 'semantic_rag';
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

        return 'semantic_rag';
    }

    private function answer(User $user, string $question, string $intent, bool $allowModel): array
    {
        if ($intent === 'how_to_guide') {
            return $this->answerHowTo($user, $question);
        }

        if (! $this->intentAllowed($user, $intent)) {
            return $this->enrichWithFormattedBlocksAndCharts([
                'title' => 'Not available for your access',
                'answer' => 'Your account does not have access to this part of the organization, so Ask AI cannot answer that. Ask your organization head to add it to your access.',
                'highlights' => [],
                'sections' => [],
                'follow_ups' => [],
                'model_name' => null,
            ], $intent);
        }

        $organizationIds = $this->scopedStudentOrganizationIds($user);
        $rag = $this->retrieveRagContext($user, $question, $organizationIds, $intent);

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
                default => $this->buildDailyPriorities($user, $organizationIds),
            };

            if ($allowModel) {
                $payload = $this->augmentWithRagMatches($payload, $rag);
            }
        }

        $modelName = null;
        if ($allowModel) {
            $enhanced = $this->enhanceWithModel($user, $question, $payload, $rag);
            if ($enhanced !== null) {
                $payload['answer'] = $enhanced['text'];
                $modelName = $enhanced['model'];
            }
        }

        $payload['model_name'] = $modelName;
        $payload['rag_metadata'] = [
            'engine' => $modelName ? 'Hybrid Semantic RAG + '.(str_starts_with($modelName, 'claude') ? 'Claude' : 'Groq').' LLM' : 'Hybrid Semantic RAG (BM25 + 12D Concept Vector + Trigram)',
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
            .'|process\s+(of|for|to)\b|procedure\s+(for|to)\b|tutorial|instructions?\s+(for|to|on)\b)/',
            $q
        ) === 1;
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
        if ($user->role === 'STUDENT' && ! in_array($intent, self::STUDENT_INTENTS, true)) {
            return false;
        }

        $module = self::INTENT_MODULES[$intent] ?? null;

        return $module === null || $this->moduleAllowed($user, $module);
    }

    private function answerHowTo(User $user, string $question): array
    {
        $role = $user->role;
        $result = $this->guides->search($question, $role);
        $guide = $result['best'];

        if ($guide === null) {
            $payload = $this->buildHowToCatalog($user, $question);
        } else {
            $payload = $this->buildHowToGuide($user, $guide, (bool) $result['accessible'], $result['related']);
        }

        $payload['model_name'] = null;
        $payload['rag_metadata'] = [
            'engine' => 'Procedural Knowledge RAG (BM25 + Trigram over role guides)',
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
                'title' => 'Before you start: live check',
                'description' => 'Checked against current HIUSA records.',
                'empty_message' => 'Everything needed is ready.',
                'rows' => $readinessRows,
            ];
        }

        $sections[] = [
            'id' => 'how-to-steps',
            'layout' => 'steps',
            'title' => 'Step-by-step: '.$guide['title'],
            'description' => $accessible
                ? sprintf('%d steps · about %d min', $stepCount, $guide['minutes'])
                : 'Shown for reference. Your role cannot open these pages.',
            'empty_message' => 'No steps recorded.',
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
                '%s Follow these %d steps%s.',
                $guide['summary'],
                $stepCount,
                $paths !== [] ? '. Each "Go to page" button opens the page for that step' : ''
            );
            if ($firstStep !== null) {
                $answer .= ' Start here: '.rtrim($firstStep['detail'], '.').'.';
            }
        } else {
            $answer = sprintf(
                'Your role (%s) cannot do "%s". It is done by: %s. Here are the steps so you know what they do. %s',
                HowToGuideLibrary::ROLE_NAMES[$role] ?? $role,
                Str::lower($guide['title']),
                implode(', ', $allowedRoles),
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
                ['label' => 'Estimated time', 'value' => '~'.$guide['minutes'].' min', 'tone' => 'success'],
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

        return $rows;
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

    private function buildHowToCatalog(User $user, string $question): array
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
                'meta' => count($g['steps']).' steps',
                'href' => $firstPath,
                'action_label' => 'Open page',
                'ask_question' => $g['question'],
            ];
        }, $guides);

        return [
            'title' => 'How-to guides for your role',
            'answer' => sprintf(
                'I couldn\'t match "%s" to one procedure. Here are the %d step-by-step guides available for %s. Ask about any of them, for example "%s"',
                Str::limit($question, 80),
                count($guides),
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
                'description' => 'Ask "How do I …" with any of these, in your own words.',
                'empty_message' => 'No guides for this role yet.',
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
                ->whereRaw('LOWER(urgency) in (?, ?)', ['high', 'critical'])
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
                    'primary' => 'Name an organization head for active organizations',
                    'secondary' => "{$orgsWithoutAdmin} active organization(s) in your college do not have an active organization head yet. Use Give access on each one.",
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

            $activeElection = Election::where('organization_id', $orgId)
                ->where('status', 'active')
                ->get(['id', 'organization_id', 'title', 'end_time', 'finalized_at'])
                ->first(fn ($open) => $open->listsVoter($user->school_id));
            $needsToVote = $activeElection
                ? ! ElectionBallot::hasVoted($activeElection->id, $user->school_id, 1)
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

        $ordersToVerify = $this->moduleAllowed($user, 'merchandise')
            ? DB::table('orders')
                ->where('organization_id', $orgId)
                ->where('status', 'pending')
                ->where('officer_review_status', 'pending')
                ->whereNotNull('payment_proof_url')
                ->count()
            : 0;

        $missingComplianceCount = $this->moduleAllowed($user, 'compliance')
            ? count($this->missingComplianceRequirementsForOrganization($orgId))
            : 0;
        $staleEvents = $this->moduleAllowed($user, 'events')
            ? DB::table('events')
                ->where('organization_id', $orgId)
                ->whereIn('status', ['approved', 'ongoing'])
                ->where('end_time', '<', now())
                ->count()
            : 0;

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
                'status' => 'Pending '.$this->roleName($req->required_role),
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
                    'description' => $role === 'SUPER_ADMIN'
                        ? 'Active organizations without an active Admin. The Department Head names it for a college organization; you name it for a university-wide one.'
                        : 'Active organizations without an organization head. Open one and use Give access to name it.',
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
            ->orderByRaw("CASE WHEN LOWER(urgency) = 'critical' THEN 0 WHEN LOWER(urgency) = 'high' THEN 1 WHEN LOWER(urgency) = 'medium' THEN 2 ELSE 3 END")
            ->orderByDesc('created_at')
            ->limit(self::ROW_LIMIT)
            ->get(['id', 'title', 'category', 'urgency', 'status', 'created_at']);

        $urgentCount = $openGrievances->filter(fn ($g) => in_array(Str::lower((string) $g->urgency), ['high', 'critical'], true))->count();
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

    private function enrichWithFormattedBlocksAndCharts(array $payload, string $intent): array
    {
        $sections = array_map(function (array $section): array {
            $rows = array_map(function (array $row): array {
                $row['progress_percent'] = $this->inferRowProgressPercent($row);

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

        $secondary = (string) ($row['secondary'] ?? '');
        if (preg_match('/Allocated:\s*₱([\d,]+(?:\.\d+)?)\s*·\s*Remaining:\s*₱([\d,]+(?:\.\d+)?)/u', $secondary, $matches)) {
            $allocated = (float) str_replace(',', '', $matches[1]);
            $remaining = (float) str_replace(',', '', $matches[2]);
            if ($allocated > 0) {
                $usedPercent = (($allocated - $remaining) / $allocated) * 100;

                return max(0, min(100, (int) round($usedPercent)));
            }
        }

        return null;
    }

    private function buildChartsForPayload(array $payload, string $intent): array
    {
        $charts = [];

        // 1. Primary Metrics Bar Chart from highlights
        $highlightItems = [];
        foreach ($payload['highlights'] ?? [] as $hl) {
            $rawVal = (string) ($hl['value'] ?? '0');
            $numeric = (float) preg_replace('/[^0-9.]/', '', str_replace(',', '', $rawVal));
            $highlightItems[] = [
                'label' => (string) ($hl['label'] ?? 'Metric'),
                'value' => $numeric,
                'display_value' => $rawVal,
                'tone' => (string) ($hl['tone'] ?? 'primary'),
            ];
        }

        if ($highlightItems !== []) {
            $maxVal = max(1.0, ...array_map(fn (array $i) => $i['value'], $highlightItems));
            $charts[] = [
                'id' => $intent.'-highlights-chart',
                'type' => 'bar',
                'title' => 'Key Metrics Comparison',
                'subtitle' => 'Live indicator breakdown for this query',
                'items' => array_map(fn (array $item) => [
                    ...$item,
                    'percent' => $item['value'] > 0 ? max(8, min(100, (int) round(($item['value'] / $maxVal) * 100))) : 0,
                ], $highlightItems),
            ];
        }

        // 2. Queue / Record Status Distribution Chart from sections
        $allRows = collect($payload['sections'] ?? [])->flatMap(fn (array $sec) => $sec['rows'] ?? []);
        if ($allRows->isNotEmpty()) {
            $grouped = $allRows->groupBy(fn (array $row) => $row['status'] ?? 'Listed');
            $totalRows = max(1, $allRows->count());
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

            $charts[] = [
                'id' => $intent.'-status-distribution',
                'type' => 'distribution',
                'title' => 'Record Status Breakdown',
                'subtitle' => sprintf('Distribution across %d matching record(s)', $allRows->count()),
                'items' => array_values($statusItems),
            ];
        }

        return $charts;
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
        $topChunks = array_map(fn (array $chunk) => [
            'domain' => $chunk['domain'],
            'primary' => $chunk['primary'],
            'secondary' => $chunk['secondary'],
            'status' => $chunk['status'],
            'meta' => $chunk['meta'],
        ], array_slice($rag['chunks'] ?? [], 0, 8));

        $facts = [
            'role' => $user->role,
            'question' => $question,
            'deterministic_answer' => $payload['answer'],
            'highlights' => $payload['highlights'],
            'retrieved_rag_chunks' => $topChunks,
            'sections' => array_map(fn (array $s) => [
                'title' => $s['title'],
                'rows' => array_slice($s['rows'] ?? [], 0, 6),
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

    private function retrieveRagContext(User $user, string $question, Collection $organizationIds, ?string $intent = null): array
    {
        $corpus = $this->buildKnowledgeCorpus($user, $organizationIds);
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

        // Document frequencies for BM25
        $docFreq = [];
        $docLengths = [];
        $totalLength = 0;

        foreach ($corpus as $idx => $doc) {
            $tokens = $this->extractRawTokens($doc['search_text']);
            $docLengths[$idx] = max(1, count($tokens));
            $totalLength += $docLengths[$idx];
            foreach (array_unique($tokens) as $tok) {
                $docFreq[$tok] = ($docFreq[$tok] ?? 0) + 1;
            }
        }

        $avgDocLength = $totalLength / max(1, $corpusSize);
        $matchedEntities = [];
        $scored = [];

        foreach ($corpus as $idx => $doc) {
            $docTokens = $this->extractRawTokens($doc['search_text']);
            $bm25 = $this->bm25Score($queryTokens, $docTokens, $docFreq, $corpusSize, $docLengths[$idx], $avgDocLength);

            $docVector = $this->computeSemanticVector($doc['search_text']);
            $cosine = $this->cosineSimilarity($queryVector, $docVector);

            // Entity & exact phrase matching boost
            $entityBoost = 0.0;
            $primaryLower = Str::lower($doc['primary'].' '.($doc['secondary'] ?? ''));
            foreach ($doc['entity_terms'] ?? [] as $entityTerm) {
                $entityLower = Str::lower(trim((string) $entityTerm));
                if ($entityLower !== '' && strlen($entityLower) >= 3 && Str::contains(Str::lower($question), $entityLower)) {
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
        $topConfidence = $topChunks !== [] ? (int) $topChunks[0]['relevance_percent'] : 78;

        return [
            'chunks' => $topChunks,
            'corpus_size' => $corpusSize,
            'domains_searched' => $domainsSearched,
            'matched_concepts' => $matchedConcepts !== [] ? $matchedConcepts : ['General Operational Knowledge'],
            'matched_entities' => array_values($matchedEntities),
            'top_confidence' => $topConfidence,
        ];
    }

    private function buildSemanticRagPayload(User $user, string $question, array $rag, Collection $organizationIds): array
    {
        $chunks = collect($rag['chunks'] ?? []);

        if ($chunks->isEmpty()) {
            $fallback = $this->buildDailyPriorities($user, $organizationIds);
            $fallback['title'] = 'Semantic Knowledge Search & Briefing';
            $fallback['answer'] = sprintf(
                'Searched %d live records across %d authorized operational domains for "%s". No exact entity match exceeded the relevance threshold, so here is your live operational briefing and priority queue.',
                $rag['corpus_size'] ?? 0,
                $rag['domains_searched'] ?? 0,
                $question
            );

            return $fallback;
        }

        $grouped = $chunks->groupBy('domain');
        $sections = [];

        foreach ($grouped as $domainTitle => $domainChunks) {
            $first = $domainChunks->first();
            $sections[] = [
                'id' => 'rag-sec-'.Str::slug((string) $domainTitle),
                'title' => (string) $domainTitle,
                'description' => sprintf(
                    'Semantically retrieved records matching "%s" (top relevance: %d%%).',
                    Str::limit($question, 48),
                    (int) ($first['relevance_percent'] ?? 85)
                ),
                'empty_message' => 'No records in this domain.',
                'rows' => $domainChunks->take(10)->map(fn (array $c) => [
                    'id' => $c['id'],
                    'primary' => $c['primary'],
                    'secondary' => $c['secondary'],
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
            fn (array $c) => sprintf('%s (%s — %s)', $c['primary'], $c['status'], $c['meta'] ?: $c['secondary'])
        )->implode('; ');

        $actionNeededCount = $chunks->filter(
            fn (array $c) => in_array($c['status_tone'], ['danger', 'warning'], true)
        )->count();

        $answer = sprintf(
            'Semantic RAG retrieved %d relevant record(s) out of %d live records across %d domain(s) (top confidence: %d%%). Key findings: %s.',
            $chunks->count(),
            $rag['corpus_size'] ?? $chunks->count(),
            $grouped->count(),
            $rag['top_confidence'] ?? 88,
            $topThree
        );

        $highlights = [
            [
                'label' => 'Retrieved matches',
                'value' => (string) $chunks->count(),
                'tone' => 'primary',
            ],
            [
                'label' => 'Domains matched',
                'value' => (string) $grouped->count(),
                'tone' => 'success',
            ],
            [
                'label' => 'Needs attention',
                'value' => (string) $actionNeededCount,
                'tone' => $actionNeededCount > 0 ? 'warning' : 'success',
            ],
            [
                'label' => 'Top semantic score',
                'value' => ($rag['top_confidence'] ?? 88).'%',
                'tone' => 'primary',
            ],
        ];

        $followUps = [
            [
                'topic' => 'daily_priorities',
                'label' => 'What should I do today?',
                'question' => $this->defaultDailyQuestion($user->role),
            ],
            [
                'topic' => 'missing_submissions',
                'label' => 'Check missing submissions',
                'question' => "Who hasn't submitted compliance or financial reports?",
            ],
            [
                'topic' => 'finance_health',
                'label' => 'Review financial health',
                'question' => 'How is our budget utilization and financial status?',
            ],
        ];

        return [
            'title' => 'Semantic Knowledge Retrieval: '.Str::limit($question, 54),
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
                'title' => 'Related Records Retrieved via Semantic Search',
                'description' => 'Additional cross-domain records matching '.implode(', ', array_slice($matchedEntities, 0, 3)).'.',
                'empty_message' => 'No additional cross-domain matches.',
                'rows' => $highConfidenceExtras->map(fn (array $c) => [
                    'id' => $c['id'],
                    'primary' => $c['primary'],
                    'secondary' => $c['secondary'],
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

    private function buildKnowledgeCorpus(User $user, Collection $organizationIds): array
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
        $organizations = DB::table('organizations')
            ->whereIn('id', $orgIds)
            ->orderBy('name')
            ->limit(30)
            ->get(['id', 'name', 'acronym', 'college', 'lifecycle_status', 'is_university_wide', 'review_remarks']);

        $accreditationByOrg = $this->accreditation->forOrganizations(collect($orgIds));

        foreach ($organizations as $org) {
            $accStatus = $accreditationByOrg[$org->id] ?? 'incomplete';
            $label = ($org->acronym ? "{$org->acronym} — " : '').$org->name;
            $href = match ($role) {
                'SUPER_ADMIN' => $this->routeAccess->hrefFor($role, '/dashboard/super-admin/organizations'),
                'DEPARTMENT_HEAD' => $this->routeAccess->hrefFor($role, '/dashboard/department-head/organizations'),
                default => $this->routeAccess->hrefFor($role, '/dashboard/compliance'),
            };

            $corpus[] = [
                'id' => 'rag-org-'.$org->id,
                'domain' => 'Organizations & Accreditation',
                'primary' => $label,
                'secondary' => sprintf(
                    'College: %s · Lifecycle: %s · Accreditation: %s%s',
                    $org->college ?: ($org->is_university_wide ? 'University-wide' : 'General'),
                    Str::headline((string) $org->lifecycle_status),
                    Str::headline((string) $accStatus),
                    $showCompliance && $org->review_remarks ? " · Remarks: {$org->review_remarks}" : ''
                ),
                'status' => Str::headline((string) $org->lifecycle_status),
                'status_tone' => $org->lifecycle_status === 'active' ? ($accStatus === 'complete' ? 'success' : 'warning') : 'danger',
                'meta' => 'Accreditation: '.Str::headline((string) $accStatus),
                'progress_percent' => $accStatus === 'complete' ? 100 : ($accStatus === 'returned' ? 35 : 50),
                'href' => $href,
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

        // 2. Leadership, Admins & Officers Directory
        $showContact = $role !== 'STUDENT';
        $leaders = DB::table('users')
            ->leftJoin('organizations', 'organizations.id', '=', 'users.organization_id')
            ->where(function ($q) use ($orgIds, $role) {
                $q->whereIn('users.organization_id', $orgIds);
                if ($role === 'SUPER_ADMIN') {
                    $q->orWhere('users.role', 'DEPARTMENT_HEAD');
                }
            })
            ->whereIn('users.role', ['ADMIN', 'SBO_OFFICER', 'DEPARTMENT_HEAD'])
            ->where('users.account_status', 'active')
            ->orderBy('users.role')
            ->orderBy('users.last_name')
            ->limit(35)
            ->get([
                'users.school_id',
                'users.first_name',
                'users.last_name',
                'users.role',
                'users.position_title',
                'users.email',
                'users.department',
                'organizations.name as org_name',
                'organizations.acronym as org_acronym',
            ]);

        foreach ($leaders as $rank => $leader) {
            $fullName = trim($leader->first_name.' '.$leader->last_name);
            $orgLabel = $leader->org_acronym ?: ($leader->org_name ?: ($leader->department ?: 'Campus'));
            $position = $leader->position_title ?: $this->roleName($leader->role);

            $corpus[] = [
                'id' => 'rag-leader-'.($showContact ? $leader->school_id : $rank),
                'domain' => 'Leadership & Officers Directory',
                'primary' => "{$fullName} ({$position})",
                'secondary' => $showContact
                    ? sprintf(
                        'Organization: %s · Role: %s · ID: %s · Email: %s',
                        $orgLabel,
                        $this->roleName($leader->role),
                        $leader->school_id,
                        $leader->email
                    )
                    : sprintf('Organization: %s · Role: %s', $orgLabel, $this->roleName($leader->role)),
                'status' => $position,
                'status_tone' => $leader->role === 'ADMIN' ? 'success' : 'info',
                'meta' => $showContact ? 'ID #'.$leader->school_id : $orgLabel,
                'href' => $this->routeAccess->hrefFor($role, '/dashboard/users'),
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
                'href' => $this->routeAccess->hrefFor($role, '/dashboard/finance'),
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

            foreach ($transactions as $tx) {
                $orgLabel = $tx->org_acronym ?: $tx->org_name;
                $amount = (float) $tx->amount;
                $isExpense = Str::lower((string) $tx->type) === 'expense';

                $corpus[] = [
                    'id' => 'rag-tx-'.$tx->id,
                    'domain' => 'Finance, Budgets & Ledger',
                    'primary' => ($tx->description ?: $tx->category).' ('.$orgLabel.')',
                    'secondary' => sprintf(
                        '%s · Category: %s · Receipt: %s · Date: %s',
                        Str::headline((string) $tx->type),
                        $tx->category ?: 'General',
                        $tx->receipt_reference ?: 'N/A',
                        $tx->transaction_date ? Carbon::parse($tx->transaction_date)->format('M j, Y') : 'Recent'
                    ),
                    'status' => $isExpense ? 'Expense' : 'Income',
                    'status_tone' => $isExpense ? 'warning' : 'success',
                    'meta' => '₱'.number_format($amount, 2),
                    'href' => $this->routeAccess->hrefFor($role, '/dashboard/finance'),
                    'action_label' => 'View ledger',
                    'entity_terms' => array_filter([$tx->category, $tx->description, $tx->receipt_reference, $orgLabel]),
                    'search_text' => implode(' ', array_filter([
                        'transaction ledger expense income spent receipt payment money financial',
                        $tx->type,
                        $tx->category,
                        $tx->description,
                        $tx->receipt_reference,
                        $orgLabel,
                    ])),
                ];
            }
        }

        // 5. Merchandise Catalog, Inventory Stock & Orders
        $merchandiseItems = DB::table('merchandise')
            ->join('organizations', 'organizations.id', '=', 'merchandise.organization_id')
            ->whereNull('merchandise.deleted_at')
            ->whereIn('merchandise.organization_id', $orgIds)
            ->when($role === 'STUDENT', fn ($q) => $q->where('merchandise.is_active', true))
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
                    'Category: %s · Price: ₱%s · Stock: %d unit(s)%s',
                    $item->category ?: 'Apparel & Merch',
                    number_format((float) $item->price, 2),
                    $stock,
                    $item->description ? ' · '.Str::limit($item->description, 60) : ''
                ),
                'status' => $stock <= 0 ? 'Out of stock' : ($isLow ? 'Low stock' : 'In stock'),
                'status_tone' => $stock <= 0 ? 'danger' : ($isLow ? 'warning' : 'success'),
                'meta' => '₱'.number_format((float) $item->price, 2)." · {$stock} in stock",
                'progress_percent' => min(100, (int) round(($stock / max(20, $threshold * 3)) * 100)),
                'href' => $this->routeAccess->hrefFor($role, $role === 'STUDENT' ? '/dashboard/merchandise' : '/dashboard/merchandise/manage-orders'),
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

        // 6. Events & Campus Venue Bookings
        $events = DB::table('events')
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
            ]);

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
                'href' => $this->routeAccess->hrefFor($role, '/dashboard/events'),
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

        $venues = DB::table('venues')
            ->where('is_active', true)
            ->orderBy('name')
            ->limit(15)
            ->get(['id', 'name', 'location', 'capacity']);

        foreach ($venues as $venue) {
            $corpus[] = [
                'id' => 'rag-venue-'.$venue->id,
                'domain' => 'Events, Attendance & Venues',
                'primary' => "Venue: {$venue->name}",
                'secondary' => sprintf('Location: %s · Capacity: %d attendees', $venue->location ?: 'Main Campus', (int) $venue->capacity),
                'status' => 'Active venue',
                'status_tone' => 'info',
                'meta' => 'Cap: '.number_format((int) $venue->capacity),
                'href' => $this->routeAccess->hrefFor($role, $role === 'SUPER_ADMIN' ? '/dashboard/super-admin/venues' : '/dashboard/events'),
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
                    'href' => $this->routeAccess->hrefFor($role, '/dashboard/tasks'),
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

        // 8. Elections, Positions & Candidates
        $candidates = DB::table('candidates')
            ->join('elections', 'elections.id', '=', 'candidates.election_id')
            ->join('users', 'users.school_id', '=', 'candidates.user_id')
            ->join('election_positions', 'election_positions.id', '=', 'candidates.position_id')
            ->leftJoin('partylists', 'partylists.id', '=', 'candidates.partylist_id')
            ->whereIn('elections.organization_id', $orgIds)
            ->when(
                $role === 'STUDENT',
                fn ($q) => $q->whereNotNull('elections.finalized_at')->whereIn('elections.status', ['active', 'closed'])
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
                    'Partylist: %s · Election: %s%s',
                    $party,
                    $cand->election_title,
                    $cand->platform ? ' · Platform: '.Str::limit($cand->platform, 70) : ''
                ),
                'status' => Str::headline((string) $cand->election_status),
                'status_tone' => $cand->election_status === 'active' ? 'success' : 'info',
                'meta' => $party,
                'href' => $this->routeAccess->hrefFor($role, '/dashboard/elections/cast-vote'),
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

        // 9. Official Announcements & Bulletins
        $announcements = DB::table('announcements')
            ->leftJoin('organizations', 'organizations.id', '=', 'announcements.organization_id')
            ->where(function ($q) use ($orgIds) {
                $q->whereIn('announcements.organization_id', $orgIds)
                    ->orWhere('announcements.target_scope', 'university');
            })
            ->where('announcements.is_published', true)
            ->when(
                $role === 'STUDENT',
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
                    'Source: %s · Category: %s · %s',
                    $orgLabel,
                    Str::headline((string) ($ann->category ?: 'General')),
                    Str::limit(strip_tags((string) $ann->body), 80)
                ),
                'status' => $ann->is_pinned ? 'Pinned' : ($ann->is_important ? 'Important' : 'Published'),
                'status_tone' => $ann->is_important ? 'warning' : ($ann->is_pinned ? 'info' : 'success'),
                'meta' => $ann->published_at ? Carbon::parse($ann->published_at)->format('M j, Y') : 'Published',
                'href' => $this->routeAccess->hrefFor($role, '/dashboard/announcements'),
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
                    'File: %s · A.Y. %s%s',
                    $sub->file_original_name ?: 'Document',
                    $sub->academic_year,
                    $sub->remarks ? " · Remarks: {$sub->remarks}" : ''
                ),
                'status' => Str::headline((string) $sub->status),
                'status_tone' => $sub->status === 'approved' ? 'success' : ($sub->status === 'returned' ? 'danger' : 'warning'),
                'meta' => $sub->academic_year,
                'progress_percent' => $sub->status === 'approved' ? 100 : ($sub->status === 'submitted' ? 75 : 25),
                'href' => $this->routeAccess->hrefFor($role, $role === 'SUPER_ADMIN' ? '/dashboard/super-admin/compliance' : '/dashboard/compliance'),
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
                if (Str::contains($lower, $kw)) {
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
            'officers' => ['officer', 'sbo_officer', 'admin', 'leader', 'position'],
            'officer' => ['officer', 'sbo_officer', 'admin', 'leader'],
            'admins' => ['admin', 'administrator', 'president', 'adviser'],
            'dean' => ['department_head', 'dean', 'college'],
            'money' => ['budget', 'finance', 'transaction', 'amount', 'allocated', 'remaining'],
            'spent' => ['expense', 'transaction', 'budget', 'remaining'],
            'expenses' => ['expense', 'transaction', 'ledger', 'receipt'],
            'merch' => ['merchandise', 'stock', 'price', 'order', 'store'],
            'stock' => ['merchandise', 'stock_quantity', 'inventory', 'low'],
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

    private function roleName(string $role): string
    {
        return $role === 'SBO_OFFICER' ? 'SBO Officer' : Str::headline(Str::lower($role));
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
                    'id' => 'sao-howto-org',
                    'topic' => 'how_to_guide',
                    'label' => 'How do I create an organization?',
                    'question' => 'How do I create an organization?',
                    'description' => 'Step-by-step guide: academic year, requirements, college, organization, and its first admin.',
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
                    'description' => 'Organizations needing registration edits or an organization head.',
                ],
                [
                    'id' => 'dh-howto-endorse',
                    'topic' => 'how_to_guide',
                    'label' => 'How do I endorse an application?',
                    'question' => 'How do I endorse an application?',
                    'description' => 'Step-by-step guide for reviewing and endorsing public organization applications.',
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
                    'id' => 'adm-howto-event',
                    'topic' => 'how_to_guide',
                    'label' => 'How do I create an event?',
                    'question' => 'How do I create an event?',
                    'description' => 'Step-by-step guide for creating an event, uploading its requirements, and booking a venue.',
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
                    'id' => 'off-howto-orders',
                    'topic' => 'how_to_guide',
                    'label' => 'How do I verify orders?',
                    'question' => 'How do I verify orders?',
                    'description' => 'Step-by-step guide for checking GCash proof and releasing items at the claim desk.',
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
                    'id' => 'stu-howto-clearance',
                    'topic' => 'how_to_guide',
                    'label' => 'How do I check my clearance?',
                    'question' => 'How do I check my clearance?',
                    'description' => 'Step-by-step guide for reading your clearance lines and settling holds.',
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
