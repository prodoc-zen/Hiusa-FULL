<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    // Collections verified before the fix posted their ledger entry without the
    // collection's event, so those events showed no income from them.
    public function up(): void
    {
        DB::table('transactions')
            ->whereNull('event_id')
            ->whereIn('id', DB::table('collections')->whereNotNull('event_id')->whereNotNull('ledger_transaction_id')->select('ledger_transaction_id'))
            ->update([
                'event_id' => DB::raw('(SELECT collections.event_id FROM collections WHERE collections.ledger_transaction_id = transactions.id LIMIT 1)'),
            ]);
    }

    public function down(): void {}
};
