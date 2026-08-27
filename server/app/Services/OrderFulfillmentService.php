<?php

namespace App\Services;

use App\Models\Notification;
use App\Models\AuditLog;
use App\Models\Order;
use App\Models\Transaction;
use App\Models\User;
use DomainException;
use Illuminate\Support\Facades\DB;

class OrderFulfillmentService
{
    public function approvePayment(Order $order, User $approver): Order
    {
        if ($order->status === 'cancelled') {
            throw new DomainException('Cancelled orders cannot be approved.');
        }

        if ($order->status === 'claimed') {
            throw new DomainException('Claimed orders cannot be reviewed again.');
        }

        return DB::transaction(function () use ($order, $approver) {
            $lockedOrder = Order::whereKey($order->id)->lockForUpdate()->firstOrFail();
            $wasPaid = $lockedOrder->status === 'paid';

            $lockedOrder->update([
                'officer_review_status' => 'approved',
                'admin_review_status' => 'approved',
                'approved_by' => $approver->school_id,
                'processed_by' => $approver->school_id,
                'review_remarks' => null,
                'status' => 'paid',
            ]);

            $this->ensureReceipt($lockedOrder->fresh(), $approver);
            $this->audit($lockedOrder->fresh(), $approver, 'payment_approved');

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

            $lockedOrder->update([
                'processed_by' => $reviewer->school_id,
                'officer_review_status' => $reviewer->role === 'SBO_OFFICER' ? 'rejected' : $lockedOrder->officer_review_status,
                'admin_review_status' => $reviewer->role === 'ADMIN' ? 'rejected' : $lockedOrder->admin_review_status,
                'review_remarks' => $remarks,
                'status' => 'cancelled',
            ]);
            $lockedOrder->merchandise()->increment('stock_quantity', $lockedOrder->quantity);
            $this->notifyBuyer($lockedOrder, 'Payment Rejected', $remarks);
            $this->audit($lockedOrder->fresh(), $reviewer, 'payment_rejected');

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

    private function audit(Order $order, User $actor, string $action): void
    {
        AuditLog::create(['organization_id'=>$order->organization_id, 'user_id'=>$actor->school_id, 'module'=>'orders', 'action'=>$action, 'record_type'=>Order::class, 'record_id'=>$order->id, 'new_values'=>$order->only(['status','transaction_id','approved_by','processed_by']), 'created_at'=>now()]);
    }
}
