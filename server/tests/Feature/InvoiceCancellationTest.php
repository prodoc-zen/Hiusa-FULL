<?php

namespace Tests\Feature;

use App\Models\ApprovalRequest;
use App\Models\AuditLog;
use App\Models\Invoice;
use App\Models\InvoicePayment;
use App\Models\Merchandise;
use App\Models\Organization;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * A student charge nobody paid on can be cancelled (it should not have been
 * charged) or waived (the student is excused), with a reason. An order that is
 * cancelled or rejected no longer bills the student, so its unpaid invoice is
 * cancelled with it instead of staying open as a debt.
 */
class InvoiceCancellationTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    private User $admin;

    private User $student;

    private Merchandise $item;

    protected function setUp(): void
    {
        parent::setUp();
        $this->organization = Organization::factory()->create();
        $this->admin = User::factory()->admin()->create(['organization_id' => $this->organization->id]);
        $this->student = User::factory()->student()->create(['organization_id' => $this->organization->id]);
        $this->item = Merchandise::factory()->create(['organization_id' => $this->organization->id, 'is_active' => true, 'stock_quantity' => 10, 'price' => '300.00']);
    }

    private function invoice(string $amount = '300.00', ?int $orderId = null): array
    {
        Sanctum::actingAs($this->admin);

        return $this->postJson('/api/invoices', array_filter([
            'student_id' => $this->student->school_id, 'description' => 'Organization fee', 'amount_due' => $amount, 'order_id' => $orderId,
        ]))->assertCreated()->json();
    }

    private function pendingOrder(): int
    {
        Sanctum::actingAs($this->student);

        return $this->postJson('/api/orders', ['merchandise_id' => $this->item->id, 'quantity' => 1, 'payment_method' => 'cash'])->assertCreated()->json('id');
    }

    private function close(int $invoiceId, array $body)
    {
        return $this->patchJson("/api/invoices/{$invoiceId}/status", $body);
    }

    private function debt(): array
    {
        Sanctum::actingAs($this->admin);

        return $this->getJson('/api/student-debts?student_id='.$this->student->school_id)->assertOk()->json('0');
    }

    public function test_an_admin_cancels_an_unpaid_invoice_with_a_reason_and_it_leaves_the_students_balance(): void
    {
        $invoice = $this->invoice();
        $this->assertEquals(300, $this->debt()['total_debt']);

        Sanctum::actingAs($this->admin);
        $this->close($invoice['id'], ['status' => 'cancelled', 'reason' => 'Charged to the wrong student.'])->assertOk()
            ->assertJsonPath('status', 'cancelled')
            ->assertJsonPath('status_reason', 'Charged to the wrong student.')
            ->assertJsonPath('remaining_balance', 0)
            ->assertJsonPath('clearance_status', 'financially_cleared');

        $debt = $this->debt();
        $this->assertEquals(0, $debt['total_debt']);
        $this->assertCount(0, $debt['invoices']);
        $log = AuditLog::where('module', 'invoices')->where('action', 'cancelled')->where('record_id', $invoice['id'])->firstOrFail();
        $this->assertSame($this->admin->school_id, $log->user_id);
        $this->assertSame('ADMIN', $log->actor_role);
        $this->assertSame('Charged to the wrong student.', $log->new_values['status_reason']);

        Sanctum::actingAs($this->student);
        $this->getJson('/api/invoices')->assertOk()
            ->assertJsonPath('0.status', 'cancelled')
            ->assertJsonPath('0.remaining_balance', 0);
    }

    public function test_an_admin_can_waive_an_unpaid_invoice(): void
    {
        $invoice = $this->invoice('150.00');

        $this->close($invoice['id'], ['status' => 'waived', 'reason' => 'Scholar excused from the fee.'])->assertOk()
            ->assertJsonPath('status', 'waived')
            ->assertJsonPath('remaining_balance', 0);

        $this->assertEquals(0, $this->debt()['total_debt']);
        $this->assertDatabaseHas('audit_logs', ['module' => 'invoices', 'action' => 'waived', 'record_id' => $invoice['id']]);
    }

    public function test_a_reason_is_required_and_the_status_must_be_cancelled_or_waived(): void
    {
        $invoice = $this->invoice();

        $this->close($invoice['id'], ['status' => 'cancelled'])->assertUnprocessable()->assertJsonValidationErrors('reason');
        $this->close($invoice['id'], ['status' => 'cancelled', 'reason' => '   '])->assertUnprocessable()->assertJsonValidationErrors('reason');
        $this->close($invoice['id'], ['status' => 'cancelled', 'reason' => str_repeat('x', 501)])->assertUnprocessable()->assertJsonValidationErrors('reason');
        $this->close($invoice['id'], ['status' => 'paid', 'reason' => 'Marked paid by hand.'])->assertUnprocessable()->assertJsonValidationErrors('status');

        $this->assertSame('unpaid', Invoice::findOrFail($invoice['id'])->status);
        $this->assertSame(0, AuditLog::where('module', 'invoices')->whereIn('action', ['cancelled', 'waived'])->count());
    }

    public function test_an_invoice_with_an_approved_payment_cannot_be_cancelled_or_waived(): void
    {
        $invoice = $this->invoice();
        $this->postJson("/api/invoices/{$invoice['id']}/payments", ['amount' => '100.00'])->assertOk()->assertJsonPath('status', 'partially_paid');

        $this->close($invoice['id'], ['status' => 'cancelled', 'reason' => 'Changed my mind.'])->assertConflict()
            ->assertJsonPath('message', 'Payments were already approved on this invoice, so it can no longer be cancelled or waived.');

        $this->assertSame('partially_paid', Invoice::findOrFail($invoice['id'])->status);
        $this->assertNull(Invoice::findOrFail($invoice['id'])->status_reason);
        $this->assertSame(0, AuditLog::where('module', 'invoices')->whereIn('action', ['cancelled', 'waived'])->count());
    }

    public function test_a_closed_invoice_cannot_be_closed_again(): void
    {
        $cancelled = $this->invoice();
        $this->close($cancelled['id'], ['status' => 'cancelled', 'reason' => 'Issued in error.'])->assertOk();
        $this->close($cancelled['id'], ['status' => 'waived', 'reason' => 'Second thoughts.'])->assertConflict()
            ->assertJsonPath('message', 'This invoice is already cancelled.');

        $paid = $this->invoice('100.00');
        $this->postJson("/api/invoices/{$paid['id']}/payments", ['amount' => '100.00'])->assertOk()->assertJsonPath('status', 'paid');
        $this->close($paid['id'], ['status' => 'cancelled', 'reason' => 'Refund.'])->assertConflict()
            ->assertJsonPath('message', 'This invoice is already paid.');
    }

    public function test_a_payment_cannot_be_recorded_on_a_cancelled_or_waived_invoice(): void
    {
        $cancelled = $this->invoice();
        $waived = $this->invoice('150.00');
        $this->close($cancelled['id'], ['status' => 'cancelled', 'reason' => 'Issued in error.'])->assertOk();
        $this->close($waived['id'], ['status' => 'waived', 'reason' => 'Scholar excused.'])->assertOk();

        $this->postJson("/api/invoices/{$cancelled['id']}/payments", ['amount' => '100.00'])->assertConflict()
            ->assertJsonPath('message', 'This invoice is already cancelled.');
        $this->postJson("/api/invoices/{$waived['id']}/payments", ['amount' => '50.00'])->assertConflict()
            ->assertJsonPath('message', 'This invoice is already waived.');

        $this->assertSame('cancelled', Invoice::findOrFail($cancelled['id'])->status);
        $this->assertSame('waived', Invoice::findOrFail($waived['id'])->status);
        $this->assertSame(0, InvoicePayment::count());
        $this->assertSame(0, Transaction::count());
    }

    public function test_only_an_admin_of_the_same_organization_can_close_an_invoice(): void
    {
        $invoice = $this->invoice();
        $body = ['status' => 'cancelled', 'reason' => 'Issued in error.'];

        foreach ([User::factory()->officer(), User::factory()->departmentHead(), User::factory()->student()] as $factory) {
            Sanctum::actingAs($factory->create(['organization_id' => $this->organization->id]));
            $this->close($invoice['id'], $body)->assertForbidden();
        }
        Sanctum::actingAs(User::factory()->admin()->create(['organization_id' => Organization::factory()->create()->id]));
        $this->close($invoice['id'], $body)->assertNotFound();

        $this->assertSame('unpaid', Invoice::findOrFail($invoice['id'])->status);
    }

    public function test_the_route_is_admin_only_and_rate_limited_like_the_other_finance_writes(): void
    {
        $route = collect(Route::getRoutes()->getRoutes())->first(fn ($candidate) => $candidate->uri() === 'api/invoices/{invoice}/status' && in_array('PATCH', $candidate->methods(), true));

        $this->assertNotNull($route);
        $this->assertContains('throttle:api-write', $route->gatherMiddleware());
        $this->assertContains('role:ADMIN', $route->gatherMiddleware());
        $this->assertContains('auth:sanctum', $route->gatherMiddleware());
    }

    public function test_a_buyer_cancelling_the_order_cancels_its_unpaid_invoice_and_names_the_order(): void
    {
        $orderId = $this->pendingOrder();
        $invoice = $this->invoice('300.00', $orderId);
        $this->assertEquals(300, $this->debt()['total_debt']);

        Sanctum::actingAs($this->student);
        $this->patchJson("/api/orders/{$orderId}/cancel")->assertOk()->assertJsonPath('status', 'cancelled');

        $closed = Invoice::findOrFail($invoice['id']);
        $this->assertSame('cancelled', $closed->status);
        $this->assertSame("Order ORD-{$orderId} was cancelled by the buyer.", $closed->status_reason);
        $this->assertDatabaseHas('audit_logs', ['module' => 'invoices', 'action' => 'cancelled', 'record_id' => $invoice['id'], 'user_id' => $this->student->school_id]);
        $this->assertEquals(0, $this->debt()['total_debt']);
    }

    public function test_rejecting_the_order_cancels_its_unpaid_invoice_and_names_the_order(): void
    {
        $orderId = $this->pendingOrder();
        $invoice = $this->invoice('300.00', $orderId);

        Sanctum::actingAs($this->admin);
        $this->patchJson("/api/orders/{$orderId}/status", ['status' => 'cancelled', 'review_remarks' => 'Out of stock.'])->assertOk();

        $closed = Invoice::findOrFail($invoice['id']);
        $this->assertSame('cancelled', $closed->status);
        $this->assertSame("Order ORD-{$orderId} was rejected.", $closed->status_reason);
        $this->assertEquals(0, $this->debt()['total_debt']);
    }

    public function test_rejecting_the_payment_from_the_approvals_queue_also_cancels_the_unpaid_invoice(): void
    {
        $orderId = $this->pendingOrder();
        $invoice = $this->invoice('300.00', $orderId);
        $approval = ApprovalRequest::create([
            'organization_id' => $this->organization->id, 'entity_type' => 'payment', 'entity_id' => $orderId, 'requested_by' => $this->student->school_id,
            'required_role' => 'ADMIN', 'status' => 'pending', 'active_key' => 'payment:'.$this->organization->id.':'.$orderId, 'requested_at' => now(),
        ]);

        Sanctum::actingAs($this->admin);
        $this->patchJson("/api/approval-requests/{$approval->id}", ['status' => 'rejected', 'remarks' => 'Proof does not match.'])->assertOk();

        $this->assertSame('cancelled', Invoice::findOrFail($invoice['id'])->status);
        $this->assertSame("Order ORD-{$orderId} was rejected.", Invoice::findOrFail($invoice['id'])->status_reason);
    }

    public function test_an_invoice_that_already_took_a_payment_stays_open_when_its_order_is_cancelled(): void
    {
        $orderId = $this->pendingOrder();
        $invoice = $this->invoice('300.00', $orderId);
        Sanctum::actingAs($this->admin);
        $this->postJson("/api/invoices/{$invoice['id']}/payments", ['amount' => '100.00'])->assertOk()->assertJsonPath('status', 'partially_paid');

        $this->patchJson("/api/orders/{$orderId}/status", ['status' => 'cancelled', 'review_remarks' => 'Out of stock.'])->assertOk();

        $this->assertSame('partially_paid', Invoice::findOrFail($invoice['id'])->status);
        $this->assertNull(Invoice::findOrFail($invoice['id'])->status_reason);
        $this->assertEquals(200, $this->debt()['total_debt']);
    }
}
