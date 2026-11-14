<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\Grievance;
use App\Models\Notification;
use App\Models\User;
use App\Services\HiusaAiService;
use App\Services\OrganizationRecipients;
use App\Support\FilterValues;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Confidential grievances. A STUDENT files one addressed either to their own
 * organization or directly to SAO; organization_id is always derived from
 * the authenticated student and is never accepted from input.
 *
 * Anonymity rule: is_anonymous only hides the filer's identity from the
 * organization's ADMIN - it never hides that a grievance exists. SUPER_ADMIN
 * always sees the filer's identity, for safeguarding: SAO must be able to
 * follow up directly with a student regardless of anonymity toward the org.
 * The filer always sees their own submissions. Redaction happens at the
 * response layer (redact()), never by omitting submitted_by from storage,
 * so the student's own "my grievances" view keeps working even when
 * anonymous toward their organization.
 */
class GrievanceController extends Controller
{
    /** A keyword ending in "*" is a stem matched at the start of a word; any other keyword is a whole word. */
    private const CRITICAL_KEYWORDS = [
        'emergency', 'danger', 'harass*', 'assault*', 'police', 'threat*', 'violen*', 'abus*',
        'bully', 'bullied', 'bullying', 'banta', 'binantaan', 'gibantaan', 'pagbabanta', 'pananakit', 'sinaktan',
    ];

    private const HIGH_KEYWORDS = [
        'urgent', 'fraud*', 'steal*', 'stole*', 'theft', 'thief', 'brib*', 'corruption', 'corrupt', 'embezzl*', 'severe', 'breach',
        'nakaw*', 'ninakaw*', 'nagnakaw*', 'nanakaw*', 'kawat', 'gikawat', 'gikawatan',
    ];

    private const MEDIUM_KEYWORDS = ['broken', 'delay*', 'missing', 'complaint*', 'unfair', 'issue*', 'problem*'];

    /**
     * An urgency keyword is dropped only when one of these directly denies it: the negator is the word right before the
     * keyword, or right before "a", "an", "any" or "the" and then the keyword, in the same clause. Anything between them
     * ("not stop bullying") keeps the word, so whenever it is unclear the higher urgency wins.
     */
    private const NEGATORS = ['not', 'no', 'hindi', 'dili', 'walang', 'wala', 'walay', "wala'y", 'di'];

    private const ARTICLES = ['a', 'an', 'any', 'the'];

    private const CATEGORY_KEYWORDS = [
        'Safety & Security' => [...self::CRITICAL_KEYWORDS, 'security', 'unsafe', 'guard', 'theft'],
        'Financial Integrity' => ['money', 'fund', 'funds', 'funding', 'fraud*', 'receipt*', 'budget*', 'embezzl*', 'payment*', 'steal*', 'stole*', 'brib*', 'theft'],
        'Facilities & Maintenance' => ['broken', 'facilit*', 'dirty', 'aircon', 'chair', 'chairs', 'room', 'rooms', 'venue', 'venues'],
        'Academic / Faculty' => ['grade*', 'teacher*', 'professor*', 'exam', 'exams', 'class', 'classes', 'schedul*'],
    ];

    public function __construct(
        private readonly HiusaAiService $aiService,
        private readonly OrganizationRecipients $recipients,
    ) {}

