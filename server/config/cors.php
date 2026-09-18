<?php

return [
    'paths' => ['api/*', 'login', 'register', 'password/*', 'sanctum/csrf-cookie'],

    'allowed_methods' => ['*'],

    'allowed_origins' => array_values(array_unique(array_filter(array_merge(
        env('FRONTEND_URL') ? [env('FRONTEND_URL')] : [],
        preg_split('/\s*,\s*/', (string) env('FRONTEND_URLS', ''), -1, PREG_SPLIT_NO_EMPTY) ?: []
    )))),

    // Use || between multiple patterns. Commas cannot be the separator because
    // they are valid regex syntax (for example, the {1,3} IPv4 quantifier).
    'allowed_origins_patterns' => array_values(array_filter(array_map(
        'trim',
        explode('||', (string) env('FRONTEND_ORIGIN_PATTERNS', ''))
    ))),

    'allowed_headers' => ['*'],

    'exposed_headers' => [],

    'max_age' => 0,

    'supports_credentials' => true,
];
