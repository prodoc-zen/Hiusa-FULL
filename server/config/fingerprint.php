<?php

return [
    'matcher' => env('FINGERPRINT_MATCHER_DRIVER', 'unavailable'),
    'http' => [
        'url' => env('FINGERPRINT_MATCHER_URL'),
        'key' => env('FINGERPRINT_MATCHER_KEY'),
        'timeout' => (int) env('FINGERPRINT_MATCHER_TIMEOUT', 15),
        'template_format' => env('FINGERPRINT_MATCHER_TEMPLATE_FORMAT', 'fscanner-sourceafis-dotnet-3.14.0-png-v1'),
    ],
    'identification' => [
        'minimum_score' => (float) env('FINGERPRINT_MIN_MATCH_SCORE', 60),
        'minimum_margin' => (float) env('FINGERPRINT_MIN_SCORE_MARGIN', 10),
        'confirmation_ttl_seconds' => (int) env('FINGERPRINT_CONFIRMATION_TTL_SECONDS', 120),
    ],
];
