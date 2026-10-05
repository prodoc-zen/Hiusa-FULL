<?php

namespace Tests\Feature;

use App\Models\Event;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class OldCashAdvanceAndInvoiceEventBackfillTest extends TestCase
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

    private function entry(string $type, ?int $eventId = null): Transaction
    {
        return Transaction::factory()->create([
            'organization_id' => $this->organization->id, 'recorded_by' => $this->admin->school_id, 'type' => $type,
            'budget_id' => null, 'event_id' => $eventId, 'payer_id' => null, 'receipt_reference' => null,
        ]);
    }

    private function advance(string $reference, ?int $eventId, ?int $releaseEntryId): int
    {
        return DB::table('cash_advances')->insertGetId([
            'organization_id' => $this->organization->id, 'reference' => $reference, 'borrower_id' => $this->admin->school_id,
            'amount' => 500, 'purpose' => 'Venue deposit', 'event_id' => $eventId, 'status' => 'released',
            'release_transaction_id' => $releaseEntryId, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function repayment(int $advanceId, int $entryId): void
    {
        DB::table('cash_advance_repayments')->insert([
            'cash_advance_id' => $advanceId, 'amount' => 200, 'recorded_by' => $this->admin->school_id, 'repaid_at' => now(),
            'ledger_transaction_id' => $entryId, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function invoicePayment(string $reference, ?int $eventId, int $entryId): void
    {
        $invoiceId = DB::table('invoices')->insertGetId([
            'organization_id' => $this->organization->id, 'reference' => $reference, 'student_id' => $this->student->school_id,
            'description' => 'Event ticket', 'amount_due' => 300, 'event_id' => $eventId, 'status' => 'partially_paid',
            'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('invoice_payments')->insert([
            'invoice_id' => $invoiceId, 'amount' => 150, 'recorded_by' => $this->admin->school_id, 'status' => 'approved',
            'ledger_transaction_id' => $entryId, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    public function test_older_cash_advance_repayment_and_invoice_entries_gain_their_event_on_the_ledger(): void
    {
        $event = Event::factory()->create(['organization_id' => $this->organization->id, 'created_by' => $this->admin->school_id]);
        $otherEvent = Event::factory()->create(['organization_id' => $this->organization->id, 'created_by' => $this->admin->school_id]);

        $release = $this->entry('expense');
        $repayment = $this->entry('income');
        $payment = $this->entry('income');
        $advanceId = $this->advance('ADV-OLD-EVENT', $event->id, $release->id);
        $this->repayment($advanceId, $repayment->id);
        $this->invoicePayment('INV-OLD-EVENT', $event->id, $payment->id);

        $plainRelease = $this->entry('expense');
        $plainRepayment = $this->entry('income');
        $plainPayment = $this->entry('income');
        $plainAdvanceId = $this->advance('ADV-OLD-PLAIN', null, $plainRelease->id);
        $this->repayment($plainAdvanceId, $plainRepayment->id);
        $this->invoicePayment('INV-OLD-PLAIN', null, $plainPayment->id);

        $alreadyAttributed = $this->entry('expense', $otherEvent->id);
        $this->advance('ADV-OLD-ATTRIBUTED', $event->id, $alreadyAttributed->id);
        $manual = $this->entry('expense');

        (require database_path('migrations/2026_10_06_000002_attribute_old_cash_advance_and_invoice_entries_to_their_event.php'))->up();

        $this->assertSame($event->id, $release->fresh()->event_id);
        $this->assertSame($event->id, $repayment->fresh()->event_id);
        $this->assertSame($event->id, $payment->fresh()->event_id);
        $this->assertNull($plainRelease->fresh()->event_id);
        $this->assertNull($plainRepayment->fresh()->event_id);
        $this->assertNull($plainPayment->fresh()->event_id);
        $this->assertSame($otherEvent->id, $alreadyAttributed->fresh()->event_id);
        $this->assertNull($manual->fresh()->event_id);
    }
}
