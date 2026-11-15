<?php

namespace Tests\Feature;

use App\Models\ApprovalRequest;
use App\Models\AuditLog;
use App\Models\Invoice;
use App\Models\InvoicePayment;
use App\Models\Merchandise;
use App\Models\Notification;
use App\Models\Order;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** The daily low stock notice to Admins, and the hourly lapse of orders nobody paid for. */
class StoreNoticesTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private User $admin;

    private User $student;

    protected function setUp(): void
    {
        parent::setUp();
        $this->organization = Organization::factory()->create();
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        $this->student = User::factory()->student()->create(['organization_id' => $this->organization->id]);
    }

    private function item(array $overrides = []): Merchandise
    {
        return Merchandise::factory()->create([
            'organization_id' => $this->organization->id, 'is_active' => true, 'stock_quantity' => 20, 'low_stock_threshold' => 5, 'price' => '300.00', ...$overrides,
        ]);
    }

    private function placeOrder(Merchandise $item, int $quantity = 2, ?User $buyer = null): Order
    {
        Sanctum::actingAs($buyer ?? $this->student);
        $id = $this->postJson('/api/orders', ['merchandise_id' => $item->id, 'quantity' => $quantity, 'payment_method' => 'cash'])->assertCreated()->json('id');

        return Order::findOrFail($id);
    }

    private function age(Order $order, int $days): void
    {
        Order::whereKey($order->id)->update(['created_at' => now()->subDays($days)]);
    }

    public function test_low_stock_items_notify_the_organizations_admins_once_per_item_per_day(): void
    {
        $low = $this->item(['name' => 'Org Shirt', 'stock_quantity' => 4]);
        $atThreshold = $this->item(['name' => 'Org Lanyard', 'stock_quantity' => 5]);
        $soldOut = $this->item(['name' => 'Org Mug', 'stock_quantity' => 0]);
        $this->item(['name' => 'Org Cap', 'stock_quantity' => 6]);
        $this->item(['name' => 'Retired Pin', 'stock_quantity' => 1, 'is_active' => false]);
        $secondAdmin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        $otherOrganization = Organization::factory()->create();
        $otherAdmin = User::factory()->admin()->create(['organization_id' => $otherOrganization->id]);
        $officer = User::factory()->officer()->create(['organization_id' => $this->organization->id]);

        $this->artisan('inventory:low-stock-notices')->expectsOutput('Created 6 low stock notice(s).')->assertSuccessful();

        $notices = Notification::where('user_id', $this->admin->school_id)->orderBy('reference_id')->get();
        $this->assertSame([$low->id, $atThreshold->id, $soldOut->id], $notices->pluck('reference_id')->map(fn ($id) => (int) $id)->all());
        $this->assertSame('Low Stock', $notices[0]->title);
        $this->assertStringContainsString('Org Shirt has 4 left', $notices[0]->message);
        $this->assertStringContainsString('Org Mug is out of stock', $notices[2]->message);
        $this->assertSame(Merchandise::class, $notices[0]->reference_type);
        $this->assertSame('merchandise', $notices[0]->notification_type);
        $this->assertSame(3, Notification::where('user_id', $secondAdmin->school_id)->count());
        $this->assertSame(0, Notification::where('user_id', $otherAdmin->school_id)->count());
        $this->assertSame(0, Notification::where('user_id', $officer->school_id)->count());
        $this->assertSame(0, Notification::where('user_id', $this->student->school_id)->count());

        $this->artisan('inventory:low-stock-notices')->expectsOutput('Created 0 low stock notice(s).')->assertSuccessful();
        $this->assertSame(6, Notification::count());

        $this->travel(1)->days();
        $this->artisan('inventory:low-stock-notices')->expectsOutput('Created 6 low stock notice(s).')->assertSuccessful();
        $this->assertSame(12, Notification::count());
    }

    public function test_a_restocked_item_no_longer_notifies(): void
    {
        $item = $this->item(['stock_quantity' => 2]);
        $this->artisan('inventory:low-stock-notices')->assertSuccessful();
        $this->assertSame(1, Notification::count());

        $item->update(['stock_quantity' => 50]);
        $this->travel(1)->days();
        $this->artisan('inventory:low-stock-notices')->expectsOutput('Created 0 low stock notice(s).')->assertSuccessful();
        $this->assertSame(1, Notification::count());
    }

    public function test_an_order_with_no_payment_lapses_after_the_allowed_days_and_gives_the_stock_back(): void
    {
        $item = $this->item(['stock_quantity' => 10]);
        $order = $this->placeOrder($item, 3);
        $this->assertSame(7, $item->fresh()->stock_quantity);
        $this->age($order, 6);

        $this->artisan('orders:expire-unpaid')->expectsOutput('Cancelled 1 unpaid order(s).')->assertSuccessful();

        $order = $order->fresh();
        $this->assertSame('cancelled', $order->status);
        $this->assertFalse((bool) $order->stock_held);
        $this->assertSame('Cancelled because no payment was received within 5 days.', $order->review_remarks);
        $this->assertSame(10, $item->fresh()->stock_quantity);
        $this->assertDatabaseHas('audit_logs', ['module' => 'orders', 'action' => 'expired_unpaid', 'record_type' => Order::class, 'record_id' => $order->id, 'user_id' => null]);
        $this->assertDatabaseHas('audit_logs', ['module' => 'merchandise', 'action' => 'stock_released', 'record_id' => $item->id]);
        $notice = Notification::where('user_id', $this->student->school_id)->where('title', 'Order Cancelled')->sole();
        $this->assertSame(Order::class, $notice->reference_type);
        $this->assertSame($order->id, (int) $notice->reference_id);
        $this->assertSame('financial', $notice->notification_type);
        $this->assertStringContainsString("ORD-{$order->id}", $notice->message);

        $this->artisan('orders:expire-unpaid')->expectsOutput('Cancelled 0 unpaid order(s).')->assertSuccessful();
        $this->assertSame(10, $item->fresh()->stock_quantity);
    }

    public function test_orders_with_any_payment_activity_or_not_yet_old_enough_are_left_alone(): void
    {
        $item = $this->item(['stock_quantity' => 30]);
        $young = $this->placeOrder($item);
        $this->age($young, 4);
        $withProof = $this->placeOrder($this->item(['stock_quantity' => 30]));
        $withProof->update(['payment_method' => 'gcash', 'payment_reference' => '1234567890123', 'payment_proof_url' => 'uploads/payment-proofs/proof.jpg']);
        $reviewed = $this->placeOrder($this->item(['stock_quantity' => 30]));
        $reviewed->update(['officer_review_status' => 'approved']);
        ApprovalRequest::create(['organization_id' => $this->organization->id, 'entity_type' => 'payment', 'entity_id' => $reviewed->id, 'requested_by' => $this->admin->id, 'required_role' => 'ADMIN', 'status' => 'pending', 'active_key' => 'payment:'.$this->organization->id.':'.$reviewed->id]);
        $paid = $this->placeOrder($this->item(['stock_quantity' => 30]));
        $paid->update(['status' => 'paid']);
        $partPaid = $this->placeOrder($this->item(['stock_quantity' => 30]));
        $invoice = Invoice::create(['organization_id' => $this->organization->id, 'reference' => 'INV-PART', 'student_id' => $this->student->school_id, 'order_id' => $partPaid->id, 'description' => 'Order', 'amount_due' => '600.00', 'status' => 'partially_paid']);
        InvoicePayment::create(['invoice_id' => $invoice->id, 'amount' => '100.00', 'recorded_by' => $this->admin->school_id, 'status' => 'approved']);
        foreach ([$withProof, $reviewed, $paid, $partPaid] as $order) {
            $this->age($order, 30);
        }
        $stockBefore = (int) Merchandise::sum('stock_quantity');

        $this->artisan('orders:expire-unpaid')->expectsOutput('Cancelled 0 unpaid order(s).')->assertSuccessful();

        foreach ([$young, $withProof, $reviewed, $paid, $partPaid] as $order) {
            $this->assertNotSame('cancelled', $order->fresh()->status, 'order '.$order->id);
        }
        $this->assertSame($stockBefore, (int) Merchandise::sum('stock_quantity'));
        $this->assertSame(0, Notification::where('title', 'Order Cancelled')->count());
        $this->assertSame(0, AuditLog::where('action', 'expired_unpaid')->count());
    }

    public function test_the_unpaid_invoice_of_a_lapsed_order_is_cancelled_with_it(): void
    {
        $item = $this->item();
        $order = $this->placeOrder($item);
        $invoice = Invoice::create(['organization_id' => $this->organization->id, 'reference' => 'INV-LAPSE', 'student_id' => $this->student->school_id, 'order_id' => $order->id, 'description' => 'Order', 'amount_due' => '600.00', 'status' => 'unpaid']);
        $this->age($order, 9);

        $this->artisan('orders:expire-unpaid')->assertSuccessful();

        $this->assertSame('cancelled', $order->fresh()->status);
        $this->assertSame('cancelled', $invoice->fresh()->status);
        $this->assertDatabaseHas('audit_logs', ['module' => 'invoices', 'action' => 'cancelled', 'record_id' => $invoice->id, 'user_id' => null]);
    }

    public function test_the_allowed_days_come_from_configuration(): void
    {
        $order = $this->placeOrder($this->item());
        $this->age($order, 3);

        $this->artisan('orders:expire-unpaid')->expectsOutput('Cancelled 0 unpaid order(s).')->assertSuccessful();

        config(['hiusa.orders.unpaid_expiry_days' => 2]);
        $this->artisan('orders:expire-unpaid')->expectsOutput('Cancelled 1 unpaid order(s).')->assertSuccessful();
        $this->assertStringContainsString('within 2 days', $order->fresh()->review_remarks);
    }

    public function test_the_buyers_order_shows_the_date_it_lapses_until_there_is_payment_activity(): void
    {
        $item = $this->item();
        $open = $this->placeOrder($item);
        $withProof = $this->placeOrder($item);
        $withProof->update(['payment_proof_url' => 'uploads/payment-proofs/proof.jpg']);
        Order::whereKey($open->id)->update(['created_at' => '2026-09-13 10:00:00']);

        Sanctum::actingAs($this->student);
        $rows = collect($this->getJson('/api/orders')->assertOk()->json('data'))->keyBy('id');

        $this->assertSame('2026-09-18', substr($rows[$open->id]['lapses_at'], 0, 10));
        $this->assertNull($rows[$withProof->id]['lapses_at']);
        $this->assertSame('2026-09-18', substr($this->getJson("/api/orders/{$open->id}")->assertOk()->json('lapses_at'), 0, 10));
        $this->assertNull($this->getJson("/api/orders/{$withProof->id}")->assertOk()->json('lapses_at'));
    }

    public function test_a_buyer_sees_no_lapse_date_once_an_invoice_payment_was_recorded(): void
    {
        $order = $this->placeOrder($this->item());
        $invoice = Invoice::create(['organization_id' => $this->organization->id, 'reference' => 'INV-SHOW', 'student_id' => $this->student->school_id, 'order_id' => $order->id, 'description' => 'Order', 'amount_due' => '600.00', 'status' => 'partially_paid']);

        InvoicePayment::create(['invoice_id' => $invoice->id, 'amount' => '100.00', 'recorded_by' => $this->admin->school_id, 'status' => 'approved']);

        $this->assertNull($this->getJson("/api/orders/{$order->id}")->assertOk()->json('lapses_at'));
    }
}
