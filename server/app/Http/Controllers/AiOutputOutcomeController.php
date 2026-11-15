<?php

namespace App\Http\Controllers;

use App\Models\AiOutput;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Records what a person did with a drafted text: sent it as it was, edited it first, or threw it away.
 * Only the language features that fill an editable field report here; the stored text is never changed.
 */
class AiOutputOutcomeController extends Controller
{
    private const FEATURES = ['review_note', 'report_check', 'semester_narrative', 'handover_note'];

    public function store(Request $request, AiOutput $aiOutput): JsonResponse
    {
        $user = $request->user();
        // A draft belongs to the person who asked for it; anyone else gets the same answer as for a missing one.
        if ((int) $aiOutput->requested_by !== (int) $user->school_id || ! in_array($aiOutput->feature_type, self::FEATURES, true)) {
            return response()->json(['message' => 'This draft could not be found.'], 404);
        }
        if ($aiOutput->decision_status !== 'pending') {
            return response()->json(['message' => 'This draft has already been recorded.'], 409);
        }

        $data = $request->validate([
            'final_text' => ['present', 'nullable', 'string', 'max:20000'],
        ]);

        $status = $this->outcome($aiOutput, $data['final_text']);

        // Guarded on the status again so two requests cannot both record an outcome.
        $changed = AiOutput::whereKey($aiOutput->id)->where('decision_status', 'pending')
            ->update(['decision_status' => $status, 'decided_by' => $user->school_id, 'decided_at' => now()]);
        if ($changed === 0) {
            return response()->json(['message' => 'This draft has already been recorded.'], 409);
        }

        return response()->json(['success' => true, 'data' => ['decision_status' => $status]]);
    }

    private function outcome(AiOutput $aiOutput, ?string $finalText): string
    {
        if ($finalText === null) {
            return 'discarded';
        }

        return $this->normalise($finalText) === $this->normalise($this->draftText($aiOutput->structured_output)) ? 'accepted' : 'edited';
    }

    /** The drafted text: a plain string, a `text` key, or every string leaf of a sectioned draft in order. */
    private function draftText(mixed $stored): string
    {
        if (is_string($stored)) {
            return $stored;
        }
        if (is_array($stored) && is_string($stored['text'] ?? null)) {
            return $stored['text'];
        }
        if (! is_array($stored)) {
            return '';
        }

        $parts = [];
        array_walk_recursive($stored, function ($value) use (&$parts) {
            if (is_string($value)) {
                $parts[] = $value;
            }
        });

        return implode(' ', $parts);
    }

    private function normalise(string $text): string
    {
        return trim((string) preg_replace('/\s+/u', ' ', $text));
    }
}
