<?php

namespace Tests\Feature;

use App\Models\Merchandise;
use App\Models\Order;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** The merchandise DELETE route removes a catalog item while preserving completed order history. */
class MerchandiseDeactivateTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->organization = Organization::factory()->create();
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        Sanctum::actingAs($this->admin);
    }

    public function test_an_item_with_a_pending_order_refuses_to_delete(): void
    {
        $item = Merchandise::factory()->create(['organization_id' => $this->organization->id, 'is_active' => true]);
        $buyer = User::factory()->student()->create(['organization_id' => $this->organization->id]);
        Order::create([
            'organization_id' => $this->organization->id, 'student_id' => $buyer->school_id, 'merchandise_id' => $item->id,
            'quantity' => 1, 'total_price' => (float) $item->price, 'payment_method' => 'cash', 'status' => 'pending',
            'officer_review_status' => 'pending', 'admin_review_status' => 'pending', 'claim_token' => 'DEACTIVATE0001',
        ]);

        $response = $this->deleteJson("/api/merchandise/{$item->id}")->assertConflict();

        $this->assertSame('Cannot delete an item with pending or paid orders.', $response->json('message'));
        $this->assertTrue($item->fresh()->is_active);
        $this->assertNull($item->fresh()->deleted_at);
    }

    public function test_an_item_with_a_pending_or_paid_order_cannot_be_set_inactive(): void
    {
        foreach (['pending', 'paid'] as $status) {
            $item = Merchandise::factory()->create(['organization_id' => $this->organization->id, 'is_active' => true]);
            $buyer = User::factory()->student()->create(['organization_id' => $this->organization->id]);
            Order::create([
                'organization_id' => $this->organization->id, 'student_id' => $buyer->school_id, 'merchandise_id' => $item->id,
                'quantity' => 1, 'total_price' => (float) $item->price, 'payment_method' => 'cash', 'status' => $status,
                'officer_review_status' => 'pending', 'admin_review_status' => 'pending', 'claim_token' => 'INACTIVE'.strtoupper($status).'01',
            ]);

            $response = $this->putJson("/api/merchandise/{$item->id}", ['is_active' => false])->assertConflict();

            $this->assertSame('Cannot deactivate an item with pending or paid orders. Approve, reject or hand over those orders first.', $response->json('message'));
            $this->assertTrue($item->fresh()->is_active);
        }
    }

    public function test_an_item_with_only_claimed_orders_can_be_set_inactive_and_active_again(): void
    {
        $item = Merchandise::factory()->create(['organization_id' => $this->organization->id, 'is_active' => true]);
        $buyer = User::factory()->student()->create(['organization_id' => $this->organization->id]);
        Order::create([
            'organization_id' => $this->organization->id, 'student_id' => $buyer->school_id, 'merchandise_id' => $item->id,
            'quantity' => 1, 'total_price' => (float) $item->price, 'payment_method' => 'cash', 'status' => 'claimed',
            'officer_review_status' => 'approved', 'admin_review_status' => 'approved', 'claim_token' => 'INACTIVECLAIM01',
        ]);

        $this->putJson("/api/merchandise/{$item->id}", ['is_active' => false])->assertOk();
        $this->assertFalse($item->fresh()->is_active);
        $this->putJson("/api/merchandise/{$item->id}", ['is_active' => true])->assertOk();
        $this->assertTrue($item->fresh()->is_active);
    }

    public function test_an_item_without_open_orders_is_soft_deleted(): void
    {
        $item = Merchandise::factory()->create(['organization_id' => $this->organization->id, 'is_active' => true]);

        $this->deleteJson("/api/merchandise/{$item->id}")->assertOk()->assertJsonPath('message', 'Item deleted. Existing order records are preserved.');

        $this->assertSoftDeleted($item);
        $this->assertFalse(Merchandise::withTrashed()->findOrFail($item->id)->is_active);
    }
}
