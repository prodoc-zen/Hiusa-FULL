<?php

namespace App\Services;

use App\Exceptions\InvoiceSettlementRequired;
use App\Models\ApprovalRequest;
use App\Models\AuditLog;
use App\Models\Invoice;
use App\Models\InvoicePayment;
use App\Models\Merchandise;
use App\Models\Notification;
use App\Models\Order;
use App\Models\Transaction;
use App\Models\User;
use DomainException;
use Illuminate\Support\Facades\DB;

class OrderFulfillmentService
{
    /** Why this order cannot be paid from the order side: an invoice still bills it and is where its money is recorded. */
    public function billedOnInvoiceMessage(Order $order): ?string
    {
        $invoice = $order->billingInvoice()->first();

        if (! $invoice || $invoice->remainingBalance() < 0.005) {
            return null;
        }

        return "This order is billed on invoice {$invoice->reference}. Record the payment on the invoice from Student Financial Accounts; the order is marked paid when the invoice is paid in full.";
    }

    /** The invoice's final payment already posted the money, so the order only needs approving, not a second entry. */
    public function settleOrderPaidByInvoice(Invoice $invoice, User $actor): void
    {
        $order = Order::where('organization_id', $invoice->organization_id)->whereKey($invoice->order_id)->first();

        if (! $order || $order->status !== 'pending') {
            return;
        }

        $this->approvePayment($order, $actor, true);

        ApprovalRequest::where('organization_id', $order->organization_id)
            ->where('entity_type', 'payment')
            ->where('entity_id', $order->id)
            ->where('status', 'pending')
            ->lockForUpdate()
            ->get()
            ->each(function (ApprovalRequest $approval) use ($invoice, $actor) {
                $remarks = "Paid in full through invoice {$invoice->reference}.";
                $approval->update(['status' => 'approved', 'active_key' => null, 'remarks' => $remarks, 'reviewed_by' => $actor->school_id, 'reviewed_at' => now()]);
                AuditLog::create([
                    'organization_id' => $approval->organization_id, 'user_id' => $actor->school_id, 'module' => 'approvals',
                    'action' => 'payment_approved_from_invoice', 'record_type' => ApprovalRequest::class, 'record_id' => $approval->id,
                    'new_values' => ['entity_type' => 'payment', 'entity_id' => $approval->entity_id, 'status' => 'approved', 'remarks' => $remarks],
                    'created_at' => now(),
                ]);
            });
    }

    /**
     * Cancels or waives a student charge nobody has paid on. Cancelled means it should not have
     * been charged; waived means it was owed and the student is excused. Either way it stops
     * being a debt.
     *
     * @throws DomainException when the charge is closed already or a payment was approved on it
     */
    public function closeInvoice(Invoice $invoice, string $status, string $reason, User $actor, ?string $ipAddress = null): Invoice
    {
        return DB::transaction(function () use ($invoice, $status, $reason, $actor, $ipAddress) {
            $locked = Invoice::whereKey($invoice->id)->lockForUpdate()->firstOrFail();

            if ($message = $locked->closeRefusal()) {
                throw new DomainException($message);
            }

            $locked->update(['status' => $status, 'status_reason' => $reason]);
            AuditLog::create([
                'organization_id' => $locked->organization_id, 'user_id' => $actor->school_id, 'actor_role' => $actor->role,
                'module' => 'invoices', 'action' => $status, 'description' => 'Invoice '.$locked->reference.' was '.$status.'.',
                'record_type' => Invoice::class, 'record_id' => $locked->id, 'new_values' => $locked->getAttributes(),
                'ip_address' => $ipAddress, 'created_at' => now(),
            ]);

            return $locked->fresh();
        });
    }

