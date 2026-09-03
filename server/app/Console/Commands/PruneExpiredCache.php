<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class PruneExpiredCache extends Command
{
    protected $signature = 'hiusa:prune-expired-cache';

    protected $description = 'Remove expired rows from the configured database cache store';

    public function handle(): int
    {
        $storeName = (string) config('cache.default');
        $store = config("cache.stores.{$storeName}");

        if (! is_array($store) || ($store['driver'] ?? null) !== 'database') {
            return self::SUCCESS;
        }

        DB::connection($store['connection'] ?? null)
            ->table($store['table'] ?? 'cache')
            ->where('expiration', '<=', now()->getTimestamp())
            ->delete();

        return self::SUCCESS;
    }
}