    public function index(Request $request)
    {
        $filters = $request->validate([
            'status' => ['nullable', FilterValues::rule(['nullable', 'in:submitted,under_review,resolved,dismissed'])],
            'urgency' => ['nullable', FilterValues::rule(['nullable', 'in:Low,Medium,High,Critical'])],
            'category' => ['nullable', FilterValues::rule(['nullable', 'string', 'max:100'])],
            'addressed_to' => ['nullable', FilterValues::rule(['nullable', 'in:organization,sao'])],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
            'sort' => ['nullable', 'in:created_at,urgency'],
            'direction' => ['nullable', 'in:asc,desc'],
        ]);

        $query = Grievance::with(['organization:id,name,acronym', 'submitter:school_id,first_name,last_name']);
        $query = match ($request->user()->role) {
            'STUDENT' => $query->withTrashed()->where('submitted_by', $request->user()->school_id),
            'ADMIN' => $query->where('organization_id', $request->user()->organization_id),
            default => $query,
        };
        $query
            ->when($filters['status'] ?? null, fn ($q, $status) => $q->whereIn('status', FilterValues::values($status)))
            ->when($filters['urgency'] ?? null, fn ($q, $urgency) => $q->whereIn('urgency', FilterValues::values($urgency)))
            ->when($filters['category'] ?? null, fn ($q, $category) => $q->whereIn('category', FilterValues::values($category)))
            ->when($filters['addressed_to'] ?? null, function ($q, $addressedTo) {
                $values = FilterValues::values($addressedTo);
                if (count($values) === 1) {
                    $values[0] === 'sao' ? $q->whereNull('organization_id') : $q->whereNotNull('organization_id');
                }
            });

        $byUrgency = ($filters['sort'] ?? 'created_at') === 'urgency';
        $direction = $filters['direction'] ?? ($byUrgency ? 'asc' : 'desc');
        if ($byUrgency) {
            $query->orderByRaw("CASE urgency WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 WHEN 'Low' THEN 3 ELSE 4 END {$direction}")->orderByDesc('created_at');
        } else {
            $query->orderBy('created_at', $direction);
        }
        $grievances = $query->orderByDesc('id')->paginate($filters['per_page'] ?? 20);
        $grievances->getCollection()->transform(fn (Grievance $grievance) => $this->redact($grievance, $request->user()->role));

        return response()->json($grievances);
    }