    /**
     * An order that will never be paid no longer bills the student, so its invoice is cancelled with it.
     *
     * @throws InvoiceSettlementRequired when a payment was already approved on the invoice: cancelling the order would strand the money and the balance
     */
    public function cancelInvoiceOfClosedOrder(Order $order, User $actor, string $reason): void
    {
        $invoice = Invoice::where('organization_id', $order->organization_id)->where('order_id', $order->id)->first();

        if (! $invoice) {
            return;
        }

        if (! $invoice->isVoided() && $invoice->payments()->where('status', 'approved')->exists()) {
            throw new InvoiceSettlementRequired("Invoice {$invoice->reference} already has approved payments. Settle or waive the invoice from Student Financial Accounts before cancelling this order.");
        }

        try {
            $this->closeInvoice($invoice, 'cancelled', $reason, $actor);
        } catch (DomainException) {
            // Closed already: nothing left to cancel.
        }
    }

    public function approvePayment(Order $order, User $approver, bool $bypassOfficerReview = false): Order
    {
        if ($order->status === 'cancelled') {
            throw new DomainException('Cancelled orders cannot be approved.');
        }

        if ($order->status === 'claimed') {
            throw new DomainException('Claimed orders cannot be reviewed again.');
        }

        return DB::transaction(function () use ($order, $approver, $bypassOfficerReview) {
            $lockedOrder = Order::whereKey($order->id)->lockForUpdate()->firstOrFail();
            $wasPaid = $lockedOrder->status === 'paid';
            $oldOrderValues = $this->auditableOrderValues($lockedOrder);

            if (! $wasPaid) {
                if ($message = $this->billedOnInvoiceMessage($lockedOrder)) {
                    throw new DomainException($message);
                }

                $item = Merchandise::where('organization_id', $lockedOrder->organization_id)
                    ->whereKey($lockedOrder->merchandise_id)
                    ->lockForUpdate()
                    ->first();

                if (! $item || ! $item->is_active) {
                    throw new DomainException('This merchandise item is no longer available for payment approval.');
                }

                if ($item->stock_quantity < $lockedOrder->quantity) {
                    throw new DomainException("Insufficient stock to approve this order. Only {$item->stock_quantity} unit(s) remain.");
                }

                $oldStock = $item->stock_quantity;
                $variant = null;
                $oldVariantStock = null;
                if ($item->variants()->exists()) {
                    $variant = $item->variants()->where('organization_id', $item->organization_id)
                        ->whereKey($lockedOrder->merchandise_variant_id)->lockForUpdate()->first();
                    if (! $variant || $variant->stock_quantity < $lockedOrder->quantity) {
                        throw new DomainException('Insufficient stock for the selected variant.');
                    }
                    $oldVariantStock = $variant->stock_quantity;
                    $variant->decrement('stock_quantity', $lockedOrder->quantity);
                }

                $item->decrement('stock_quantity', $lockedOrder->quantity);
                AuditLog::create([
                    'organization_id' => $item->organization_id, 'user_id' => $approver->school_id,
                    'actor_role' => $approver->role, 'module' => 'merchandise', 'action' => 'stock_reserved',
                    'description' => 'Stock reserved for order ORD-'.$lockedOrder->id,
                    'record_type' => Merchandise::class, 'record_id' => $item->id,
                    'old_values' => ['stock_quantity' => $oldStock, 'variant_stock_quantity' => $oldVariantStock],
                    'new_values' => ['stock_quantity' => $item->fresh()->stock_quantity, 'variant_stock_quantity' => $variant?->fresh()->stock_quantity, 'variant_id' => $variant?->id, 'variant_name' => $variant?->name, 'order_id' => $lockedOrder->id],
                    'created_at' => now(),
                ]);
            }

            $lockedOrder->update([
                'officer_review_status' => $bypassOfficerReview ? 'bypassed' : 'approved',
                'admin_review_status' => 'approved',
                'approved_by' => $approver->school_id,
                'processed_by' => $approver->school_id,
                'review_remarks' => null,
                'status' => 'paid',
            ]);

            $this->ensureReceipt($lockedOrder->fresh(), $approver);
            $this->audit($lockedOrder->fresh(), $approver, $bypassOfficerReview ? 'payment_approved_admin_bypass' : 'payment_approved', $oldOrderValues);

            if (! $wasPaid) {
                $this->notifyBuyer(
                    $lockedOrder,
                    'Payment Approved',
                    'Your merchandise payment was approved. Your digital receipt and claim token are ready.'
                );
            }

            return $lockedOrder->fresh();
        });
    }

