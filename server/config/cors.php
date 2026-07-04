<?php

return [
    'paths' => ['api/*', 'login', 'register', 'sanctum/csrf-cookie'],

    'allowed_methods' => ['*'],

    'allowed_origins' => array_filter(array_merge(
        [
            'http://localhost:3000',
            'http://localhost:5173',
            'http://localhost:5174',
            'http://127.0.0.1:3000',
            'http://127.0.0.1:5173',
            'http://127.0.0.1:5174',
        ],
        env('FRONTEND_URL') ? [env('FRONTEND_URL')] : []
    )),

    'allowed_origins_patterns' => [],

    'allowed_headers' => ['*'],

    'exposed_headers' => [],

    'max_age' => 0,

    'supports_credentials' => true,
];
