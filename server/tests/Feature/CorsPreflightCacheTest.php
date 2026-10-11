<?php

namespace Tests\Feature;

use Tests\TestCase;

class CorsPreflightCacheTest extends TestCase
{
    public function test_preflight_answers_tell_the_browser_to_cache_them_for_ten_minutes(): void
    {
        $this->withHeaders([
            'Origin' => 'http://localhost:5173',
            'Access-Control-Request-Method' => 'GET',
            'Access-Control-Request-Headers' => 'authorization',
        ])->options('/api/tasks')
            ->assertNoContent()
            ->assertHeader('Access-Control-Allow-Origin', 'http://localhost:5173')
            ->assertHeader('Access-Control-Max-Age', '600');
    }
}
