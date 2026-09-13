<?php

namespace App\Services;

use App\Contracts\FingerprintMatcher;
use App\Exceptions\FingerprintMatcherRejected;
use App\Exceptions\FingerprintMatcherUnavailable;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class HttpFingerprintMatcher implements FingerprintMatcher
{
    public function __construct(
        private readonly string $baseUrl,
        private readonly ?string $apiKey = null,
        private readonly int $timeout = 15,
    ) {}

    public function enroll(array $samples, int $sampleFormat): array
    {
        $data = $this->post('/enroll', ['samples' => $samples, 'sample_format' => $sampleFormat]);

        if (! is_string($data['template'] ?? null) || ! is_string($data['template_format'] ?? null)) {
            throw new RuntimeException('The matching engine returned an invalid enrollment response.');
        }

        return ['template' => $data['template'], 'template_format' => $data['template_format']];
    }

    public function identify(array $candidates, array $samples, int $sampleFormat): array
    {
        $data = $this->post('/identify', [
            'candidates' => $candidates,
            'samples' => $samples,
            'sample_format' => $sampleFormat,
        ]);

        if (! is_array($data['candidates'] ?? null)) {
            throw new RuntimeException('The matching engine returned an invalid identification response.');
        }

        foreach ($data['candidates'] as $candidate) {
            if (! is_int($candidate['id'] ?? null)
                || ! is_bool($candidate['matched'] ?? null)
                || ! is_numeric($candidate['score'] ?? null)) {
                throw new RuntimeException('The matching engine returned an invalid identification candidate.');
            }
        }

        return ['candidates' => $data['candidates'], 'elapsed_ms' => $data['elapsed_ms'] ?? null];
    }

    private function post(string $path, array $payload): array
    {
        try {
            $request = Http::acceptJson()->asJson()->timeout($this->timeout);
            if ($this->apiKey) {
                $request = $request->withToken($this->apiKey);
            }

            $response = $request->post(rtrim($this->baseUrl, '/').$path, $payload);
            if ($response->status() === 422) {
                throw new FingerprintMatcherRejected(
                    $response->json('message') ?: 'The fingerprint capture was rejected by the matching service.'
                );
            }

            return $response->throw()->json();
        } catch (ConnectionException $exception) {
            throw new FingerprintMatcherUnavailable('The fingerprint matching service is unavailable.', 0, $exception);
        }
    }
}
