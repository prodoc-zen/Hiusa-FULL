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
        'model' => env('GROQ_MODEL', 'openai/gpt-oss-120b'),
        'reasoning_effort' => env('GROQ_REASONING_EFFORT', 'medium'),
        // Seconds for the whole call. GroqResponsesService caps this at 12 because callers run inside a web request,
        // so a higher value has no effect.
        'timeout' => env('GROQ_TIMEOUT', 12),
        'connect_timeout' => env('GROQ_CONNECT_TIMEOUT', 5),
        'announcement_daily_limit' => env('ANNOUNCEMENT_AI_DAILY_LIMIT', 20),
    ],

    'anthropic' => [
        'key' => env('ANTHROPIC_API_KEY'),
        // One-shot structured calls (advice, narratives, notes, plans) run adaptive thinking on this model at this effort.
        'model' => env('ANTHROPIC_MODEL', 'claude-opus-5-5'),
        'effort' => env('ANTHROPIC_EFFORT', 'medium'),
        // Seconds for the whole call, capped at 30 in ClaudeMessagesService (a higher value has no effect). The SDK
        // enforces no timeout itself, so the HTTP transport carries it. ANTHROPIC_CHAT_TIMEOUT below is not capped at 30.
        // Claude and Groq share one 37 second deadline per request (this 25 plus Groq's 12), so a timed-out Claude
        // leaves Groq its whole turn; keep the web server's read timeout above 37 seconds.
        'timeout' => env('ANTHROPIC_TIMEOUT', 25),
        'connect_timeout' => env('ANTHROPIC_CONNECT_TIMEOUT', 3),
        // Ask AI conversations stream and think, so they get their own model, effort and a longer ceiling: chat_timeout is
        // the wall-clock limit for the whole turn, and a stream silent for 15 seconds ends sooner.
        'chat_model' => env('ANTHROPIC_CHAT_MODEL', 'claude-opus-5-5'),
        'chat_effort' => env('ANTHROPIC_CHAT_EFFORT', 'high'),
        'chat_timeout' => env('ANTHROPIC_CHAT_TIMEOUT', 60),
    ],

    'ai' => [
        // anthropic = Claude first, Groq as fallback. groq = Groq only. Blank follows the key: Claude only when a key exists.
        'provider' => env('AI_PROVIDER'),
        // Seconds a provider is skipped after it timed out or could not connect. 0 turns the cooling-off off.
        'cooldown_seconds' => env('AI_PROVIDER_COOLDOWN_SECONDS', 60),
        // Seconds both providers share to draft an event's to-do plan, which is longer than any other call. Claude gets
        // three quarters of it and Groq the rest; their usual request caps (30 and 12 seconds) are lifted to this for that call only.
        'plan_deadline_seconds' => (int) env('AI_PLAN_DEADLINE_SECONDS', 30),
    ],

    'edp' => [
        'driver' => env('EDP_DRIVER', 'local'),
        'url' => env('EDP_URL'),
        'key' => env('EDP_KEY'),
        'timeout' => (int) env('EDP_TIMEOUT', 5),
    ],

];
