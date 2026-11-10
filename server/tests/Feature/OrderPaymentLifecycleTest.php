<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Merchandise;
use App\Models\Order;
use App\Models\Organization;
use App\Models\User;
use App\Services\OrderFulfillmentService;
use DomainException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OrderPaymentLifecycleTest extends TestCase
{
    use RefreshDatabase;

    private const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

    public function test_a_rejected_gcash_payment_frees_its_reference_for_a_new_order(): void
    {
        Storage::fake('local');
        $organization = Organization::factory()->withGcashQr()->create();
        $buyer = User::factory()->student()->create(['organization_id' => $organization->id]);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $item = $this->item($organization, 5);

        Sanctum::actingAs($buyer);
        $orderId = $this->postJson('/api/orders', ['merchandise_id' => $item->id, 'quantity' => 1, 'payment_method' => 'cash'])
            ->assertCreated()->json('id');
        $this->post("/api/orders/{$orderId}/payment", [
            'payment_reference' => '1234567890123',
            'payment_proof' => $this->proof(),
        ], ['Accept' => 'application/json'])->assertOk();

        Sanctum::actingAs($admin);
        $this->patchJson("/api/orders/{$orderId}/status", ['status' => 'cancelled', 'review_remarks' => 'Screenshot is blurry.'])
            ->assertOk();

        $this->assertNull(Order::find($orderId)->payment_reference_key);
        $this->assertTrue(
            AuditLog::where('record_id', $orderId)->where('action', 'payment_rejected')->get()
                ->contains(fn ($log) => ($log->old_values['payment_reference'] ?? null) === '1234567890123'),
            'The rejected reference is kept in the audit log.'
        );

        Sanctum::actingAs($buyer);
        $this->post('/api/orders', [
            'merchandise_id' => $item->id,
            'quantity' => 1,
            'payment_method' => 'gcash',
            'payment_reference' => '1234567890123',
            'payment_proof' => $this->proof(),
        ], ['Accept' => 'application/json'])->assertCreated();

        $secondId = $this->postJson('/api/orders', ['merchandise_id' => $item->id, 'quantity' => 1, 'payment_method' => 'cash'])
            ->assertCreated()->json('id');
        Sanctum::actingAs($admin);
        $this->patchJson("/api/orders/{$secondId}/status", ['status' => 'cancelled', 'review_remarks' => 'Not needed.'])->assertOk();
    }

    public function test_a_reference_in_use_by_a_live_order_is_still_rejected(): void
    {
        Storage::fake('local');
        $organization = Organization::factory()->withGcashQr()->create();
        $buyer = User::factory()->student()->create(['organization_id' => $organization->id]);
        $item = $this->item($organization, 5);

        Sanctum::actingAs($buyer);
        $this->post('/api/orders', [
            'merchandise_id' => $item->id,
            'quantity' => 1,
            'payment_method' => 'gcash',
            'payment_reference' => '1234567890123',
            'payment_proof' => $this->proof(),
        ], ['Accept' => 'application/json'])->assertCreated();

        $this->post('/api/orders', [
            'merchandise_id' => $item->id,
            'quantity' => 1,
            'payment_method' => 'gcash',
            'payment_reference' => '1234567890123',
            'payment_proof' => $this->proof(),
        ], ['Accept' => 'application/json'])->assertUnprocessable();
    }

    public function test_approving_an_order_cancelled_after_it_was_loaded_is_refused(): void
    {
        $organization = Organization::factory()->create();
        $buyer = User::factory()->student()->create(['organization_id' => $organization->id]);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $item = $this->item($organization, 5);
        $order = $this->pendingOrder($buyer, $item);

        $staleOrder = Order::find($order->id);
        Order::whereKey($order->id)->update(['status' => 'cancelled']);

        try {
            app(OrderFulfillmentService::class)->approvePayment($staleOrder, $admin);
            $this->fail('A cancelled order was approved.');
        } catch (DomainException $exception) {
            $this->assertSame('Cancelled orders cannot be approved.', $exception->getMessage());
        }

        $this->assertSame('cancelled', $order->fresh()->status);
        $this->assertSame(5, $item->fresh()->stock_quantity);
    }

    public function test_approving_an_order_claimed_after_it_was_loaded_is_refused(): void
    {
        $organization = Organization::factory()->create();
        $buyer = User::factory()->student()->create(['organization_id' => $organization->id]);
        $admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $item = $this->item($organization, 5);
        $order = $this->pendingOrder($buyer, $item);

        $staleOrder = Order::find($order->id);
        Order::whereKey($order->id)->update(['status' => 'claimed']);

        try {
            app(OrderFulfillmentService::class)->approvePayment($staleOrder, $admin);
            $this->fail('A claimed order was approved again.');
        } catch (DomainException $exception) {
            $this->assertSame('Claimed orders cannot be reviewed again.', $exception->getMessage());
        }

        $this->assertSame('claimed', $order->fresh()->status);
        $this->assertSame(5, $item->fresh()->stock_quantity);
    }

    private function item(Organization $organization, int $stock): Merchandise
    {
        return Merchandise::factory()->create([
            'organization_id' => $organization->id,
            'price' => 100,
            'stock_quantity' => $stock,
            'is_active' => true,
        ]);
    }

    private function proof(): UploadedFile
    {
        return UploadedFile::fake()->createWithContent('proof.png', base64_decode(self::PNG));
    }

    private function pendingOrder(User $buyer, Merchandise $item): Order
    {
        return Order::create([
            'organization_id' => $buyer->organization_id,
            'student_id' => $buyer->school_id,
            'merchandise_id' => $item->id,
            'quantity' => 1,
            'total_price' => 100,
            'payment_method' => 'cash',
            'status' => 'pending',
            'officer_review_status' => 'pending',
            'admin_review_status' => 'pending',
            'claim_token' => 'LIFECYCLE'.str_pad((string) $item->id, 10, '0', STR_PAD_LEFT),
        ]);
    }
}
