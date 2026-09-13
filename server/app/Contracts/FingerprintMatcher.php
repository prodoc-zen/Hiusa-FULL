<?php

namespace App\Contracts;

interface FingerprintMatcher
{
    /** @return array{template: string, template_format: string} */
    public function enroll(array $samples, int $sampleFormat): array;

    /** @return array{candidates: array<int, array{id: int, matched: bool, score: float, threshold?: float}>, elapsed_ms?: float} */
    public function identify(array $candidates, array $samples, int $sampleFormat): array;
}
