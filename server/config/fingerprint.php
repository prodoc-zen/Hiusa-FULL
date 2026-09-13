<?php

return [
    'matcher' => env('FINGERPRINT_MATCHER_DRIVER', 'unavailable'),
    'http' => [
        'url' => env('FINGERPRINT_MATCHER_URL'),
        'key' => env('FINGERPRINT_MATCHER_KEY'),
        'timeout' => (int) env('FINGERPRINT_MATCHER_TIMEOUT', 15),
        'template_format' => env('FINGERPRINT_MATCHER_TEMPLATE_FORMAT', 'fscanner-sourceafis-dotnet-3.14.0-png-v1'),
    ],
];
