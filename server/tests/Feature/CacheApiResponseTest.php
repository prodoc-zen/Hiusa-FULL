<?php

namespace Tests\Feature;

use App\Http\Middleware\CacheApiResponse;
use App\Models\ApprovalRequest;
use App\Models\Budget;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

class CacheApiResponseTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    public function test_write_invalidation_generates_new_namespace_tokens_without_reading_old_versions(): void
    {
        config(['performance.api_cache.enabled' => true]);
        $user = User::factory()->superAdmin()->create();
        $request = Request::create('/api/cache-audit', 'POST');
        $request->setUserResolver(fn () => $user);
        $tokens = [];
        Cache::shouldReceive('get')->never();
        Cache::shouldReceive('put')->times(3)->withArgs(function ($key, $token, $expires) use (&$tokens) {
            $tokens[] = $token;

            return str_starts_with($key, 'api-response-version:') && Str::isUuid($token) && $expires->isFuture();
        })->andReturn(true);
        $this->assertSame(200, (new CacheApiResponse)->handle($request, fn () => response()->json([]))->getStatusCode());
        $this->assertCount(3, array_unique($tokens));
    }

    public function test_a_refresh_recomputes_and_replaces_the_server_cache(): void
    {
        config(['performance.api_cache.enabled' => true]);
        $user = User::factory()->admin()->create();
        $request = Request::create('/api/cache-audit');
        $request->setUserResolver(fn () => $user);
        $middleware = new CacheApiResponse;
        $calls = 0;
        $next = function () use (&$calls) {
            return response()->json(['revision' => ++$calls]);
        };
        $this->assertSame('MISS', $middleware->handle($request, $next)->headers->get('X-Cache'));
        $this->assertSame('HIT', $middleware->handle($request, $next)->headers->get('X-Cache'));
        $request->headers->set('Cache-Control', 'no-cache');
        $fresh = $middleware->handle($request, $next);
        $this->assertSame(2, json_decode($fresh->getContent(), true)['revision']);
        $request->headers->remove('Cache-Control');
        $this->assertSame(2, json_decode($middleware->handle($request, $next)->getContent(), true)['revision']);
        $this->assertSame(2, $calls);
    }

    public function test_server_cache_respects_no_store_and_preserves_vary_headers(): void
    {
        config(['performance.api_cache.enabled' => true]);
        $user = User::factory()->admin()->create();
        $request = Request::create('/api/cache-audit');
        $request->setUserResolver(fn () => $user);
        $middleware = new CacheApiResponse;
        $calls = 0;
        $next = function () use (&$calls) {
            return response()->json(['revision' => ++$calls])->header('Cache-Control', 'private, no-store');
        };
        $middleware->handle($request, $next);
        $this->assertTrue($middleware->handle($request, $next)->headers->hasCacheControlDirective('no-store'));
        $this->assertSame(2, $calls);

        $request = Request::create('/api/cache-vary');
        $request->setUserResolver(fn () => $user);
        $next = fn () => response()->json([])->header('Vary', 'Origin');
        foreach (['MISS', 'HIT'] as $status) {
            $response = $middleware->handle($request, $next);
            $this->assertSame($status, $response->headers->get('X-Cache'));
            $this->assertContains('Origin', $response->getVary());
        }
        foreach (['W/'.$response->headers->get('ETag'), '*'] as $etag) {
            $request->headers->set('If-None-Match', $etag);
            $notModified = $middleware->handle($request, $next);
            $this->assertSame(304, $notModified->getStatusCode());
            $this->assertContains('Origin', $notModified->getVary());
        }
    }

    public function test_version_lookup_failure_bypasses_cached_data_instead_of_using_an_old_namespace(): void
    {
        config(['performance.api_cache.enabled' => true]);
        $user = User::factory()->admin()->create();
        $request = Request::create('/api/cache-audit');
        $request->setUserResolver(fn () => $user);
        Cache::shouldReceive('get')->with('api-response-version:organization:'.$user->organization_id, 1)->once()->andThrow(new \RuntimeException('Cache unavailable'));
        $response = (new CacheApiResponse)->handle($request, fn () => response()->json(['fresh' => true]));
        $this->assertTrue(json_decode($response->getContent(), true)['fresh']);
        $this->assertNull($response->headers->get('X-Cache'));
    }

    public function test_a_no_store_request_never_reuses_or_replaces_cached_content(): void
    {
        config(['performance.api_cache.enabled' => true]);
        $user = User::factory()->admin()->create();
        $request = Request::create('/api/cache-audit');
        $request->setUserResolver(fn () => $user);
        $middleware = new CacheApiResponse;
        $calls = 0;
        $next = function () use (&$calls) {
            return response()->json(['revision' => ++$calls]);
        };
        $middleware->handle($request, $next);
        $request->headers->set('Cache-Control', 'no-store');
        $this->assertSame(2, json_decode($middleware->handle($request, $next)->getContent(), true)['revision']);
        $request->headers->remove('Cache-Control');
        $this->assertSame(1, json_decode($middleware->handle($request, $next)->getContent(), true)['revision']);
    }

    public function test_admin_briefing_is_fresh_after_super_admin_approves_a_different_orgs_request(): void
    {
        config(['performance.api_cache.enabled' => true, 'performance.api_cache.ttl_seconds' => 20]);
        // A SUPER_ADMIN budget decision only exists when the optional SAO stage is on.
        config(['approvals.budget_final' => 'SUPER_ADMIN']);

        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);
        $superAdmin = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);

        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);

        $budget = Budget::factory()->create([
            'organization_id' => $organization->id,
            'allocated_amount' => 1000,
            'remaining_amount' => 500,
            'submission_status' => 'pending_sao',
        ]);
        $approval = ApprovalRequest::create([
            'organization_id' => $organization->id,
            'entity_type' => 'budget',
            'entity_id' => $budget->id,
            'requested_by' => $admin->school_id,
            'required_role' => 'SUPER_ADMIN',
            'status' => 'pending',
            'requested_at' => now(),
        ]);

        Sanctum::actingAs($admin);
        $first = $this->getJson('/api/dashboard/briefing')->assertOk();
        $this->assertSame('MISS', $first->headers->get('X-Cache'));
        // A budget still awaiting SAO approval is not yet available money.
        $this->assertEquals(0.0, $first->json('pillars.finance.value'));

        // Sanity check: without any intervening write the same request is
        // actually served from cache, so the freshness assertion below is
        // testing real invalidation and not just an always-MISS endpoint.
        $this->app['auth']->forgetGuards();
        Sanctum::actingAs($admin);
        $cached = $this->getJson('/api/dashboard/briefing')->assertOk();
        $this->assertSame('HIT', $cached->headers->get('X-Cache'));

        // SUPER_ADMIN belongs to the SAO organization, not $organization, so
        // the old per-org-only invalidation left $organization's cache
        // version untouched and its ADMIN kept hitting stale data.
        $this->app['auth']->forgetGuards();
        Sanctum::actingAs($superAdmin);
        $this->patchJson("/api/approval-requests/{$approval->id}", ['status' => 'approved'])->assertOk();

        $this->app['auth']->forgetGuards();
        Sanctum::actingAs($admin);
        $after = $this->getJson('/api/dashboard/briefing')->assertOk();
        $this->assertSame('MISS', $after->headers->get('X-Cache'), 'Admin briefing must be fresh, not a stale cache hit, after a SUPER_ADMIN write to another org.');
        $this->assertEquals(1000.0, $after->json('pillars.finance.value'));
    }

    public function test_admin_briefing_is_fresh_after_a_department_head_approves_a_student_organization_budget(): void
    {
        config(['performance.api_cache.enabled' => true, 'performance.api_cache.ttl_seconds' => 20]);

        $college = $this->makeCollege('CCS');
        $this->makeCollegeHome($college);
        $head = $this->makeCollegeHead($college);
        $organization = $this->makeCollegeStudentOrganization($college);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);

        $budget = Budget::factory()->create([
            'organization_id' => $organization->id,
            'allocated_amount' => 1000,
            'remaining_amount' => 1000,
            'submission_status' => 'pending_department_head',
        ]);
        $approval = ApprovalRequest::create([
            'organization_id' => $organization->id,
            'entity_type' => 'budget',
            'entity_id' => $budget->id,
            'requested_by' => $admin->school_id,
            'required_role' => 'DEPARTMENT_HEAD',
            'status' => 'pending',
            'requested_at' => now(),
        ]);

        Sanctum::actingAs($admin);
        $first = $this->getJson('/api/dashboard/briefing')->assertOk();
        $this->assertSame('MISS', $first->headers->get('X-Cache'));
        $this->assertEquals(0.0, $first->json('pillars.finance.value'));

        $this->app['auth']->forgetGuards();
        Sanctum::actingAs($admin);
        $this->assertSame('HIT', $this->getJson('/api/dashboard/briefing')->assertOk()->headers->get('X-Cache'));

        $this->app['auth']->forgetGuards();
        Sanctum::actingAs($head);
        $this->patchJson("/api/approval-requests/{$approval->id}", ['status' => 'approved'])->assertOk();

        $this->app['auth']->forgetGuards();
        Sanctum::actingAs($admin);
        $after = $this->getJson('/api/dashboard/briefing')->assertOk();
        $this->assertSame('MISS', $after->headers->get('X-Cache'), 'The Admin must not see a stale cache hit after the Department Head decides.');
        $this->assertEquals(1000.0, $after->json('pillars.finance.value'));
    }

    public function test_super_admin_view_is_fresh_after_any_orgs_admin_writes(): void
    {
        config(['performance.api_cache.enabled' => true, 'performance.api_cache.ttl_seconds' => 20]);

        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);
        $superAdmin = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);

        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);

        Sanctum::actingAs($superAdmin);
        $first = $this->getJson('/api/dashboard/briefing')->assertOk();
        $this->assertSame('MISS', $first->headers->get('X-Cache'));

        $this->app['auth']->forgetGuards();
        Sanctum::actingAs($superAdmin);
        $cached = $this->getJson('/api/dashboard/briefing')->assertOk();
        $this->assertSame('HIT', $cached->headers->get('X-Cache'));

        $this->app['auth']->forgetGuards();
        Sanctum::actingAs($admin);
        $this->putJson('/api/user/profile', ['first_name' => 'Updated', 'last_name' => $admin->last_name, 'email' => $admin->email])->assertOk();

        $this->app['auth']->forgetGuards();
        Sanctum::actingAs($superAdmin);
        $after = $this->getJson('/api/dashboard/briefing')->assertOk();
        $this->assertSame('MISS', $after->headers->get('X-Cache'), 'SUPER_ADMIN briefing must be fresh after any organization write, not a stale cache hit.');
    }
}
