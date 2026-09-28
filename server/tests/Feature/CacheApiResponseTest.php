<?php

namespace Tests\Feature;

use App\Models\ApprovalRequest;
use App\Models\Budget;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class CacheApiResponseTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_briefing_is_fresh_after_super_admin_approves_a_different_orgs_request(): void
    {
        config(['performance.api_cache.enabled' => true, 'performance.api_cache.ttl_seconds' => 20]);

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
        $this->assertEquals(500.0, $first->json('pillars.finance.value'));

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
