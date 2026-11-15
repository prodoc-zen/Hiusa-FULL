<?php

namespace App\Console\Commands;

use App\Models\Merchandise;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Console\Command;

class SendLowStockNotices extends Command
{
    protected $signature = 'inventory:low-stock-notices';

    protected $description = 'Tell each organization\'s Admins about active merchandise at or below its low-stock threshold, once per item per day';

    public function handle(): int
    {
        $created = 0;

        Merchandise::query()
            ->where('is_active', true)
            ->whereColumn('stock_quantity', '<=', 'low_stock_threshold')
            ->each(function (Merchandise $item) use (&$created) {
                $admins = User::whereHas('accountProfiles', fn ($profiles) => $profiles->where('organization_id', $item->organization_id)->where('role', 'ADMIN')->where('account_status', 'active'))
                    ->get(['school_id']);

                foreach ($admins as $admin) {
                    $alreadyToday = Notification::where('user_id', $admin->school_id)
                        ->where('reference_type', Merchandise::class)
                        ->where('reference_id', $item->id)
                        ->where('title', 'Low Stock')
                        ->whereDate('sent_at', today())
                        ->exists();

                    if ($alreadyToday) {
                        continue;
                    }

                    Notification::create([
                        'organization_id' => $item->organization_id,
                        'user_id' => $admin->school_id,
                        'title' => 'Low Stock',
                        'message' => $item->stock_quantity > 0
                            ? "{$item->name} has {$item->stock_quantity} left. Restock before it sells out."
                            : "{$item->name} is out of stock.",
                        'notification_type' => 'merchandise',
                        'reference_type' => Merchandise::class,
                        'reference_id' => $item->id,
                        'is_read' => false,
                        'sent_at' => now(),
                    ]);
                    $created++;
                }
            });

        $this->info("Created {$created} low stock notice(s).");

        return Command::SUCCESS;
    }
}
