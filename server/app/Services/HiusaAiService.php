<?php

namespace App\Services;

use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class HiusaAiService
{
    public function financialForecast(array $monthlyRecords, ?string $targetPeriod = null): ?array
    {
        return $this->post('/api/v1/financial-forecast', [
            'monthly_records' => $monthlyRecords,
            'target_period' => $targetPeriod,
        ]);
    }

    public function budgetAdvice(array $financials): ?array
    {
        return $this->post('/api/v1/budget-advice', $financials);
    }

    public function taskDelegation(string $taskTitle, array $officers, ?string $taskType = null): ?array
    {
        return $this->post('/api/v1/task-delegation', [
            'task_title' => $taskTitle,
            'task_type' => $taskType,
            'officers' => $officers,
            'max_active_tasks' => (int) config('services.hiusa_ai.task_max_active_tasks', 5),
            'recency_window_days' => (int) config('services.hiusa_ai.task_recency_window_days', 14),
            'weights' => config('services.hiusa_ai.task_weights'),
        ]);
    }

    public function grievanceClassification(string $title, string $description): ?array
    {
        return $this->post('/api/v1/grievance-classification', [
            'title' => $title,
            'description' => $description,
        ]);
    }

    private function post(string $path, array $payload): ?array
    {
        if (! config('services.hiusa_ai.enabled')) {
            return null;
        }

        $baseUrl = rtrim((string) config('services.hiusa_ai.url'), '/');

        try {
            $response = $this->request()->post($baseUrl.$path, $payload);

            if (! $response->successful()) {
                Log::warning('HIUSA AI service rejected a request.', [
                    'path' => $path,
                    'status' => $response->status(),
                ]);

                return null;
            }

            $result = $response->json();

            return is_array($result) ? $result : null;
        } catch (\Throwable $exception) {
            Log::warning('HIUSA AI service is unavailable; using the local fallback.', [
                'path' => $path,
                'error' => $exception->getMessage(),
            ]);

            return null;
        }
    }

    private function request(): PendingRequest
    {
        $request = Http::acceptJson()
            ->asJson()
            ->connectTimeout((int) config('services.hiusa_ai.connect_timeout', 1))
            ->timeout((int) config('services.hiusa_ai.timeout', 3));
        $key = trim((string) config('services.hiusa_ai.key'));

        return $key === '' ? $request : $request->withHeaders(['X-AI-Service-Key' => $key]);
    }
}
