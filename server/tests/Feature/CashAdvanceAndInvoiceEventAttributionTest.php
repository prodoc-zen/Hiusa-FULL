<?php

namespace Tests\Feature;

use App\Models\CashAdvance;
use App\Models\CashAdvanceRepayment;
use App\Models\Event;
use App\Models\Invoice;
use App\Models\InvoicePayment;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Money a cash advance, its repayments and an invoice payment move for an event
 * belongs to that event. The ledger entry each one creates must carry the event,
 * because the event's ledger filter, its summary and its event financial report
 * all read the entry's event.
 */
class CashAdvanceAndInvoiceEventAttributionTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private User $approver;

    private User $student;

    private Event $event;

    protected function setUp(): void
    {
        parent::setUp();
        $organization = Organization::factory()->create();
        $this->admin = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $this->approver = User::factory()->admin()->create(['organization_id' => $organization->id]);
        $this->student = User::factory()->student()->create(['organization_id' => $organization->id, 'account_status' => 'active']);
        $this->event = Event::factory()->create([
            'organization_id' => $organization->id, 'created_by' => $this->admin->school_id, 'status' => 'approved',
            'start_time' => now()->addWeek(), 'end_time' => now()->addWeek()->addHours(3),
        ]);
    }

    /** The ledger entries for a cash advance of 500 repaid by 200 and an invoice of 300 paid by 150, all for the given event. */
    private function moveMoney(?int $eventId): array
    {
        Sanctum::actingAs($this->admin);
        $advanceId = $this->postJson('/api/cash-advances', array_filter(['amount' => '500.00', 'purpose' => 'Venue deposit', 'event_id' => $eventId]))->assertCreated()->json('id');
        Sanctum::actingAs($this->approver);
        $this->patchJson("/api/cash-advances/{$advanceId}/approve")->assertOk();
        Sanctum::actingAs($this->admin);
        $this->patchJson("/api/cash-advances/{$advanceId}/release")->assertOk();
        $this->postJson("/api/cash-advances/{$advanceId}/repayments", ['amount' => '200.00'])->assertOk();
        $invoiceId = $this->postJson('/api/invoices', array_filter([
            'student_id' => $this->student->school_id, 'description' => 'Event ticket', 'amount_due' => '300.00', 'event_id' => $eventId,
        ]))->assertCreated()->json('id');
        $this->postJson("/api/invoices/{$invoiceId}/payments", ['amount' => '150.00'])->assertOk();

        return [
            'release' => Transaction::findOrFail(CashAdvance::findOrFail($advanceId)->release_transaction_id),
            'repayment' => Transaction::findOrFail(CashAdvanceRepayment::where('cash_advance_id', $advanceId)->value('ledger_transaction_id')),
            'payment' => Transaction::findOrFail(InvoicePayment::where('invoice_id', $invoiceId)->value('ledger_transaction_id')),
        ];
    }

    public function test_a_cash_advance_its_repayment_and_an_invoice_payment_carry_their_event_to_the_ledger(): void
    {
        $entries = $this->moveMoney($this->event->id);

        foreach ($entries as $kind => $entry) {
            $this->assertSame($this->event->id, $entry->event_id, "The {$kind} ledger entry lost its event.");
        }
        $this->getJson("/api/transactions?event_id={$this->event->id}")->assertOk()->assertJsonPath('total', 3);
        $this->getJson("/api/transactions/summary?event_id={$this->event->id}")->assertOk()
            ->assertJsonPath('total_income', 350)
            ->assertJsonPath('total_expense', 500)
            ->assertJsonPath('net_balance', -150);
    }

    public function test_entries_for_an_advance_and_an_invoice_without_an_event_stay_unattributed(): void
    {
        $entries = $this->moveMoney(null);

        foreach ($entries as $entry) {
            $this->assertNull($entry->event_id);
        }
        $this->getJson("/api/transactions?event_id={$this->event->id}")->assertOk()->assertJsonPath('total', 0);
        $this->getJson('/api/transactions')->assertOk()->assertJsonPath('total', 3);
    }
}