    public function rejectPayment(Order $order, User $reviewer, string $remarks): Order
    {
        if ($order->status !== 'pending') {
            throw new DomainException('Only pending orders can be rejected.');
        }

        return DB::transaction(function () use ($order, $reviewer, $remarks) {
            $lockedOrder = Order::whereKey($order->id)->lockForUpdate()->firstOrFail();

            if ($lockedOrder->status !== 'pending') {
                throw new DomainException('Only pending orders can be rejected.');
            }

            $oldOrderValues = $this->auditableOrderValues($lockedOrder);

            $lockedOrder->update([
                'processed_by' => $reviewer->school_id,
                'officer_review_status' => $reviewer->role === 'SBO_OFFICER' ? 'rejected' : $lockedOrder->officer_review_status,
                'admin_review_status' => $reviewer->role === 'ADMIN' ? 'rejected' : $lockedOrder->admin_review_status,
                'review_remarks' => $remarks,
                'status' => 'cancelled',
            ]);
            $this->cancelInvoiceOfClosedOrder($lockedOrder, $reviewer, "Order ORD-{$lockedOrder->id} was rejected.");
            $this->notifyBuyer($lockedOrder, 'Payment Rejected', $remarks);
            $this->audit($lockedOrder->fresh(), $reviewer, 'payment_rejected', $oldOrderValues);

            return $lockedOrder->fresh();
        });
    }

    private function ensureReceipt(Order $order, User $approver): void
    {
        if ($order->transaction_id) {
            return;
        }

        $invoice = $order->billingInvoice()->first();
        $invoiceEntryId = $invoice && $invoice->remainingBalance() < 0.005
            ? InvoicePayment::where('invoice_id', $invoice->id)->where('status', 'approved')->whereNotNull('ledger_transaction_id')->latest('id')->value('ledger_transaction_id')
            : null;

        if ($invoiceEntryId) {
            $order->update(['transaction_id' => $invoiceEntryId]);

            return;
        }

        $receiptReference = 'MERCH-ORD-'.$order->id;
        $receiptNumber = ((int) Transaction::where('organization_id', $order->organization_id)
            ->whereNull('event_id')
            ->lockForUpdate()
            ->max('receipt_number')) + 1;
        $transaction = Transaction::firstOrCreate(
            [
                'organization_id' => $order->organization_id,
                'receipt_reference' => $receiptReference,
            ],
            [
                'type' => 'income',
                'amount' => $order->total_price,
                'category' => 'Merchandise',
                'description' => 'Merchandise order ORD-'.$order->id,
                'recorded_by' => $approver->school_id,
                'payer_id' => $order->student_id,
                'transaction_date' => now(),
                'receipt_number' => $receiptNumber,
            ]
        );

        $order->update(['transaction_id' => $transaction->id]);
    }

    private function notifyBuyer(Order $order, string $title, string $message): void
    {
        Notification::create([
            'organization_id' => $order->organization_id,
            'user_id' => $order->student_id,
            'title' => $title,
            'message' => $message,
            'notification_type' => 'merchandise',
            'reference_type' => Order::class,
            'reference_id' => $order->id,
            'is_read' => false,
            'sent_at' => now(),
        ]);
    }

    private function auditableOrderValues(Order $order): array
    {
        return $order->only(['id', 'merchandise_id', 'merchandise_variant_id', 'variant_name', 'quantity', 'unit_price', 'total_price', 'promotion_applied', 'status', 'officer_review_status', 'admin_review_status', 'review_remarks', 'student_id', 'processed_by', 'approved_by', 'claim_verified_by', 'transaction_id', 'payment_method']);
    }

    private function audit(Order $order, User $actor, string $action, ?array $oldValues = null): void
    {
        AuditLog::create(['organization_id' => $order->organization_id, 'user_id' => $actor->school_id, 'actor_role' => $actor->role, 'module' => 'orders', 'action' => $action, 'description' => 'Merchandise order ORD-'.$order->id.' payment review recorded.', 'record_type' => Order::class, 'record_id' => $order->id, 'old_values' => $oldValues, 'new_values' => $this->auditableOrderValues($order), 'created_at' => now()]);
    }
}
