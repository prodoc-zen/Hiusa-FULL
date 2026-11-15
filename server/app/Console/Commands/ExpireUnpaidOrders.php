<?php

namespace App\Console\Commands;

use App\Models\AuditLog;
use App\Models\Notification;
use App\Models\Order;
use App\Services\OrderFulfillmentService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class ExpireUnpaidOrders extends Command
{
    protected $signature = 'orders:expire-unpaid';

    protected $description = 'Cancel orders with no payment and no payment proof after the allowed days, return their held stock and tell the buyer';

    public function handle(OrderFulfillmentService $fulfillment): int
    {
        $days = Order::unpaidExpiryDays();
        $cutoff = now()->subDays($days);
        $expired = 0;

        Order::query()
            ->awaitingFirstPayment()
            ->where('created_at', '<=', $cutoff)
            ->pluck('id')
            ->each(function (int $id) use ($fulfillment, $cutoff, $days, &$expired) {
                $done = DB::transaction(function () use ($fulfillment, $cutoff, $days, $id) {
                    // Checked again under the lock: the buyer may have sent proof or staff may have started a review since the list was read.
                    $order = Order::query()->awaitingFirstPayment()->where('created_at', '<=', $cutoff)->lockForUpdate()->find($id);
                    if (! $order) {
                        return false;
                    }

                    $remarks = "Cancelled because no payment was received within {$days} days.";
                    $order->update(['status' => 'cancelled', 'review_remarks' => $remarks]);
                    $fulfillment->releaseStock($order);
                    $fulfillment->cancelInvoiceOfClosedOrder($order, null, "Order ORD-{$order->id} lapsed unpaid.");
                    AuditLog::create([
                        'organization_id' => $order->organization_id, 'module' => 'orders', 'action' => 'expired_unpaid',
                        'description' => 'Merchandise order ORD-'.$order->id.' was cancelled because no payment was received.',
                        'record_type' => Order::class, 'record_id' => $order->id,
                        'old_values' => ['status' => 'pending'], 'new_values' => ['status' => 'cancelled', 'review_remarks' => $remarks, 'expiry_days' => $days],
                        'created_at' => now(),
                    ]);
                    Notification::create([
                        'organization_id' => $order->organization_id,
                        'user_id' => $order->student_id,
                        'title' => 'Order Cancelled',
                        'message' => 'Order ORD-'.$order->id." was cancelled because no payment was received within {$days} days. The stock was returned.",
                        'notification_type' => 'financial',
                        'reference_type' => Order::class,
                        'reference_id' => $order->id,
                        'is_read' => false,
                        'sent_at' => now(),
                    ]);

                    return true;
                });

                if ($done) {
                    $expired++;
                }
            });

        $this->info("Cancelled {$expired} unpaid order(s).");

        return Command::SUCCESS;
    }
}
