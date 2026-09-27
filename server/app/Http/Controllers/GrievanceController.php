<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\Grievance;
use App\Models\Notification;
use App\Models\User;
use App\Services\HiusaAiService;
use Illuminate\Http\Request;

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
    private const CRITICAL_KEYWORDS = ['emergency', 'danger', 'harassment', 'assault', 'police', 'threat', 'violence'];

    private const HIGH_KEYWORDS = ['urgent', 'fraud', 'stolen', 'corruption', 'embezzlement', 'severe', 'breach'];

    private const MEDIUM_KEYWORDS = ['broken', 'delay', 'missing', 'complaint', 'unfair', 'issue', 'problem'];

    private const CATEGORY_KEYWORDS = [
        'Safety & Security' => ['emergency', 'danger', 'harassment', 'assault', 'police', 'threat', 'violence', 'security', 'unsafe', 'guard', 'theft'],
        'Financial Integrity' => ['money', 'fund', 'fraud', 'receipt', 'budget', 'embezzlement', 'payment'],
        'Facilities & Maintenance' => ['broken', 'facility', 'dirty', 'aircon', 'chair', 'room', 'venue'],
        'Academic / Faculty' => ['grades', 'teacher', 'professor', 'exam', 'class', 'schedule'],
    ];

    public function __construct(private readonly HiusaAiService $aiService) {}

    public function index(Request $request)
    {
        $filters = $request->validate([
            'status' => ['nullable', 'in:submitted,under_review,resolved,dismissed'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $query = Grievance::with(['organization:id,name,acronym', 'submitter:school_id,first_name,last_name']);
        $query = match ($request->user()->role) {
            'STUDENT' => $query->where('submitted_by', $request->user()->school_id),
            'ADMIN' => $query->where('organization_id', $request->user()->organization_id),
            default => $query,
        };
        $query->when($filters['status'] ?? null, fn ($q, $status) => $q->where('status', $status));

        $grievances = $query->orderByDesc('created_at')->paginate($filters['per_page'] ?? 20);
        $grievances->getCollection()->transform(fn (Grievance $grievance) => $this->redact($grievance, $request->user()->role));

        return response()->json($grievances);
    }

    public function show(Request $request, Grievance $grievance)
    {
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

        AuditLog::create([
            'organization_id' => $organizationId,
            'user_id' => $request->user()->school_id,
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
            User::where('organization_id', $organizationId)->where('role', 'ADMIN')->where('account_status', 'active')
                ->get(['school_id', 'organization_id'])
                ->each(fn (User $admin) => Notification::create([
                    'organization_id' => $admin->organization_id,
                    'user_id' => $admin->school_id,
                    'notification_type' => 'general',
                    'title' => 'New grievance filed against your organization',
                    'message' => "A grievance was filed (\"{$grievance->category}\"). The filer's identity is confidential.",
                    'reference_type' => 'grievance',
                    'reference_id' => $grievance->id,
                    'is_read' => false,
                    'sent_at' => now(),
                ]));
        }

        return response()->json($this->redact($grievance, 'STUDENT'), 201);
    }

    public function updateStatus(Request $request, Grievance $grievance)
    {
        $data = $request->validate([
            'status' => ['required', 'in:under_review,resolved,dismissed'],
            'remarks' => ['nullable', 'string', 'max:2000', 'required_if:status,resolved', 'required_if:status,dismissed'],
        ]);

        $grievance->update([
            'status' => $data['status'],
            'remarks' => $data['remarks'] ?? $grievance->remarks,
            'resolved_at' => in_array($data['status'], ['resolved', 'dismissed'], true) ? now() : null,
        ]);

        AuditLog::create([
            'organization_id' => $grievance->organization_id,
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
                'message' => "Your grievance \"{$grievance->title}\" is now {$data['status']}.".(! empty($data['remarks']) ? ' Remarks: '.$data['remarks'] : ''),
                'reference_type' => 'grievance',
                'reference_id' => $grievance->id,
                'is_read' => false,
                'sent_at' => now(),
            ]);
        }

        return response()->json($this->redact($grievance->fresh(), 'SUPER_ADMIN'));
    }

    private function visibleTo(Grievance $grievance, $user): bool
    {
        return match ($user->role) {
            'STUDENT' => $grievance->submitted_by === $user->school_id,
            'ADMIN' => $grievance->organization_id === $user->organization_id,
            default => true,
        };
    }

    private function redact(Grievance $grievance, string $viewerRole): Grievance
    {
        if ($viewerRole === 'ADMIN' && $grievance->is_anonymous) {
            $grievance->makeHidden(['submitted_by', 'submitter']);
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
    private function localClassification(string $title, string $description): array
    {
        $text = mb_strtolower($title.' '.$description);

        if ($this->anyMatches($text, self::CRITICAL_KEYWORDS)) {
            $urgency = 'Critical';
            $confidence = 0.95;
        } elseif ($this->anyMatches($text, self::HIGH_KEYWORDS)) {
            $urgency = 'High';
            $confidence = 0.85;
        } elseif ($this->anyMatches($text, self::MEDIUM_KEYWORDS)) {
            $urgency = 'Medium';
            $confidence = 0.75;
        } else {
            $urgency = 'Low';
            $confidence = 0.5;
        }

        $category = 'General';
        $maxMatches = 0;
        foreach (self::CATEGORY_KEYWORDS as $candidate => $keywords) {
            $matches = 0;
            foreach ($keywords as $keyword) {
                if ($this->matches($text, $keyword)) {
                    $matches++;
                }
            }
            if ($matches > $maxMatches) {
                $maxMatches = $matches;
                $category = $candidate;
            }
        }

        return [
            'urgency' => $urgency,
            'category' => $category,
            'confidence_score' => $confidence,
            'reasoning' => "Determined {$urgency} urgency and the '{$category}' category from keyword analysis.",
        ];
    }

    private function anyMatches(string $text, array $keywords): bool
    {
        foreach ($keywords as $keyword) {
            if ($this->matches($text, $keyword)) {
                return true;
            }
        }

        return false;
    }

    private function matches(string $text, string $keyword): bool
    {
        return preg_match('/\b'.preg_quote($keyword, '/').'\b/u', $text) === 1;
    }
}
