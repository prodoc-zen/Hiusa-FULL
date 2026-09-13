<?php

namespace App\Services;

use App\Contracts\FingerprintMatcher;
use App\Exceptions\FingerprintMatcherUnavailable;

class UnavailableFingerprintMatcher implements FingerprintMatcher
{
    public function enroll(array $samples, int $sampleFormat): array
    {
        throw new FingerprintMatcherUnavailable('The fingerprint matching service is not configured.');
    }

    public function identify(array $candidates, array $samples, int $sampleFormat): array
    {
        throw new FingerprintMatcherUnavailable('The fingerprint matching service is not configured.');
    }
}