    public function show(Request $request, Grievance $grievance)
    {
        if ($grievance->trashed() && $request->user()->role !== 'STUDENT') {
            return response()->json(['message' => 'Grievance not found.'], 404);
        }
        if (! $this->visibleTo($grievance, $request->user())) {
            return response()->json(['message' => 'Grievance not found.'], 404);
        }

        return response()->json($this->redact($grievance->load(['organization:id,name,acronym', 'submitter:school_id,first_name,last_name']), $request->user()->role));
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'title' => ['required', 'string', 'max:255'],
            'description' => ['required', 'string', 'max:5000'],
            'addressed_to' => ['required', 'in:organization,sao'],
            'is_anonymous' => ['sometimes', 'boolean'],
        ]);

        $organizationId = $data['addressed_to'] === 'organization' ? $request->user()->organization_id : null;
        $classification = $this->aiService->grievanceClassification($data['title'], $data['description']);
        $engine = 'ai-service';
        if (! $this->validClassification($classification)) {
            $classification = $this->localClassification($data['title'], $data['description']);
            $engine = 'php-fallback';
        }

        $grievance = Grievance::create([
            'organization_id' => $organizationId,
            'submitted_by' => $request->user()->school_id,
            'is_anonymous' => $data['is_anonymous'] ?? false,
            'title' => $data['title'],
            'description' => $data['description'],
            'category' => $classification['category'],
            'urgency' => $classification['urgency'],
            'classification_confidence' => $classification['confidence_score'],
            'classification_reasoning' => $classification['reasoning'],
            'classification_engine' => $engine,
            'status' => 'submitted',
        ]);

        // organization_id and user_id are intentionally null here: the filer's
        // identity already lives on the grievance row (record_id), and this
        // row must never resolve to a name/school_id/email through the
        // general org audit feed, anonymous or not. See auditLogs() in
        // FinancialAccountabilityController, which excludes this module for
        // every role except SUPER_ADMIN.
        AuditLog::create([
            'organization_id' => null,
            'user_id' => null,
            'actor_role' => $request->user()->role,
            'module' => 'grievances',
            'action' => 'grievance_filed',
            'record_type' => Grievance::class,
            'record_id' => $grievance->id,
            'new_values' => ['addressed_to' => $data['addressed_to'], 'is_anonymous' => $grievance->is_anonymous, 'urgency' => $grievance->urgency, 'category' => $grievance->category],
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);

        User::where('role', 'SUPER_ADMIN')->where('account_status', 'active')->get(['school_id', 'organization_id'])
            ->each(fn (User $sao) => Notification::create([
                'organization_id' => $sao->organization_id,
                'user_id' => $sao->school_id,
                'notification_type' => 'general',
                'title' => 'New grievance filed',
                'message' => "A {$grievance->urgency} urgency grievance was filed (\"{$grievance->category}\").",
                'reference_type' => 'grievance',
                'reference_id' => $grievance->id,
                'is_read' => false,
                'sent_at' => now(),
            ]));

        if ($organizationId) {
            $this->recipients->administrators($organizationId)
                ->each(fn ($admin) => Notification::create([
                    'organization_id' => $admin->organization_id,
                    'user_id' => $admin->user_school_id,
                    'notification_type' => 'general',
                    'title' => 'New grievance filed against your organization',
                    'message' => "A grievance was filed (\"{$grievance->category}\"). ".($grievance->is_anonymous ? 'The student chose to stay anonymous to your organization.' : "The student's name is shown on the grievance."),
                    'reference_type' => 'grievance',
                    'reference_id' => $grievance->id,
                    'is_read' => false,
                    'sent_at' => now(),
                ]));
        }

        return response()->json($this->redact($grievance, 'STUDENT'), 201);
    }

    private const ALLOWED_STATUS_TRANSITIONS = [
        'submitted' => ['under_review', 'resolved', 'dismissed'],
        'under_review' => ['resolved', 'dismissed'],
    ];

    public function updateStatus(Request $request, Grievance $grievance)
    {
        if (! $this->canTransition($grievance, $request->user())) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        $data = $request->validate([
            'status' => ['required', 'in:under_review,resolved,dismissed'],
            'remarks' => ['nullable', 'string', 'max:2000', 'required_if:status,resolved', 'required_if:status,dismissed'],
        ]);

        $allowed = self::ALLOWED_STATUS_TRANSITIONS[$grievance->status] ?? [];
        if (! in_array($data['status'], $allowed, true)) {
            return response()->json(['message' => "This grievance is {$grievance->status} and cannot be moved to {$data['status']}."], 409);
        }

        $grievance->update([
            'status' => $data['status'],
            'remarks' => $data['remarks'] ?? $grievance->remarks,
            'resolved_at' => in_array($data['status'], ['resolved', 'dismissed'], true) ? now() : null,
        ]);

        // Reviewer actions record the acting reviewer and organization while preserving student filer anonymity in store().
        AuditLog::create([
            'organization_id' => $grievance->organization_id ?? $request->user()->organization_id,
            'user_id' => $request->user()->school_id,
            'actor_role' => $request->user()->role,
            'module' => 'grievances',
            'action' => 'grievance_status_updated',
            'record_type' => Grievance::class,
            'record_id' => $grievance->id,
            'new_values' => ['status' => $data['status'], 'remarks' => $data['remarks'] ?? null],
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);

        $filer = User::find($grievance->submitted_by);
        if ($filer) {
            Notification::create([
                'organization_id' => $filer->organization_id,
                'user_id' => $filer->school_id,
                'notification_type' => 'general',
                'title' => 'Your grievance was updated',
                'message' => "Your grievance \"{$grievance->title}\" is now ".str_replace('_', ' ', $data['status']).'.'.(! empty($data['remarks']) ? ' Remarks: '.$data['remarks'] : ''),
                'reference_type' => 'grievance',
                'reference_id' => $grievance->id,
                'is_read' => false,
                'sent_at' => now(),
            ]);
        }

        return response()->json($this->redact($grievance->fresh(), $request->user()->role));
    }

    public function updateClassification(Request $request, Grievance $grievance)
    {
        $data = $request->validate([
            'urgency' => ['required', 'in:Low,Medium,High,Critical'],
            'category' => ['required', 'in:'.implode(',', [...array_keys(self::CATEGORY_KEYWORDS), 'General'])],
        ]);

        $before = ['urgency' => $grievance->urgency, 'category' => $grievance->category];
        $grievance->update([
            'urgency' => $data['urgency'],
            'category' => $data['category'],
            'machine_urgency' => $grievance->machine_urgency ?? $before['urgency'],
            'machine_category' => $grievance->machine_category ?? $before['category'],
            'classification_engine' => 'reviewer',
            'classification_corrected_by' => $request->user()->school_id,
            'classification_corrected_at' => now(),
        ]);

        AuditLog::create([
            'organization_id' => $grievance->organization_id ?? $request->user()->organization_id,
            'user_id' => $request->user()->school_id,
            'actor_role' => $request->user()->role,
            'module' => 'grievances',
            'action' => 'grievance_classification_corrected',
            'record_type' => Grievance::class,
            'record_id' => $grievance->id,
            'old_values' => $before,
            'new_values' => $data,
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);

        return response()->json($this->redact($grievance->fresh(['organization:id,name,acronym', 'submitter:school_id,first_name,last_name']), $request->user()->role));
    }

    public function destroy(Request $request, Grievance $grievance)
    {
        $student = $request->user()->role === 'STUDENT';
        if (! ($student ? $grievance->submitted_by === $request->user()->school_id : $this->canTransition($grievance, $request->user()))) {
            return response()->json(['message' => 'Grievance not found.'], 404);
        }
        DB::transaction(function () use ($request, $grievance, $student) {
            $grievance = Grievance::whereKey($grievance->id)->lockForUpdate()->firstOrFail();
            if ($student) {
                abort_unless($grievance->status === 'submitted', 409, 'Only grievances that have not been reviewed can be deleted.');
                Notification::where('reference_type', 'grievance')->where('reference_id', $grievance->id)->delete();
                AuditLog::create(['organization_id' => null, 'user_id' => null, 'actor_role' => 'STUDENT', 'module' => 'grievances', 'action' => 'grievance_deleted', 'record_type' => Grievance::class, 'record_id' => $grievance->id, 'new_values' => ['urgency' => $grievance->urgency, 'category' => $grievance->category], 'ip_address' => $request->ip(), 'created_at' => now()]);
                $grievance->forceDelete();

                return;
            }
            abort_unless(in_array($grievance->status, ['resolved', 'dismissed'], true), 409, 'Resolve or dismiss the grievance with remarks before deleting it from the review register.');
            AuditLog::create(['organization_id' => $grievance->organization_id ?? $request->user()->organization_id, 'user_id' => $request->user()->school_id, 'actor_role' => $request->user()->role, 'module' => 'grievances', 'action' => 'closed_grievance_deleted', 'record_type' => Grievance::class, 'record_id' => $grievance->id, 'new_values' => ['status' => $grievance->status], 'ip_address' => $request->ip(), 'created_at' => now()]);
            $grievance->delete();
        });

        return $student ? response()->json(['message' => 'Grievance deleted.']) : response()->noContent();
    }

    private function visibleTo(Grievance $grievance, $user): bool
    {
        return match ($user->role) {
            'STUDENT' => $grievance->submitted_by === $user->school_id,
            'ADMIN' => $grievance->organization_id === $user->organization_id,
            default => true,
        };
    }

    /**
     * Grievances addressed to SAO (organization_id is null) may only be
     * transitioned by SUPER_ADMIN. Grievances addressed to an organization
     * may only be transitioned by SUPER_ADMIN or that organization's own
     * ADMIN - never an ADMIN of a different organization.
     */
    private function canTransition(Grievance $grievance, $user): bool
    {
        if ($user->role === 'SUPER_ADMIN') {
            return true;
        }

        return $user->role === 'ADMIN'
            && $grievance->organization_id !== null
            && $grievance->organization_id === $user->organization_id;
    }

    private function redact(Grievance $grievance, string $viewerRole): Grievance
    {
        if ($viewerRole === 'ADMIN' && $grievance->is_anonymous) {
            $grievance->makeHidden(['submitted_by', 'submitter']);
        }
        if ($viewerRole !== 'SUPER_ADMIN') {
            $grievance->makeHidden(['classification_corrected_by']);
        }

        return $grievance;
    }

    private function validClassification(?array $classification): bool
    {
        return $classification
            && in_array($classification['urgency'] ?? null, ['Low', 'Medium', 'High', 'Critical'], true)
            && ! empty($classification['category'])
            && is_numeric($classification['confidence_score'] ?? null)
            && ! empty($classification['reasoning']);
    }

    /**
     * Deterministic mirror of ai-service/app/engines/grievance_classification.py.
     * Keep both in sync: this is what runs when the AI service is unreachable
     * or returns 401.
     */
    public function localClassification(string $title, string $description): array
    {
        $text = mb_strtolower($title.'. '.$description);

        $urgency = 'Low';
        $confidence = 0.5;
        $urgencyWords = [];
        foreach ([['Critical', self::CRITICAL_KEYWORDS, 0.95], ['High', self::HIGH_KEYWORDS, 0.85], ['Medium', self::MEDIUM_KEYWORDS, 0.75]] as [$level, $keywords, $score]) {
            $urgencyWords = $this->words($text, $keywords);
            if ($urgencyWords !== []) {
                $urgency = $level;
                $confidence = $score;
                break;
            }
        }

        $denied = [];
        foreach ([...self::CRITICAL_KEYWORDS, ...self::HIGH_KEYWORDS, ...self::MEDIUM_KEYWORDS] as $keyword) {
            $this->found($text, $keyword, $denied);
        }

        $category = 'General';
        $categoryWords = [];
        foreach (self::CATEGORY_KEYWORDS as $candidate => $keywords) {
            $words = $this->words($text, $keywords);
            if (count($words) > count($categoryWords)) {
                $categoryWords = $words;
                $category = $candidate;
            }
        }

        return [
            'urgency' => $urgency,
            'category' => $category,
            'confidence_score' => $confidence,
            'reasoning' => $this->reasoning($urgency, $urgencyWords, $category, $categoryWords).$this->denialNote($denied),
        ];
    }

    private function reasoning(string $urgency, array $urgencyWords, string $category, array $categoryWords): string
    {
        if ($urgencyWords === [] && $categoryWords === []) {
            return "No urgent or category words were found, so it is {$urgency} and {$category} until a reviewer looks at it.";
        }
        $first = $urgencyWords !== []
            ? "Marked {$urgency} because the text mentions ".$this->quoted($urgencyWords)
            : "No urgent words were found, so it is {$urgency}";
        $second = $categoryWords !== []
            ? "filed under {$category} because it mentions ".$this->quoted($categoryWords)
            : "no category words were found, so it is filed under {$category}";

        return "{$first}; {$second}.";
    }

    private function quoted(array $words): string
    {
        return $this->joined(array_map(fn (string $word) => '"'.$word.'"', $words));
    }

    private function joined(array $items): string
    {
        $items = array_slice($items, 0, 5);
        $last = array_pop($items);

        return $items === [] ? $last : implode(', ', $items).' and '.$last;
    }

    /** @param list<array{string, string}> $denied */
    private function denialNote(array $denied): string
    {
        if ($denied === []) {
            return '';
        }
        $pairs = $this->joined(array_map(fn (array $pair) => '"'.$pair[0].'" after "'.$pair[1].'"', $denied));

        return " It also mentions {$pairs}, which was not counted as urgent; a reviewer should check it.";
    }

    /** @return list<string> the words in the text that the keywords matched, in keyword order, without repeats */
    private function words(string $text, array $keywords): array
    {
        $words = [];
        foreach ($keywords as $keyword) {
            $word = $this->found($text, $keyword);
            if ($word !== null && ! in_array($word, $words, true)) {
                $words[] = $word;
            }
        }

        return $words;
    }

    /** @param list<array{string, string}>|null $denied filled with a word that matched only after a denial, and its negator */
    private function found(string $text, string $keyword, ?array &$denied = null): ?string
    {
        $pattern = str_ends_with($keyword, '*')
            ? '/\b'.preg_quote(substr($keyword, 0, -1), '/').'\w*/u'
            : '/\b'.preg_quote($keyword, '/').'\b/u';
        preg_match_all($pattern, $text, $matches, PREG_OFFSET_CAPTURE);
        $blocked = null;
        foreach ($matches[0] as [$word, $offset]) {
            $negator = $this->isUrgencyKeyword($keyword) ? $this->negator($text, $offset) : null;
            if ($negator === null) {
                return $word;
            }
            $blocked ??= [$word, $negator];
        }
        if ($blocked !== null && $denied !== null && ! in_array($blocked, $denied, true)) {
            $denied[] = $blocked;
        }

        return null;
    }

    private function isUrgencyKeyword(string $keyword): bool
    {
        return in_array($keyword, [...self::CRITICAL_KEYWORDS, ...self::HIGH_KEYWORDS, ...self::MEDIUM_KEYWORDS], true);
    }

    private function negator(string $text, int $offset): ?string
    {
        $clause = preg_split('/[.!?;,:\n]/u', substr($text, 0, $offset));
        preg_match_all("/[\\w']+/u", end($clause), $words);
        $words = $words[0];
        if ($words !== [] && in_array(end($words), self::ARTICLES, true)) {
            array_pop($words);
        }

        return $words !== [] && in_array(end($words), self::NEGATORS, true) ? end($words) : null;
    }
}
