<?php

namespace Tests\Feature;

use App\Models\ApprovalRequest;
use App\Models\Invoice;
use App\Models\InvoicePayment;
use App\Models\Merchandise;
use App\Models\Order;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * An order billed on an invoice is one debt and one payment. The invoice is
 * where its money is recorded: paying it in full settles the order, and the
 * order side refuses to record the same money a second time.
 */
class OrderInvoiceDoubleCountTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private User $officer;

    private User $student;

    private Merchandise $item;

    protected function setUp(): void
    {
        parent::setUp();
        $organization = Organization::factory()->create();
        $this->admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $this->officer = User::factory()->officer()->create(['organization_id' => $organization->id]);
        $this->student = User::factory()->student()->create(['organization_id' => $organization->id]);
        $this->item = Merchandise::factory()->create(['organization_id' => $organization->id, 'is_active' => true, 'stock_quantity' => 10, 'price' => '300.00']);
    }

    private function pendingOrder(): int
    {
        Sanctum::actingAs($this->student);
        $id = $this->postJson('/api/orders', ['merchandise_id' => $this->item->id, 'quantity' => 1, 'payment_method' => 'cash'])->assertCreated()->json('id');
        Sanctum::actingAs($this->admin);

        return $id;
    }

    private function billOrder(int $orderId, string $amount = '300.00'): array
    {
        return $this->postJson('/api/invoices', [
            'student_id' => $this->student->school_id, 'description' => 'Reserved shirt', 'amount_due' => $amount, 'order_id' => $orderId,
        ])->assertCreated()->json();
    }

    private function debt(): array
    {
        return $this->getJson('/api/student-debts?student_id='.$this->student->school_id)->assertOk()->json('0');
    }

    private function billedMessage(array $invoice): string
    {
        return "This order is billed on invoice {$invoice['reference']}. Record the payment on the invoice from Student Financial Accounts; the order is marked paid when the invoice is paid in full.";
    }

    public function test_an_order_billed_on_an_invoice_is_owed_once(): void
    {
        $orderId = $this->pendingOrder();
        $this->assertEquals(300, $this->debt()['total_debt']);

        $invoice = $this->billOrder($orderId);

        $debt = $this->debt();
        $this->assertEquals(300, $debt['total_debt']);
        $this->assertEquals(300, $debt['invoice_debt']);
        $this->assertEquals(0, $debt['reserved_order_debt']);
        $this->assertCount(0, $debt['reserved_orders']);
        $this->getJson('/api/student-debts')->assertOk()
            ->assertJsonPath('summary.total_outstanding', 300)
            ->assertJsonPath('summary.merchandise_outstanding', 0);

        Invoice::whereKey($invoice['id'])->update(['status' => 'cancelled']);
        Cache::flush();
        $debt = $this->debt();
        $this->assertEquals(300, $debt['total_debt'], 'A cancelled charge no longer bills the order, so the order is owed again.');
        $this->assertEquals(0, $debt['invoice_debt']);
        $this->assertEquals(300, $debt['reserved_order_debt']);
    }

    public function test_paying_the_invoice_in_full_marks_the_order_paid_without_a_second_ledger_entry(): void
    {
        $orderId = $this->pendingOrder();
        $invoice = $this->billOrder($orderId);

        $this->postJson("/api/invoices/{$invoice['id']}/payments", ['amount' => '100.00'])->assertOk()->assertJsonPath('status', 'partially_paid');
        $this->assertSame('pending', Order::findOrFail($orderId)->status);
        $this->assertEquals(200, $this->debt()['total_debt']);

        $this->postJson("/api/invoices/{$invoice['id']}/payments", ['amount' => '200.00'])->assertOk()->assertJsonPath('status', 'paid');

        $order = Order::findOrFail($orderId);
        $finalPayment = InvoicePayment::where('invoice_id', $invoice['id'])->latest('id')->firstOrFail();
        $this->assertSame('paid', $order->status);
        $this->assertEquals($finalPayment->ledger_transaction_id, $order->transaction_id);
        $this->assertSame(2, Transaction::count());
        $this->assertEquals(300, Transaction::where('type', 'income')->sum('amount'));
        $this->assertSame(0, Transaction::where('category', 'Merchandise')->count());
        $this->assertSame(9, $this->item->fresh()->stock_quantity);
        $this->assertEquals(0, $this->debt()['total_debt']);

        $this->patchJson("/api/orders/{$orderId}/status", ['status' => 'paid'])->assertUnprocessable();
        $this->assertSame(2, Transaction::count());
    }

    public function test_the_final_invoice_payment_is_refused_while_the_order_cannot_be_fulfilled(): void
    {
        $orderId = $this->pendingOrder();
        $invoice = $this->billOrder($orderId);
        $this->item->update(['stock_quantity' => 0]);

        $this->postJson("/api/invoices/{$invoice['id']}/payments", ['amount' => '300.00'])
            ->assertStatus(422)->assertJsonPath('message', 'Insufficient stock to approve this order. Only 0 unit(s) remain.');

        $this->assertSame(0, Transaction::count());
        $this->assertSame(0, InvoicePayment::count());
        $this->assertSame('unpaid', Invoice::findOrFail($invoice['id'])->status);
        $this->assertSame('pending', Order::findOrFail($orderId)->status);
    }

    public function test_an_order_with_an_unpaid_invoice_cannot_be_marked_paid_from_the_order_side(): void
    {
        $orderId = $this->pendingOrder();
        $invoice = $this->billOrder($orderId);

        $this->patchJson("/api/orders/{$orderId}/status", ['status' => 'paid'])
            ->assertStatus(422)->assertJsonPath('message', $this->billedMessage($invoice));

        Sanctum::actingAs($this->officer);
        $this->patchJson("/api/orders/{$orderId}/status", ['status' => 'paid', 'verified_amount' => 300])
            ->assertStatus(422)->assertJsonPath('message', $this->billedMessage($invoice));

        $order = Order::findOrFail($orderId);
        $this->assertSame('pending', $order->status);
        $this->assertNull($order->transaction_id);
        $this->assertSame(0, Transaction::count());
        $this->assertSame(0, ApprovalRequest::count());
        $this->assertSame(10, $this->item->fresh()->stock_quantity);
    }

    public function test_the_approvals_queue_cannot_approve_an_order_billed_on_an_open_invoice(): void
    {
        $orderId = $this->pendingOrder();
        Sanctum::actingAs($this->officer);
        $this->patchJson("/api/orders/{$orderId}/status", ['status' => 'paid', 'verified_amount' => 300])->assertOk();
        $approval = ApprovalRequest::where('entity_type', 'payment')->where('entity_id', $orderId)->firstOrFail();

        Sanctum::actingAs($this->admin);
        $invoice = $this->billOrder($orderId);
        $this->patchJson("/api/approval-requests/{$approval->id}", ['status' => 'approved'])
            ->assertStatus(422)->assertJsonPath('message', $this->billedMessage($invoice));

        $this->assertSame('pending', $approval->fresh()->status);
        $this->assertSame('pending', Order::findOrFail($orderId)->status);
        $this->assertSame(0, Transaction::count());
    }

    public function test_paying_the_invoice_in_full_also_closes_the_orders_pending_approval(): void
    {
        $orderId = $this->pendingOrder();
        Sanctum::actingAs($this->officer);
        $this->patchJson("/api/orders/{$orderId}/status", ['status' => 'paid', 'verified_amount' => 300])->assertOk();
        $approval = ApprovalRequest::where('entity_type', 'payment')->where('entity_id', $orderId)->firstOrFail();

        Sanctum::actingAs($this->admin);
        $invoice = $this->billOrder($orderId);
        $this->postJson("/api/invoices/{$invoice['id']}/payments", ['amount' => '300.00'])->assertOk()->assertJsonPath('status', 'paid');

        $approval->refresh();
        $this->assertSame('approved', $approval->status);
        $this->assertNull($approval->active_key);
        $this->assertSame('paid', Order::findOrFail($orderId)->status);
        $this->assertSame(1, Transaction::count());
    }

    public function test_an_order_whose_invoice_was_already_paid_is_linked_to_that_entry_instead_of_posting_again(): void
    {
        $orderId = $this->pendingOrder();
        $invoice = $this->billOrder($orderId);
        $entry = Transaction::create([
            'organization_id' => $this->admin->organization_id, 'recorded_by' => $this->admin->school_id, 'payer_id' => $this->student->school_id,
            'type' => 'income', 'amount' => 300, 'category' => 'Student Payment', 'description' => 'Payment for '.$invoice['reference'],
            'receipt_reference' => 'FIN-EARLIER', 'transaction_date' => now(),
        ]);
        InvoicePayment::create(['invoice_id' => $invoice['id'], 'amount' => 300, 'recorded_by' => $this->admin->school_id, 'status' => 'approved', 'ledger_transaction_id' => $entry->id]);
        Invoice::whereKey($invoice['id'])->update(['status' => 'paid']);

        $this->patchJson("/api/orders/{$orderId}/status", ['status' => 'paid'])->assertOk();

        $this->assertEquals($entry->id, Order::findOrFail($orderId)->transaction_id);
        $this->assertSame(1, Transaction::count());
        $this->assertSame(0, Transaction::where('category', 'Merchandise')->count());
    }

    public function test_an_order_whose_invoice_was_cancelled_is_paid_through_the_order_once(): void
    {
        $orderId = $this->pendingOrder();
        $invoice = $this->billOrder($orderId);
        Invoice::whereKey($invoice['id'])->update(['status' => 'cancelled']);

        $this->patchJson("/api/orders/{$orderId}/status", ['status' => 'paid'])->assertOk()->assertJsonPath('status', 'paid');

        $this->assertSame(1, Transaction::count());
        $this->assertSame(1, Transaction::where('category', 'Merchandise')->count());
    }

    public function test_an_order_can_only_be_billed_for_its_full_total(): void
    {
        $orderId = $this->pendingOrder();

        foreach (['1.00', '299.99', '300.01'] as $amount) {
            $this->postJson('/api/invoices', [
                'student_id' => $this->student->school_id, 'description' => 'Reserved shirt', 'amount_due' => $amount, 'order_id' => $orderId,
            ])->assertStatus(422)
                ->assertJsonValidationErrors('amount_due')
                ->assertJsonPath('message', 'The amount due must equal the order total of 300.00.');
        }
        $this->assertSame(0, Invoice::count());

        $this->billOrder($orderId, '300.00');
        $this->assertSame(1, Invoice::count());
    }

    public function test_only_a_pending_order_can_be_billed_on_an_invoice(): void
    {
        Sanctum::actingAs($this->admin);

        foreach (['paid', 'claimed', 'cancelled'] as $status) {
            $order = Order::create([
                'organization_id' => $this->admin->organization_id, 'student_id' => $this->student->school_id, 'merchandise_id' => $this->item->id,
                'quantity' => 1, 'unit_price' => 300, 'total_price' => 300, 'status' => $status, 'payment_method' => 'cash',
                'claim_token' => 'TOKEN'.strtoupper($status),
            ]);

            $this->postJson('/api/invoices', [
                'student_id' => $this->student->school_id, 'description' => 'Reserved shirt', 'amount_due' => '300.00', 'order_id' => $order->id,
            ])->assertStatus(422)->assertJsonPath('message', 'Only a pending order can be billed on a student charge.');
        }

        $this->assertSame(0, Invoice::count());
    }
}
