<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\EvaluationResponse;
use App\Models\EvaluationWindow;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Validator;
use Symfony\Component\HttpFoundation\StreamedResponse;

class EvaluationController extends Controller
{
    private const OPERATING_ROLES = ['STUDENT', 'SBO_OFFICER', 'ADMIN', 'DEPARTMENT_HEAD'];

    public function current(Request $request)
    {
        $instrumentKey = $this->instrumentKeyForRole($request->user()->role);

        if (! $instrumentKey) {
            return response()->json(['message' => 'This role does not respond to the evaluation survey.'], 403);
        }

        $instrument = config("evaluation.instruments.{$instrumentKey}");
        $window = $this->openWindow();

        return response()->json([
            'window' => $window ? $window->only(['id', 'title', 'description', 'opens_at', 'closes_at', 'status']) : null,
            'respondent_type' => $instrumentKey,
            'instrument' => [
                'label' => $instrument['label'],
                'items' => $instrument['items'],
            ],
            'responded' => $window
                ? EvaluationResponse::where('evaluation_window_id', $window->id)
                    ->where('user_id', $request->user()->school_id)
                    ->exists()
                : false,
        ]);
    }

    public function storeResponse(Request $request)
    {
        $instrumentKey = $this->instrumentKeyForRole($request->user()->role);

        if (! $instrumentKey) {
            return response()->json(['message' => 'This role does not respond to the evaluation survey.'], 403);
        }

        $window = $this->openWindow();

        if (! $window) {
            return response()->json(['message' => 'There is no evaluation window currently open.'], 422);
        }

        $alreadyResponded = EvaluationResponse::where('evaluation_window_id', $window->id)
            ->where('user_id', $request->user()->school_id)
            ->exists();

        if ($alreadyResponded) {
            return response()->json(['message' => 'You have already submitted a response for this evaluation window.'], 409);
        }

        $items = config("evaluation.instruments.{$instrumentKey}.items");

        $validated = Validator::make($request->all(), array_merge(
            ['consent' => ['required', 'accepted']],
            $this->answerRules($items)
        ))->validate();

        $answersInput = $validated['answers'] ?? [];
        $profile = [];
        $answers = [];
        $feedback = null;

        foreach ($items as $item) {
            if (! array_key_exists($item['code'], $answersInput)) {
                continue;
            }

            $value = $answersInput[$item['code']];

            if ($item['section'] === 'A') {
                $profile[$item['code']] = $value;
            } elseif ($item['section'] === 'F') {
                $feedback = $value;
            } else {
                $answers[$item['code']] = $value;
            }
        }

        try {
            $response = EvaluationResponse::create([
                'evaluation_window_id' => $window->id,
                'organization_id' => $request->user()->organization_id,
                'user_id' => $request->user()->school_id,
                'respondent_type' => $instrumentKey,
                'consent_given_at' => now(),
                'profile' => $profile,
                'answers' => $answers,
                'feedback' => $feedback,
                'submitted_at' => now(),
            ]);
        } catch (UniqueConstraintViolationException $e) {
            return response()->json(['message' => 'You have already submitted a response for this evaluation window.'], 409);
        }

        return response()->json($response, 201);
    }

    public function results(Request $request)
    {
        $scope = $this->resultsScope($request);

        if ($scope instanceof \Illuminate\Http\JsonResponse) {
            return $scope;
        }

        return response()->json($this->computeResults($scope));
    }

