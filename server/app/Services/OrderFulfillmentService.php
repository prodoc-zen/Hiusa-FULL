<?php

namespace App\Services;

use App\Models\AuditLog;
use App\Models\Merchandise;
use App\Models\Notification;
use App\Models\Order;
use App\Models\Transaction;
use App\Models\User;
use DomainException;
use Illuminate\Support\Facades\DB;

class OrderFulfillmentService
{
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
