<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('transactions') || ! Schema::hasColumn('transactions', 'receipt_reference')) {
            return;
        }

        DB::table('transactions')
            ->orderBy('id')
            ->where(function ($query) {
                $query->whereNull('receipt_reference')->orWhereNull('receipt_number');
            })
            ->each(function ($transaction): void {
                $updates = [];

                if (empty($transaction->receipt_reference)) {
                    $updates['receipt_reference'] = 'HIUSA-'.$transaction->organization_id.'-'.str_pad((string) $transaction->id, 8, '0', STR_PAD_LEFT);
                }

                if (empty($transaction->receipt_number)) {
                    $maximum = DB::table('transactions')
                        ->where('organization_id', $transaction->organization_id)
                        ->when(
                            $transaction->event_id,
                            fn ($query) => $query->where('event_id', $transaction->event_id),
                            fn ($query) => $query->whereNull('event_id'),
                        )
                        ->whereNotNull('receipt_number')
                        ->max('receipt_number');
                    $updates['receipt_number'] = ((int) $maximum) + 1;
                }

                DB::table('transactions')->where('id', $transaction->id)->update($updates);
            });
    }

    public function down(): void
    {
        // Generated receipt identities are intentionally retained for auditability.
    }
};
