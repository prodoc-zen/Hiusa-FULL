<?php

return [
    'api_cache' => [
        'enabled' => env('API_RESPONSE_CACHE_ENABLED', true),
        'ttl_seconds' => (int) env('API_RESPONSE_CACHE_TTL', 20),
        'max_bytes' => (int) env('API_RESPONSE_CACHE_MAX_BYTES', 1048576),
    ],

    'rate_limits' => [
        'public_per_minute' => (int) env('RATE_LIMIT_PUBLIC_PER_MINUTE', 60),
        'read_per_minute' => (int) env('RATE_LIMIT_READ_PER_MINUTE', 120),
        'write_per_minute' => (int) env('RATE_LIMIT_WRITE_PER_MINUTE', 60),
        'expensive_per_minute' => (int) env('RATE_LIMIT_EXPENSIVE_PER_MINUTE', 10),
        'login_per_minute' => (int) env('RATE_LIMIT_LOGIN_PER_MINUTE', 10),
        'password_per_minute' => (int) env('RATE_LIMIT_PASSWORD_PER_MINUTE', 5),
        'registration_per_minute' => (int) env('RATE_LIMIT_REGISTRATION_PER_MINUTE', 5),
    ],
];
