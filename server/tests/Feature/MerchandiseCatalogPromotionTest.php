<?php

namespace Tests\Feature;

use App\Models\Merchandise;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class MerchandiseCatalogPromotionTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_manages_variant_stock_and_audit_with_organization_boundary(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $student = User::factory()->student()->create(['organization_id' => $organization->id]);
        Sanctum::actingAs($admin);

        $created = $this->postJson('/api/merchandise', [
            'name' => 'HIUSA Shirt', 'category' => 'Apparel', 'price' => 200,
            'stock_quantity' => 0, 'variants' => json_encode([
                ['name' => 'S', 'stock_quantity' => 2],
                ['name' => 'XL', 'stock_quantity' => 3],
            ]),
            'promotion_price' => 150, 'promotion_buyer_limit' => 1,
        ])->assertCreated()->assertJsonPath('stock_quantity', 5)
            ->assertJsonPath('is_low_stock', true);
        $itemId = $created->json('id');
        $variantId = $created->json('variants.0.id');

        $this->patchJson("/api/merchandise/{$itemId}/stock", [
            'stock_delta' => 4, 'note' => 'New delivery', 'variant_id' => $variantId,
        ])->assertOk()->assertJsonPath('stock_quantity', 9)
            ->assertJsonPath('variants.0.stock_quantity', 6);
        $this->patchJson("/api/merchandise/{$itemId}/stock", ['stock_delta' => 1, 'note' => 'Missing variant'])
            ->assertUnprocessable();
        $this->assertDatabaseHas('audit_logs', [
            'record_id' => $itemId, 'action' => 'stock_adjusted', 'user_id' => $admin->school_id,
        ]);
        $this->getJson("/api/merchandise/{$itemId}/audit-logs")->assertOk()->assertJsonCount(2);
        $variantUpdate = ['variants' => json_encode([
            ['id' => $variantId, 'name' => 'S', 'stock_quantity' => 7],
            ['id' => $created->json('variants.1.id'), 'name' => 'XL', 'stock_quantity' => 3],
        ])];
        $this->putJson("/api/merchandise/{$itemId}", $variantUpdate)->assertUnprocessable();
        $this->putJson("/api/merchandise/{$itemId}", [...$variantUpdate, 'stock_note' => 'Count correction'])
            ->assertOk()->assertJsonPath('stock_quantity', 10);

        Sanctum::actingAs($student);
        $this->patchJson("/api/merchandise/{$itemId}/stock", ['stock_delta' => 10, 'note' => 'No'])
            ->assertForbidden();
        $this->getJson("/api/merchandise/{$itemId}/audit-logs")->assertForbidden();

        $otherAdmin = User::factory()->admin()->create();
        Sanctum::actingAs($otherAdmin);
        $this->getJson("/api/merchandise/{$itemId}/audit-logs")->assertNotFound();
    }

    public function test_promotion_has_one_slot_per_buyer_and_orders_keep_their_price(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $firstBuyer = User::factory()->student()->create(['organization_id' => $organization->id]);
        $secondBuyer = User::factory()->student()->create(['organization_id' => $organization->id]);
        $item = Merchandise::factory()->create([
            'organization_id' => $organization->id, 'is_active' => true,
            'price' => 200, 'promotion_price' => 150, 'promotion_buyer_limit' => 1,
            'stock_quantity' => 6,
        ]);
        $variant = $item->variants()->create([
            'organization_id' => $organization->id, 'name' => 'M', 'stock_quantity' => 6,
        ]);

        Sanctum::actingAs($firstBuyer);
        $firstOrder = $this->postJson('/api/orders', [
            'merchandise_id' => $item->id, 'merchandise_variant_id' => $variant->id,
            'quantity' => 2, 'payment_method' => 'cash',
        ])->assertCreated()->assertJsonPath('total_price', '300.00')
            ->assertJsonPath('promotion_applied', true);
        $this->postJson('/api/orders', [
            'merchandise_id' => $item->id, 'merchandise_variant_id' => $variant->id,
            'quantity' => 1,
        ])->assertCreated()->assertJsonPath('promotion_applied', true);

        Sanctum::actingAs($secondBuyer);
        $this->postJson('/api/orders', [
            'merchandise_id' => $item->id, 'merchandise_variant_id' => $variant->id,
            'quantity' => 1,
        ])->assertCreated()->assertJsonPath('total_price', '200.00')
            ->assertJsonPath('promotion_applied', false);
        $competingOrder = $this->postJson('/api/orders', [
            'merchandise_id' => $item->id, 'merchandise_variant_id' => $variant->id,
            'quantity' => 5,
        ])->assertCreated();
        $this->postJson('/api/orders', ['merchandise_id' => $item->id, 'quantity' => 1])
            ->assertUnprocessable();

        Sanctum::actingAs($admin);
        $this->patchJson('/api/orders/'.$firstOrder->json('id').'/status', [
            'status' => 'paid', 'verified_amount' => 300,
        ])->assertOk();
        $this->assertSame(4, $item->fresh()->stock_quantity);
        $this->assertSame(4, $variant->fresh()->stock_quantity);
        $this->patchJson('/api/orders/'.$competingOrder->json('id').'/status', [
            'status' => 'paid', 'verified_amount' => 1000,
        ])->assertUnprocessable();
        $this->assertSame(4, $variant->fresh()->stock_quantity);
        $this->assertDatabaseHas('orders', [
            'id' => $firstOrder->json('id'), 'total_price' => 300, 'promotion_applied' => 1,
        ]);
        $this->getJson('/api/merchandise')->assertOk()->assertJsonPath('data.0.promotion_remaining', 0);
    }

    public function test_pending_legacy_order_prevents_converting_product_to_variants(): void
    {
        $organization = Organization::factory()->create();
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $buyer = User::factory()->student()->create(['organization_id' => $organization->id]);
        $item = Merchandise::factory()->create([
            'organization_id' => $organization->id, 'is_active' => true, 'stock_quantity' => 5,
        ]);

        Sanctum::actingAs($buyer);
        $this->postJson('/api/orders', ['merchandise_id' => $item->id, 'quantity' => 1])->assertCreated();

        Sanctum::actingAs($admin);
        $this->putJson('/api/merchandise/'.$item->id, [
            'variants' => json_encode([['name' => 'M', 'stock_quantity' => 5]]),
        ])->assertConflict();
        $this->assertSame(0, $item->variants()->count());
        $this->assertSame(5, $item->fresh()->stock_quantity);
    }
}
