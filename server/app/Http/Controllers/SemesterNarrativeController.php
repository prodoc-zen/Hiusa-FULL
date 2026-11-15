<?php

namespace App\Http\Controllers;

use App\Models\AcademicSemester;
use App\Models\AiOutput;
use App\Services\Ai\SemesterNarrativeDrafter;
use App\Services\Records\TermDigest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Drafts the narrative sections of the Semestral Accomplishment Report for the signed-in Admin's or officer's own
 * organization from what the system recorded that semester. The draft is returned, never saved to a requirement.
 */
class SemesterNarrativeController extends Controller
{
    public function __construct(private readonly SemesterNarrativeDrafter $drafter) {}

    public function draft(Request $request): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate(['semester_id' => ['required', 'integer', 'exists:academic_semesters,id']]);
        abort_unless($user->organization_id, 403, 'Your account is not attached to an organization.');

        $semester = AcademicSemester::findOrFail($data['semester_id']);
        abort_if($semester->status === 'upcoming', 422, 'This semester has not started, so there is nothing to write about yet.');

        $digest = TermDigest::forOrganization($user->organization_id, $semester->id);
        $draft = $this->drafter->draftFromDigest($digest);
        $text = implode("\n\n", $draft['sections']);

        $aiOutput = AiOutput::create([
            'organization_id' => $user->organization_id,
            'feature_type' => 'semester_narrative',
            'reference_type' => 'academic_semester',
            'reference_id' => $semester->id,
            'prompt_text' => 'Semester accomplishment narrative',
            'output_text' => $text,
            'model_name' => $draft['model'] ?? 'template-draft',
            'context_version' => 'semester-narrative-v1',
            'structured_input' => $digest,
            'structured_output' => ['text' => $text, 'sections' => $draft['sections'], 'engine' => $draft['engine']],
            'status' => 'completed',
            'version' => ((int) AiOutput::where('organization_id', $user->organization_id)
                ->where('feature_type', 'semester_narrative')->where('reference_id', $semester->id)->max('version')) + 1,
            'decision_status' => 'pending',
            'requested_by' => $user->school_id,
            'created_at' => now(),
        ]);

        return response()->json([
            'text' => $text,
            'sections' => $draft['sections'],
            'engine' => $draft['engine'],
            'ai_output_id' => $aiOutput->id,
            'facts' => $digest,
        ]);
    }
}
