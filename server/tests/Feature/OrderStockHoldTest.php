<?php

namespace Tests\Feature;

use App\Models\Merchandise;
use App\Models\MerchandiseVariant;
use App\Models\Order;
use App\Models\Organization;
use App\Models\User;
use App\Services\OrderFulfillmentService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OrderStockHoldTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private User $buyer;

    private User $otherBuyer;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::factory()->create();
        $this->buyer = User::factory()->student()->create(['organization_id' => $this->organization->id]);
        $this->otherBuyer = User::factory()->student()->create(['organization_id' => $this->organization->id]);
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
    }

    public function test_the_second_order_for_the_last_unit_is_refused(): void
    {
        $item = $this->item(1);

        Sanctum::actingAs($this->buyer);
        $this->postJson('/api/orders', ['merchandise_id' => $item->id, 'quantity' => 1, 'payment_method' => 'cash'])->assertCreated();
        $this->assertSame(0, $item->fresh()->stock_quantity);

        Sanctum::actingAs($this->otherBuyer);
        $this->postJson('/api/orders', ['merchandise_id' => $item->id, 'quantity' => 1, 'payment_method' => 'cash'])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'Insufficient stock. Only 0 unit(s) available.');

        $this->assertSame(1, Order::where('merchandise_id', $item->id)->count());
        $this->assertSame(0, $item->fresh()->stock_quantity);
    }

    public function test_a_rejected_payment_returns_the_unit_once(): void
    {
        $item = $this->item(1);
        $orderId = $this->placeOrder($this->buyer, $item);
        $this->assertSame(0, $item->fresh()->stock_quantity);

        Sanctum::actingAs($this->admin);
        $this->patchJson("/api/orders/{$orderId}/status", ['status' => 'cancelled', 'review_remarks' => 'Screenshot is blurry.'])->assertOk();
        $this->assertSame(1, $item->fresh()->stock_quantity);
        $this->assertFalse((bool) Order::find($orderId)->stock_held);

        $this->patchJson("/api/orders/{$orderId}/status", ['status' => 'cancelled', 'review_remarks' => 'Again.'])->assertUnprocessable();
        $this->assertSame(1, $item->fresh()->stock_quantity);

        Sanctum::actingAs($this->otherBuyer);
        $this->postJson('/api/orders', ['merchandise_id' => $item->id, 'quantity' => 1, 'payment_method' => 'cash'])->assertCreated();
    }

    public function test_a_buyer_cancelling_returns_the_whole_quantity_once(): void
    {
        $item = $this->item(5);
        $orderId = $this->placeOrder($this->buyer, $item, 3);
        $this->assertSame(2, $item->fresh()->stock_quantity);

        Sanctum::actingAs($this->buyer);
        $this->patchJson("/api/orders/{$orderId}/cancel")->assertOk();
        $this->assertSame(5, $item->fresh()->stock_quantity);

        $this->patchJson("/api/orders/{$orderId}/cancel")->assertConflict();
        $this->assertSame(5, $item->fresh()->stock_quantity);
    }

    public function test_approving_and_claiming_do_not_take_stock_a_second_time(): void
    {
        $item = $this->item(5);
        $orderId = $this->placeOrder($this->buyer, $item, 2);
        $this->assertSame(3, $item->fresh()->stock_quantity);

        Sanctum::actingAs($this->admin);
        $this->patchJson("/api/orders/{$orderId}/status", ['status' => 'paid'])->assertOk();
        $this->assertSame(3, $item->fresh()->stock_quantity);

        $this->postJson('/api/orders/claim', ['claim_token' => Order::find($orderId)->claim_token])->assertOk();
        $this->assertSame(3, $item->fresh()->stock_quantity);
    }

    public function test_variant_stock_is_held_and_returned_with_the_order(): void
    {
        $item = $this->item(5);
        $small = $this->variant($item, 'Small', 2);
        $large = $this->variant($item, 'Large', 3);

        Sanctum::actingAs($this->buyer);
        $orderId = $this->postJson('/api/orders', ['merchandise_id' => $item->id, 'merchandise_variant_id' => $small->id, 'quantity' => 2, 'payment_method' => 'cash'])
            ->assertCreated()->json('id');
        $this->assertSame(0, $small->fresh()->stock_quantity);
        $this->assertSame(3, $large->fresh()->stock_quantity);
        $this->assertSame(3, $item->fresh()->stock_quantity);

        Sanctum::actingAs($this->otherBuyer);
        $this->postJson('/api/orders', ['merchandise_id' => $item->id, 'merchandise_variant_id' => $small->id, 'quantity' => 1, 'payment_method' => 'cash'])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'Insufficient Small stock. Only 0 unit(s) available.');

        Sanctum::actingAs($this->admin);
        $this->patchJson("/api/orders/{$orderId}/status", ['status' => 'cancelled', 'review_remarks' => 'Wrong amount.'])->assertOk();
        $this->assertSame(2, $small->fresh()->stock_quantity);
        $this->assertSame(5, $item->fresh()->stock_quantity);
    }

    public function test_adjusting_stock_changes_the_number_still_available(): void
    {
        $item = $this->item(2);
        $this->placeOrder($this->buyer, $item);

        Sanctum::actingAs($this->admin);
        $this->patchJson("/api/merchandise/{$item->id}/stock", ['stock_delta' => 4, 'note' => 'New delivery'])
            ->assertOk()->assertJsonPath('stock_quantity', 5);
        $this->getJson('/api/merchandise')->assertOk()->assertJsonPath('data.0.stock_quantity', 5);
    }

    public function test_an_order_placed_before_stock_was_held_still_takes_stock_only_at_approval(): void
    {
        $item = $this->item(5);
        $order = $this->legacyPendingOrder($item, 2);

        app(OrderFulfillmentService::class)->approvePayment($order, $this->admin);
        $this->assertSame(3, $item->fresh()->stock_quantity);

        $cancelled = $this->legacyPendingOrder($item, 2);
        app(OrderFulfillmentService::class)->rejectPayment($cancelled, $this->admin, 'Not paid.');
        $this->assertSame(3, $item->fresh()->stock_quantity);
    }

    public function test_the_command_holds_stock_for_open_orders_once_and_dry_run_changes_nothing(): void
    {
        $item = $this->item(5);
        $order = $this->legacyPendingOrder($item, 2);
        $paid = $this->legacyPendingOrder($item, 1);
        $paid->update(['status' => 'paid']);

        $this->artisan('orders:hold-stock', ['--dry-run' => true])->assertSuccessful();
        $this->assertSame(5, $item->fresh()->stock_quantity);
        $this->assertFalse((bool) $order->fresh()->stock_held);

        $this->artisan('orders:hold-stock')->assertSuccessful();
        $this->assertSame(3, $item->fresh()->stock_quantity);
        $this->assertTrue((bool) $order->fresh()->stock_held);
        $this->assertFalse((bool) $paid->fresh()->stock_held);

        $this->artisan('orders:hold-stock')->assertSuccessful();
        $this->assertSame(3, $item->fresh()->stock_quantity);

        Sanctum::actingAs($this->admin);
        $this->patchJson("/api/orders/{$order->id}/status", ['status' => 'cancelled', 'review_remarks' => 'Not paid.'])->assertOk();
        $this->assertSame(5, $item->fresh()->stock_quantity);
    }

    public function test_a_buyer_cannot_hold_a_third_unpaid_order_for_the_same_item(): void
    {
        $item = $this->item(10);
        $this->placeOrder($this->buyer, $item, 3);
        $this->placeOrder($this->buyer, $item, 3);

        $this->postJson('/api/orders', ['merchandise_id' => $item->id, 'quantity' => 1, 'payment_method' => 'cash'])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'You already have 2 unpaid orders for this item. Pay or cancel one first.');

        $this->assertSame(2, Order::where('merchandise_id', $item->id)->count());
        $this->assertSame(4, $item->fresh()->stock_quantity);

        $this->placeOrder($this->otherBuyer, $item, 1);
        $other = $this->item(10);
        $this->placeOrder($this->buyer, $other, 1);
    }

    public function test_cancelling_an_unpaid_order_lets_the_buyer_order_again(): void
    {
        $item = $this->item(10);
        $first = $this->placeOrder($this->buyer, $item);
        $this->placeOrder($this->buyer, $item);

        $this->patchJson("/api/orders/{$first}/cancel")->assertOk();

        $this->postJson('/api/orders', ['merchandise_id' => $item->id, 'quantity' => 1, 'payment_method' => 'cash'])->assertCreated();
    }

    public function test_cancelling_someone_elses_order_looks_the_same_as_a_missing_order(): void
    {
        $item = $this->item(5);
        $orderId = $this->placeOrder($this->buyer, $item);

        Sanctum::actingAs($this->otherBuyer);
        $this->patchJson("/api/orders/{$orderId}/cancel")
            ->assertNotFound()
            ->assertJsonPath('message', 'Order not found.');
        $this->patchJson('/api/orders/999999/cancel')->assertNotFound();

        $this->assertSame('pending', Order::find($orderId)->status);
        $this->assertSame(4, $item->fresh()->stock_quantity);
    }

    private function item(int $stock): Merchandise
    {
        return Merchandise::factory()->create([
            'organization_id' => $this->organization->id,
            'price' => 100,
            'stock_quantity' => $stock,
            'is_active' => true,
            'promotion_price' => null,
            'promotion_buyer_limit' => null,
        ]);
    }

    private function variant(Merchandise $item, string $name, int $stock): MerchandiseVariant
    {
        return MerchandiseVariant::create(['organization_id' => $this->organization->id, 'merchandise_id' => $item->id, 'name' => $name, 'stock_quantity' => $stock]);
    }

    private function placeOrder(User $buyer, Merchandise $item, int $quantity = 1): int
    {
        Sanctum::actingAs($buyer);

        return $this->postJson('/api/orders', ['merchandise_id' => $item->id, 'quantity' => $quantity, 'payment_method' => 'cash'])
            ->assertCreated()->json('id');
    }

    private function legacyPendingOrder(Merchandise $item, int $quantity): Order
    {
        return Order::create([
            'organization_id' => $this->organization->id,
            'student_id' => $this->buyer->school_id,
            'merchandise_id' => $item->id,
            'quantity' => $quantity,
            'total_price' => 100 * $quantity,
            'payment_method' => 'cash',
            'status' => 'pending',
            'officer_review_status' => 'pending',
            'admin_review_status' => 'pending',
            'claim_token' => strtoupper(substr(md5((string) microtime(true).$quantity), 0, 16)),
        ]);
    }
}
