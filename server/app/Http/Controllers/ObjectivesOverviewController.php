<?php

namespace App\Http\Controllers;

use App\Services\Objectives\ObjectivesEvidenceService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /objectives/overview: live evidence per objective of the study, for the
 * "Study objectives in action" page. Contract: docs/api/objectives-overview.md.
 */
class ObjectivesOverviewController extends Controller
{
    private const RESPONDENT_LABELS = [
        'student' => 'students',
        'officer' => 'officers',
        'adviser' => 'advisers',
    ];

    public function __invoke(Request $request, ObjectivesEvidenceService $evidence): JsonResponse
    {
        return response()->json($evidence->overview($request->user(), $this->acceptability($request)));
    }

    /**
     * Acceptability comes from the evaluation results endpoint itself, so its
     * anonymity threshold, self-respondent guard and complementary
     * suppression apply unchanged. Only closed windows ever yield a mean.
     */
    private function acceptability(Request $request): array
    {
        if (! in_array($request->user()->role, ['SUPER_ADMIN', 'ADMIN', 'DEPARTMENT_HEAD'], true)) {
            return [];
        }

        $resultsRequest = Request::create('/api/evaluation/results', 'GET');
        $resultsRequest->setUserResolver(fn () => $request->user());
        $response = app(EvaluationController::class)->results($resultsRequest);

        if ($response->getStatusCode() !== 200) {
            return [];
        }

        $payload = $response->getData(true);
        if (($payload['window']['status'] ?? null) !== 'closed') {
            return [];
        }

        $groups = [];
        foreach ($payload['groups'] ?? [] as $type => $group) {
            $groups[] = [
                'code' => self::RESPONDENT_LABELS[$type] ?? $type,
                'n' => (int) ($group['n'] ?? 0),
                'anonymized' => (bool) ($group['anonymized'] ?? true),
                'overall_mean' => isset($group['overall_mean']) ? (float) $group['overall_mean'] : null,
                'overall_label' => $group['overall_label'] ?? null,
            ];
        }

        return $groups;
    }
}
