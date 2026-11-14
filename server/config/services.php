<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    'hiusa_ai' => [
        'enabled' => env('HIUSA_AI_SERVICE_ENABLED', true),
        'url' => env('HIUSA_AI_SERVICE_URL', 'http://localhost:8001'),
        'key' => env('HIUSA_AI_SERVICE_KEY'),
        'connect_timeout' => env('HIUSA_AI_SERVICE_CONNECT_TIMEOUT', 1),
        'timeout' => env('HIUSA_AI_SERVICE_TIMEOUT', 3),
        'task_max_active_tasks' => env('HIUSA_TASK_MAX_ACTIVE_TASKS', 5),
        'task_recency_window_days' => env('HIUSA_TASK_RECENCY_WINDOW_DAYS', 14),
        'task_weights' => [
            'position' => env('HIUSA_TASK_POSITION_WEIGHT', 0.35),
            'workload' => env('HIUSA_TASK_WORKLOAD_WEIGHT', 0.30),
            'performance' => env('HIUSA_TASK_PERFORMANCE_WEIGHT', 0.20),
            'recency' => env('HIUSA_TASK_RECENCY_WEIGHT', 0.15),
        ],
    ],

    'groq' => [
        'key' => env('GROQ_API_KEY'),
        'url' => env('GROQ_API_URL', 'https://api.groq.com/openai/v1/responses'),
        'model' => env('GROQ_MODEL', 'openai/gpt-oss-20b'),
        'reasoning_effort' => env('GROQ_REASONING_EFFORT', 'low'),
        // Seconds for the whole call. GroqResponsesService caps this at 12 because callers run inside a web request,
        // so a higher value has no effect.
        'timeout' => env('GROQ_TIMEOUT', 12),
        'connect_timeout' => env('GROQ_CONNECT_TIMEOUT', 5),
        'announcement_daily_limit' => env('ANNOUNCEMENT_AI_DAILY_LIMIT', 20),
    ],

    'anthropic' => [
        'key' => env('ANTHROPIC_API_KEY'),
        'model' => env('ANTHROPIC_MODEL', 'claude-sonnet-5-5'),
        'effort' => env('ANTHROPIC_EFFORT', 'low'),
        // Seconds for the whole call, capped at 12 in ClaudeMessagesService (a higher value has no effect). The SDK
        // enforces no timeout itself, so the HTTP transport carries it. ANTHROPIC_CHAT_TIMEOUT below is not capped at 12.
        'timeout' => env('ANTHROPIC_TIMEOUT', 12),
        'connect_timeout' => env('ANTHROPIC_CONNECT_TIMEOUT', 3),
        // Ask AI conversations stream and think, so they get their own effort and a longer total timeout.
        'chat_effort' => env('ANTHROPIC_CHAT_EFFORT', 'medium'),
        'chat_timeout' => env('ANTHROPIC_CHAT_TIMEOUT', 60),
    ],

    'ai' => [
        // anthropic = Claude first, Groq as fallback. groq = Groq only. Blank follows the key: Claude only when a key exists.
        'provider' => env('AI_PROVIDER'),
        // Seconds a provider is skipped after it timed out or could not connect. 0 turns the cooling-off off.
        'cooldown_seconds' => env('AI_PROVIDER_COOLDOWN_SECONDS', 60),
    ],

    'edp' => [
        'driver' => env('EDP_DRIVER', 'local'),
        'url' => env('EDP_URL'),
        'key' => env('EDP_KEY'),
        'timeout' => (int) env('EDP_TIMEOUT', 5),
    ],

];
