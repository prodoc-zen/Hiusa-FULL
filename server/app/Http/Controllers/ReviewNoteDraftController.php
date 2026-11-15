<?php

namespace App\Http\Controllers;

use App\Models\AiOutput;
use App\Services\Ai\ReviewNoteContext;
use App\Services\Ai\ReviewNoteDrafter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Drafts the remarks for a decision the reviewer has already chosen. It reads the record through the same scope
 * rules as the decision route, fills nothing in by itself and writes one AiOutput so the outcome can be recorded.
 */
class ReviewNoteDraftController extends Controller
{
    private const CONTEXT = 'review-note-v1';

    public function __construct(
        private readonly ReviewNoteContext $context,
        private readonly ReviewNoteDrafter $drafter,
    ) {}

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'flow' => ['required', Rule::in(ReviewNoteContext::FLOWS)],
            'record_id' => ['required', 'integer', 'min:1'],
            'decision' => ['required', Rule::in(['returned', 'rejected', 'hold', 'resolved', 'dismissed', 'approved'])],
            'marks' => ['nullable', 'array', 'max:50'],
            'marks.*.requirement' => ['required', 'string', 'max:1000'],
            'marks.*.mark' => ['required', Rule::in(['accepted', 'ok', 'needs_changes', 'missing', 'none'])],
            'marks.*.note' => ['nullable', 'string', 'max:1000'],
            'reviewer_notes' => ['nullable', 'string', 'max:2000'],
            'current_text' => ['nullable', 'string', 'max:4000'],
        ]);

        $user = $request->user();
        $facts = $this->context->build(
            $user,
            $data['flow'],
            (int) $data['record_id'],
            $data['decision'],
            $data['marks'] ?? [],
            trim((string) ($data['reviewer_notes'] ?? '')),
            $data['current_text'] ?? null,
        );

        $draft = $this->drafter->draftFromFacts($facts);

        $aiOutput = AiOutput::create([
            'organization_id' => $user->organization_id,
            'feature_type' => 'review_note',
            'reference_type' => $data['flow'],
            'reference_id' => (int) $data['record_id'],
            'prompt_text' => 'Draft the remarks for one reviewer decision from the facts supplied.',
            'output_text' => $draft['text'],
            'model_name' => $draft['model'] ?? 'template-draft',
            'context_version' => self::CONTEXT,
            'structured_input' => $draft['facts'],
            'structured_output' => ['text' => $draft['text'], 'engine' => $draft['engine'], 'rejection' => $draft['rejection']],
            'status' => 'completed',
            'version' => ((int) AiOutput::where('organization_id', $user->organization_id)->where('feature_type', 'review_note')->max('version')) + 1,
            'decision_status' => 'pending',
            'requested_by' => $user->school_id,
            'created_at' => now(),
        ]);

        return response()->json(['text' => $draft['text'], 'engine' => $draft['engine'], 'ai_output_id' => $aiOutput->id]);
    }
}
