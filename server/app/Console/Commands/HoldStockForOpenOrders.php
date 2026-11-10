<?php

namespace App\Console\Commands;

use App\Models\Merchandise;
use App\Models\Order;
use App\Services\OrderFulfillmentService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class HoldStockForOpenOrders extends Command
{
    protected $signature = 'orders:hold-stock {--dry-run : Report what would be held without changing any stock}';

    protected $description = 'Hold stock for pending orders placed before stock was held at order time';

    public function handle(OrderFulfillmentService $fulfillment): int
    {
        $held = 0;
        $short = [];

        DB::beginTransaction();

        Order::where('status', 'pending')->where('stock_held', false)->orderBy('id')->lockForUpdate()->get()
            ->each(function (Order $order) use ($fulfillment, &$held, &$short) {
                $item = Merchandise::withTrashed()->where('organization_id', $order->organization_id)->whereKey($order->merchandise_id)->lockForUpdate()->first();
                $variant = $order->merchandise_variant_id
                    ? $item?->variants()->where('organization_id', $order->organization_id)->whereKey($order->merchandise_variant_id)->lockForUpdate()->first()
                    : null;

                if (! $item
                    || $item->stock_quantity < $order->quantity
                    || ($order->merchandise_variant_id && (! $variant || $variant->stock_quantity < $order->quantity))) {
                    $short[] = $order->id;

                    return;
                }

                $fulfillment->holdStock($order, $item, $variant);
                $held++;
            });

        $this->option('dry-run') ? DB::rollBack() : DB::commit();

        $this->line(($this->option('dry-run') ? 'Would hold' : 'Held').' stock for '.$held.' pending order(s).');
        if ($short) {
            $this->warn('Not enough stock left to hold these orders, so they are unchanged: ORD-'.implode(', ORD-', $short));
        }

        return self::SUCCESS;
    }
}
