<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Covers the authenticated-route throttling added in this pass: per-user
 * (not per-IP) buckets, a tighter ceiling on the AI generation endpoints,
 * a clean 429 instead of a 500, and the security headers on every API
 * response. See app/Providers/AppServiceProvider.php for the limiter
 * definitions and app/Providers/SecurityHeadersMiddleware.php for the headers.
 */
class ApiHardeningTest extends TestCase
{
    use RefreshDatabase;

    private function student(): User
    {
        return User::factory()->create([
            'organization_id' => Organization::factory(),
            'role' => 'STUDENT',
            'account_status' => 'active',
        ]);
    }

    private function admin(): User
    {
        return User::factory()->create([
            'organization_id' => Organization::factory(),
            'role' => 'ADMIN',
            'account_status' => 'active',
        ]);
    }

    public function test_ordinary_read_route_returns_429_with_retry_after_once_its_limit_is_exceeded(): void
    {
        $student = $this->student();
        Sanctum::actingAs($student);

        for ($i = 0; $i < 120; $i++) {
            $this->getJson('/api/announcements')->assertOk();
        }

        $response = $this->getJson('/api/announcements');

        $response->assertStatus(429);
        $this->assertTrue($response->headers->has('Retry-After'));
        $this->assertIsNumeric($response->headers->get('Retry-After'));
    }

    public function test_ai_generation_limit_is_tighter_than_the_ordinary_read_limit_and_both_fire(): void
    {
        $admin = $this->admin();
        Sanctum::actingAs($admin);

        $payload = [
            'title' => 'Test announcement',
            'target_role' => 'all',
        ];

        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/api/announcements/generate-draft', $payload)->assertOk();
        }

        // The 6th call in the same minute trips the tight ai-generation bucket.
        $this->postJson('/api/announcements/generate-draft', $payload)->assertStatus(429);

        // The same user, same minute, has made only 6 requests total - nowhere
        // near the much larger ordinary-read ceiling, so reads are unaffected.
        $this->getJson('/api/announcements')->assertOk();
    }

    public function test_two_different_users_do_not_share_a_rate_limit_bucket(): void
    {
        $first = $this->admin();
        $second = $this->admin();

        $payload = [
            'title' => 'Test announcement',
            'target_role' => 'all',
        ];

        Sanctum::actingAs($first);
        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/api/announcements/generate-draft', $payload)->assertOk();
        }
        $this->postJson('/api/announcements/generate-draft', $payload)->assertStatus(429);

        // A different authenticated user hitting the same endpoint, same minute,
        // is not affected - proof the limiter key is the user id, not shared state.
        Sanctum::actingAs($second);
        $this->postJson('/api/announcements/generate-draft', $payload)->assertOk();
    }

    public function test_guest_hitting_a_throttled_auth_route_still_gets_429(): void
    {
        $credentials = ['email' => 'nobody@example.com', 'password' => 'wrong-password', 'role' => 'STUDENT'];

        for ($i = 0; $i < 10; $i++) {
            $this->postJson('/api/login', $credentials);
        }

        $response = $this->postJson('/api/login', $credentials);

        $response->assertStatus(429);
        $this->assertTrue($response->headers->has('Retry-After'));
    }

    public function test_security_headers_are_present_on_api_responses(): void
    {
        $student = $this->student();
        Sanctum::actingAs($student);

        $response = $this->getJson('/api/announcements');

        $response->assertOk();
        $response->assertHeader('X-Content-Type-Options', 'nosniff');
        $response->assertHeader('X-Frame-Options', 'DENY');
        $response->assertHeader('Referrer-Policy', 'same-origin');
    }

    public function test_app_debug_false_returns_a_generic_error_with_no_stack_trace(): void
    {
        config(['app.debug' => false]);

        Route::get('/__api-hardening-test-explode', function () {
            throw new \RuntimeException('boom, this text must never reach the client');
        })->middleware('api');

        $admin = $this->admin();
        Sanctum::actingAs($admin);

        $response = $this->getJson('/__api-hardening-test-explode');

        $response->assertStatus(500);
        $response->assertJson(['message' => 'Server Error']);
        $response->assertJsonMissing(['exception']);
        $body = $response->getContent();
        $this->assertStringNotContainsString('boom, this text must never reach the client', $body);
        $this->assertStringNotContainsString(__FILE__, $body);
    }
}