    public function exportResults(Request $request): StreamedResponse|\Illuminate\Http\JsonResponse
    {
        $scope = $this->resultsScope($request);

        if ($scope instanceof \Illuminate\Http\JsonResponse) {
            return $scope;
        }

        $results = $this->computeResults($scope);

        return response()->streamDownload(function () use ($results) {
            $handle = fopen('php://output', 'w');
            fputcsv($handle, ['Respondent Type', 'Section', 'Item Code', 'N', 'Weighted Mean', 'Std Dev', 'Dist 1', 'Dist 2', 'Dist 3', 'Dist 4', 'Dist 5', 'Label']);

            foreach ($results['groups'] as $respondentType => $group) {
                if ($group['anonymized']) {
                    fputcsv($handle, [$respondentType, '', '', $group['n'], '', '', '', '', '', '', '', 'Withheld (n < '.$group['anonymity_threshold'].')']);

                    continue;
                }

                foreach ($group['sections'] as $sectionCode => $section) {
                    foreach ($section['items'] as $item) {
                        $dist = $item['distribution'];
                        fputcsv($handle, [
                            $respondentType, $sectionCode, $item['code'], $item['n'], $item['mean'], $item['sd'],
                            $dist[1], $dist[2], $dist[3], $dist[4], $dist[5], $item['label'],
                        ]);
                    }
                    fputcsv($handle, [$respondentType, $sectionCode, 'SECTION_MEAN', $group['n'], $section['mean'], '', '', '', '', '', '', $section['label']]);
                }
                fputcsv($handle, [$respondentType, '', 'OVERALL_MEAN', $group['n'], $group['overall_mean'], '', '', '', '', '', '', $group['overall_label']]);
            }

            fclose($handle);
        }, 'evaluation-results-'.now()->format('Y-m-d-His').'.csv', ['Content-Type' => 'text/csv']);
    }

    public function windowsIndex(Request $request)
    {
        $windows = EvaluationWindow::withCount('responses')
            ->orderByDesc('created_at')
            ->paginate(20);

        return response()->json($windows);
    }

    public function windowsStore(Request $request)
    {
        $data = $request->validate([
            'title' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'opens_at' => ['nullable', 'date'],
            'closes_at' => ['nullable', 'date', 'after_or_equal:opens_at'],
            'status' => ['nullable', 'in:draft,open,closed'],
        ]);

        $window = EvaluationWindow::create([
            ...$data,
            'status' => $data['status'] ?? 'draft',
            'created_by' => $request->user()->school_id,
        ]);

        $this->recordEvaluationAudit($request, 'window_created', $window->id, null, $window->toArray());

        if ($window->status === 'open') {
            $this->notifyOperatingRoles($window);
        }

        return response()->json($window, 201);
    }

