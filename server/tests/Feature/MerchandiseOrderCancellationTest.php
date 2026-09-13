<?php

namespace Tests\Feature;

use App\Models\ApprovalRequest;
use App\Models\AuditLog;
use App\Models\Merchandise;
use App\Models\Order;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class MerchandiseOrderCancellationTest extends TestCase
{
    use RefreshDatabase;

    public function test_buyer_can_cancel_an_unpaid_pending_order_and_stock_is_restored_once(): void
    {
        $organization = Organization::factory()->create();
        $buyer = User::factory()->student()->create(['organization_id' => $organization->id]);
        User::factory()->admin()->create(['organization_id' => $organization->id]);
        $item = Merchandise::factory()->create([
            'organization_id' => $organization->id,
            'stock_quantity' => 3,
            'is_active' => true,
        ]);
        $order = $this->pendingOrder($buyer, $item, 2);

        Sanctum::actingAs($buyer);

        $this->patchJson("/api/orders/{$order->id}/cancel")
            ->assertOk()
            ->assertJsonPath('status', 'cancelled')
            ->assertJsonPath('claim_token', null);

        $this->assertDatabaseHas('orders', [
            'id' => $order->id,
            'status' => 'cancelled',
            'review_remarks' => 'Cancelled by buyer.',
        ]);
        $this->assertDatabaseHas('merchandise', [
            'id' => $item->id,
            'stock_quantity' => 5,
        ]);
        $this->assertDatabaseHas('audit_logs', [
            'record_type' => Order::class,
            'record_id' => $order->id,
            'action' => 'cancelled_by_buyer',
        ]);

        $this->patchJson("/api/orders/{$order->id}/cancel")
            ->assertConflict()
            ->assertJsonPath('message', 'Only pending orders can be cancelled. Current status: cancelled.');
        $this->assertSame(5, $item->fresh()->stock_quantity);
    }

    public function test_buyer_cannot_cancel_another_organizations_order_or_another_buyers_order(): void
    {
        $organization = Organization::factory()->create();
        $buyer = User::factory()->student()->create(['organization_id' => $organization->id]);
        $otherBuyer = User::factory()->student()->create(['organization_id' => $organization->id]);
        $item = Merchandise::factory()->create(['organization_id' => $organization->id]);
        $order = $this->pendingOrder($otherBuyer, $item);

        Sanctum::actingAs($buyer);
        $this->patchJson("/api/orders/{$order->id}/cancel")->assertForbidden();

        $outsideBuyer = User::factory()->student()->create();
        Sanctum::actingAs($outsideBuyer);
        $this->patchJson("/api/orders/{$order->id}/cancel")->assertNotFound();

        $this->assertSame('pending', $order->fresh()->status);
    }

    public function test_order_with_payment_activity_requires_staff_review_before_cancellation(): void
    {
        $organization = Organization::factory()->create();
        $buyer = User::factory()->student()->create(['organization_id' => $organization->id]);
        $item = Merchandise::factory()->create([
            'organization_id' => $organization->id,
            'stock_quantity' => 4,
        ]);
        $order = $this->pendingOrder($buyer, $item);
        ApprovalRequest::create([
            'organization_id' => $organization->id,
            'entity_type' => 'payment',
            'entity_id' => $order->id,
            'requested_by' => $buyer->school_id,
            'required_role' => 'ADMIN',
            'status' => 'pending',
            'active_key' => 'payment:'.$organization->id.':'.$order->id,
        ]);

        Sanctum::actingAs($buyer);
        $this->patchJson("/api/orders/{$order->id}/cancel")
            ->assertConflict()
            ->assertJsonPath('message', 'This order already has payment activity. Contact merchandise staff so they can review the payment before cancelling it.');

        $this->assertSame('pending', $order->fresh()->status);
        $this->assertSame(4, $item->fresh()->stock_quantity);
        $this->assertSame(0, AuditLog::where('action', 'cancelled_by_buyer')->count());
    }

    private function pendingOrder(User $buyer, Merchandise $item, int $quantity = 1): Order
    {
        return Order::create([
            'organization_id' => $buyer->organization_id,
            'student_id' => $buyer->school_id,
            'merchandise_id' => $item->id,
            'quantity' => $quantity,
            'total_price' => (float) $item->price * $quantity,
            'payment_method' => 'cash',
            'status' => 'pending',
            'officer_review_status' => 'pending',
            'admin_review_status' => 'pending',
            'claim_token' => 'CANCEL'.str_pad((string) $item->id, 10, '0', STR_PAD_LEFT),
        ]);
    }
}
