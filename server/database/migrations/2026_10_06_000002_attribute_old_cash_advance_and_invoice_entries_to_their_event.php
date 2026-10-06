<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    // Cash advances, their repayments and invoice payments recorded before the fix
    // posted their ledger entry without the event they were for, so those events
    // showed none of that money. Only entries with no event yet are filled in.
    public function up(): void
    {
        DB::table('transactions')
            ->whereNull('event_id')
            ->whereIn('id', DB::table('cash_advances')->whereNotNull('event_id')->whereNotNull('release_transaction_id')->select('release_transaction_id'))
            ->update([
                'event_id' => DB::raw('(SELECT cash_advances.event_id FROM cash_advances WHERE cash_advances.release_transaction_id = transactions.id LIMIT 1)'),
            ]);

        DB::table('transactions')
            ->whereNull('event_id')
            ->whereIn('id', DB::table('cash_advance_repayments')
                ->join('cash_advances', 'cash_advances.id', '=', 'cash_advance_repayments.cash_advance_id')
                ->whereNotNull('cash_advances.event_id')
                ->whereNotNull('cash_advance_repayments.ledger_transaction_id')
                ->select('cash_advance_repayments.ledger_transaction_id'))
            ->update([
                'event_id' => DB::raw('(SELECT cash_advances.event_id FROM cash_advance_repayments JOIN cash_advances ON cash_advances.id = cash_advance_repayments.cash_advance_id WHERE cash_advance_repayments.ledger_transaction_id = transactions.id LIMIT 1)'),
            ]);

        DB::table('transactions')
            ->whereNull('event_id')
            ->whereIn('id', DB::table('invoice_payments')
                ->join('invoices', 'invoices.id', '=', 'invoice_payments.invoice_id')
                ->whereNotNull('invoices.event_id')
                ->whereNotNull('invoice_payments.ledger_transaction_id')
                ->select('invoice_payments.ledger_transaction_id'))
            ->update([
                'event_id' => DB::raw('(SELECT invoices.event_id FROM invoice_payments JOIN invoices ON invoices.id = invoice_payments.invoice_id WHERE invoice_payments.ledger_transaction_id = transactions.id LIMIT 1)'),
            ]);
    }

    public function down(): void {}
};