    public function windowsUpdate(Request $request, $id)
    {
        $window = EvaluationWindow::find($id);

        if (! $window) {
            return response()->json(['message' => 'Evaluation window not found.'], 404);
        }

        $data = $request->validate([
            'title' => ['sometimes', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'opens_at' => ['nullable', 'date'],
            'closes_at' => ['nullable', 'date', 'after_or_equal:opens_at'],
            'status' => ['sometimes', 'in:draft,open,closed'],
        ]);

        $oldValues = $window->only(['title', 'description', 'opens_at', 'closes_at', 'status']);
        $wasOpen = $window->status === 'open';

        $window->update($data);
        $window->refresh();

        $this->recordEvaluationAudit(
            $request,
            array_keys($data) === ['status'] ? 'window_status_changed' : 'window_updated',
            $window->id,
            $oldValues,
            $window->only(['title', 'description', 'opens_at', 'closes_at', 'status'])
        );

        if (! $wasOpen && $window->status === 'open') {
            $this->notifyOperatingRoles($window);
        }

        return response()->json($window);
    }

    private function instrumentKeyForRole(string $role): ?string
    {
        return config("evaluation.role_instruments.{$role}");
    }

    private function openWindow(): ?EvaluationWindow
    {
        $now = now();

        return EvaluationWindow::where('status', 'open')
            ->where(fn ($query) => $query->whereNull('opens_at')->orWhere('opens_at', '<=', $now))
            ->where(fn ($query) => $query->whereNull('closes_at')->orWhere('closes_at', '>=', $now))
            ->orderByDesc('created_at')
            ->first();
    }

    private function answerRules(array $items): array
    {
        $rules = [];

        foreach ($items as $item) {
            $key = "answers.{$item['code']}";
            $presence = $item['required'] ? 'required' : 'nullable';

            $rules[$key] = match ($item['type']) {
                'likert' => [$presence, 'integer', 'between:1,5'],
                'single_choice' => [$presence, 'in:'.implode(',', array_column($item['options'], 'value'))],
                'multi_choice' => array_filter([$presence, 'array', $item['required'] ? 'min:1' : null]),
                'text' => [$presence, 'string', 'max:2000'],
                default => [$presence],
            };

            if ($item['type'] === 'multi_choice') {
                $rules["{$key}.*"] = ['in:'.implode(',', array_column($item['options'], 'value'))];
            }
        }

        return $rules;
    }

    private function resultsScope(Request $request): array|\Illuminate\Http\JsonResponse
    {
        $filters = $request->validate([
            'organization_id' => ['nullable', 'integer', 'exists:organizations,id'],
            'respondent_type' => ['nullable', 'in:student,officer,adviser'],
        ]);

        $role = $request->user()->role;

        if ($role === 'SUPER_ADMIN') {
            return [
                'organization_id' => $filters['organization_id'] ?? null,
                'respondent_type' => $filters['respondent_type'] ?? null,
            ];
        }

        if (! empty($filters['organization_id']) && (int) $filters['organization_id'] !== (int) $request->user()->organization_id) {
            return response()->json(['message' => 'You may only view results for your own organization.'], 403);
        }

        return [
            'organization_id' => $request->user()->organization_id,
            'respondent_type' => $filters['respondent_type'] ?? null,
        ];
    }

    private function computeResults(array $scope): array
    {
        $query = EvaluationResponse::query();

        if ($scope['organization_id']) {
            $query->where('organization_id', $scope['organization_id']);
        }

        if ($scope['respondent_type']) {
            $query->where('respondent_type', $scope['respondent_type']);
        }

        $responses = $query->get(['organization_id', 'respondent_type', 'answers', 'feedback']);
        $threshold = (int) config('evaluation.anonymity_threshold');
        $respondentTypes = $scope['respondent_type'] ? [$scope['respondent_type']] : array_keys(config('evaluation.role_instruments'));
        $respondentTypes = collect($respondentTypes)->map(fn ($v) => config("evaluation.role_instruments.{$v}") ?? $v)->unique()->values();

        $groups = [];

        foreach ($respondentTypes as $type) {
            $groupResponses = $responses->where('respondent_type', $type);
            $n = $groupResponses->count();

            if ($n === 0) {
                continue;
            }

            if ($n < $threshold) {
                $groups[$type] = [
                    'n' => $n,
                    'anonymized' => true,
                    'anonymity_threshold' => $threshold,
                    'message' => "Fewer than {$threshold} responses were collected for this group, so aggregated statistics are withheld to protect respondent anonymity.",
                ];

                continue;
            }

            $items = collect(config("evaluation.instruments.{$type}.items"))
                ->where('type', 'likert');

            $sections = [];
            $sectionMeans = [];

            foreach ($items->groupBy('section') as $sectionCode => $sectionItems) {
                $itemStats = [];
                $itemMeans = [];

                foreach ($sectionItems as $item) {
                    $values = $groupResponses->map(fn ($r) => $r->answers[$item['code']] ?? null)->filter(fn ($v) => $v !== null)->values();
                    $stats = $this->weightedStats($values);
                    $stats['code'] = $item['code'];
                    $stats['label'] = $this->likertLabel($stats['mean'])['label'];
                    $itemStats[] = $stats;
                    $itemMeans[] = $stats['mean'];
                }

                $sectionMean = round(collect($itemMeans)->avg(), 2);
                $sectionMeans[] = $sectionMean;

                $sections[$sectionCode] = [
                    'label' => config("evaluation.sections.{$sectionCode}.label"),
                    'objective' => config("evaluation.sections.{$sectionCode}.objective"),
                    'items' => $itemStats,
                    'mean' => $sectionMean,
                    'label_interpretation' => $this->likertLabel($sectionMean)['label'],
                ];
            }

            $overallMean = round(collect($sectionMeans)->avg(), 2);

            $groups[$type] = [
                'n' => $n,
                'anonymized' => false,
                'sections' => $sections,
                'overall_mean' => $overallMean,
                'overall_label' => $this->likertLabel($overallMean)['label'],
                'feedback' => $groupResponses->pluck('feedback')->filter(fn ($v) => filled($v))->values()->all(),
            ];
        }

        return [
            'scope' => $scope,
            'groups' => $groups,
        ];
    }

    private function weightedStats(Collection $values): array
    {
        $n = $values->count();
        $distribution = [1 => 0, 2 => 0, 3 => 0, 4 => 0, 5 => 0];

        foreach ($values as $value) {
            $distribution[(int) $value] = ($distribution[(int) $value] ?? 0) + 1;
        }

        $mean = $n > 0 ? round($values->avg(), 2) : 0.0;

        $variance = 0.0;
        if ($n > 1) {
            $sumSquares = $values->reduce(fn ($carry, $v) => $carry + (($v - $mean) ** 2), 0.0);
            $variance = $sumSquares / ($n - 1);
        }
        $sd = round(sqrt($variance), 2);

        $percentages = [];
        foreach ($distribution as $score => $count) {
            $percentages[$score] = $n > 0 ? round(($count / $n) * 100, 1) : 0.0;
        }

        return [
            'n' => $n,
            'mean' => $mean,
            'sd' => $sd,
            'distribution' => $distribution,
            'percentages' => $percentages,
        ];
    }

    private function likertLabel(float $mean): array
    {
        foreach (config('evaluation.likert_labels') as $band) {
            if ($mean >= $band['min'] && $mean <= $band['max']) {
                return $band;
            }
        }

        return ['min' => 0, 'max' => 0, 'label' => 'Undecided'];
    }

    private function notifyOperatingRoles(EvaluationWindow $window): void
    {
        $now = now();

        Organization::pluck('id')->each(function ($organizationId) use ($window, $now) {
            $userIds = User::where('organization_id', $organizationId)
                ->whereIn('role', self::OPERATING_ROLES)
                ->where('account_status', 'active')
                ->pluck('school_id');

            foreach ($userIds->chunk(100) as $chunk) {
                Notification::insert($chunk->map(fn ($userId) => [
                    'organization_id' => $organizationId,
                    'user_id' => $userId,
                    'notification_type' => 'general',
                    'title' => 'HIUSA Evaluation Survey Now Open: '.$window->title,
                    'message' => 'Your feedback on HIUSA is now open for collection. Please take a few minutes to complete the evaluation survey.',
                    'reference_type' => EvaluationWindow::class,
                    'reference_id' => $window->id,
                    'is_read' => false,
                    'sent_at' => $now,
                    'created_at' => $now,
                    'updated_at' => $now,
                ])->all());
            }
        });
    }

    private function recordEvaluationAudit(Request $request, string $action, int $windowId, ?array $oldValues, ?array $newValues): void
    {
        AuditLog::create([
            'organization_id' => $request->user()?->organization_id,
            'user_id' => $request->user()?->school_id,
            'actor_role' => $request->user()?->role,
            'module' => 'evaluation',
            'action' => $action,
            'description' => 'SAO director '.str_replace('_', ' ', $action).' for evaluation window #'.$windowId.'.',
            'record_type' => EvaluationWindow::class,
            'record_id' => $windowId,
            'old_values' => $oldValues,
            'new_values' => $newValues,
            'ip_address' => $request->ip(),
            'created_at' => now(),
        ]);
    }
}
