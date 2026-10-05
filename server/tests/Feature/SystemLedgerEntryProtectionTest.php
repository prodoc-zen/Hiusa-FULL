<?php

namespace Tests\Feature;

use App\Models\CashAdvance;
use App\Models\CashAdvanceRepayment;
use App\Models\Collection;
use App\Models\InvoicePayment;
use App\Models\Merchandise;
use App\Models\Order;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * A ledger entry made by a verified collection, a cash advance release or
 * repayment, an approved invoice payment or a paid merchandise order is the
 * other record's money. Editing or deleting it from the ledger would leave
 * that record saying verified, released or paid with nothing behind it.
 */
class SystemLedgerEntryProtectionTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private User $verifier;

    private User $student;

    protected function setUp(): void
    {
        parent::setUp();
        $organization = Organization::factory()->create();
        $this->admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $this->verifier = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $this->student = User::factory()->student()->create(['organization_id' => $organization->id]);
    }

    private function assertEntryIsLocked(int $transactionId, string $expectedMessage): void
    {
        $before = Transaction::findOrFail($transactionId);

        Sanctum::actingAs($this->admin);
        $this->putJson("/api/transactions/{$transactionId}", ['description' => 'Quietly rewritten', 'amount' => 1])
            ->assertStatus(409)->assertJsonPath('message', $expectedMessage);
        $this->deleteJson("/api/transactions/{$transactionId}")
            ->assertStatus(409)->assertJsonPath('message', $expectedMessage);

        Sanctum::actingAs($this->verifier);
        $this->deleteJson("/api/transactions/{$transactionId}")
            ->assertStatus(409)->assertJsonPath('message', $expectedMessage);

        $after = Transaction::findOrFail($transactionId);
        $this->assertSame($before->description, $after->description);
        $this->assertEquals($before->amount, $after->amount);
    }

    public function test_an_entry_made_by_a_verified_collection_cannot_be_edited_or_deleted(): void
    {
        Sanctum::actingAs($this->admin);
        $collectionId = $this->postJson('/api/collections', ['amount_collected' => '500.00', 'source' => 'Membership'])->assertCreated()->json('id');
        Sanctum::actingAs($this->verifier);
        $this->patchJson("/api/collections/{$collectionId}/verify")->assertOk();
        $collection = Collection::findOrFail($collectionId);

        $this->assertEntryIsLocked(
            $collection->ledger_transaction_id,
            "This entry was recorded when collection {$collection->reference} was verified. Change it from Collections."
        );
    }

    public function test_entries_made_by_a_released_cash_advance_and_its_repayment_cannot_be_edited_or_deleted(): void
    {
        Sanctum::actingAs($this->admin);
        $advanceId = $this->postJson('/api/cash-advances', ['amount' => '300.00', 'purpose' => 'Venue deposit'])->assertCreated()->json('id');
        Sanctum::actingAs($this->verifier);
        $this->patchJson("/api/cash-advances/{$advanceId}/approve")->assertOk();
        Sanctum::actingAs($this->admin);
        $this->patchJson("/api/cash-advances/{$advanceId}/release")->assertOk();
        $this->postJson("/api/cash-advances/{$advanceId}/repayments", ['amount' => '100.00'])->assertOk();
        $advance = CashAdvance::findOrFail($advanceId);
        $repayment = CashAdvanceRepayment::where('cash_advance_id', $advanceId)->firstOrFail();

        $this->assertEntryIsLocked(
            $advance->release_transaction_id,
            "This entry was recorded when cash advance {$advance->reference} was released. Change it from Cash Advances."
        );
        $this->assertEntryIsLocked(
            $repayment->ledger_transaction_id,
            "This entry was recorded when a repayment for cash advance {$advance->reference} was received. Change it from Cash Advances."
        );
    }

    public function test_an_entry_made_by_an_approved_invoice_payment_cannot_be_edited_or_deleted(): void
    {
        Sanctum::actingAs($this->admin);
        $invoice = $this->postJson('/api/invoices', ['student_id' => $this->student->school_id, 'description' => 'Organization fee', 'amount_due' => '200.00'])->assertCreated()->json();
        $this->postJson("/api/invoices/{$invoice['id']}/payments", ['amount' => '50.00'])->assertOk();
        $payment = InvoicePayment::where('invoice_id', $invoice['id'])->firstOrFail();

        $this->assertEntryIsLocked(
            $payment->ledger_transaction_id,
            "This entry was recorded when a payment for invoice {$invoice['reference']} was approved. Change it from Student Financial Accounts."
        );
    }

    public function test_an_entry_made_by_a_paid_merchandise_order_cannot_be_edited_or_deleted(): void
    {
        $item = Merchandise::factory()->create(['organization_id' => $this->admin->organization_id, 'is_active' => true, 'stock_quantity' => 10, 'price' => '250.00']);
        Sanctum::actingAs($this->student);
        $orderId = $this->postJson('/api/orders', ['merchandise_id' => $item->id, 'quantity' => 1, 'payment_method' => 'cash'])->assertCreated()->json('id');
        Sanctum::actingAs($this->admin);
        $this->patchJson("/api/orders/{$orderId}/status", ['status' => 'paid'])->assertOk();

        $this->assertEntryIsLocked(
            Order::findOrFail($orderId)->transaction_id,
            "This entry was recorded when merchandise order ORD-{$orderId} was paid. Change it from Manage Orders."
        );
    }

    public function test_a_manual_ledger_entry_can_still_be_edited_and_deleted(): void
    {
        Sanctum::actingAs($this->admin);
        $id = $this->postJson('/api/transactions', [
            'type' => 'expense', 'amount' => 80, 'category' => 'Supplies', 'description' => 'Markers',
            'transaction_date' => now()->toDateString(),
        ])->assertCreated()->json('id');

        $this->putJson("/api/transactions/{$id}", ['description' => 'Markers and tape', 'amount' => 95])->assertOk();
        $this->assertSame('Markers and tape', Transaction::findOrFail($id)->description);
        $this->deleteJson("/api/transactions/{$id}")->assertOk();
        $this->assertDatabaseMissing('transactions', ['id' => $id]);
    }
}
