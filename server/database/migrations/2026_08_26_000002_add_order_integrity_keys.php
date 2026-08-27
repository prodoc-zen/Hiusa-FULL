<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->string('payment_reference_key', 64)->nullable()->after('payment_reference');
        });
        Schema::table('approval_requests', function (Blueprint $table) {
            $table->string('active_key', 100)->nullable()->after('status');
        });

        $seenReferences = [];
        DB::table('orders')
            ->whereNotNull('payment_reference')
            ->orderBy('id')
            ->get(['id', 'organization_id', 'payment_reference'])
            ->each(function ($order) use (&$seenReferences): void {
                $key = hash('sha256', $order->organization_id.':'.trim((string) $order->payment_reference));
                if (isset($seenReferences[$key])) {
                    return;
                }
                $seenReferences[$key] = true;
                DB::table('orders')->where('id', $order->id)->update(['payment_reference_key' => $key]);
            });

        $seenApprovals = [];
        DB::table('approval_requests')
            ->where('entity_type', 'payment')
            ->where('status', 'pending')
            ->orderBy('id')
            ->get(['id', 'organization_id', 'entity_id'])
            ->each(function ($approval) use (&$seenApprovals): void {
                $key = 'payment:'.$approval->organization_id.':'.$approval->entity_id;
                if (isset($seenApprovals[$key])) {
                    return;
                }
                $seenApprovals[$key] = true;
                DB::table('approval_requests')->where('id', $approval->id)->update(['active_key' => $key]);
            });

        Schema::table('orders', function (Blueprint $table) {
            $table->unique('payment_reference_key', 'orders_payment_reference_key_unique');
        });
        Schema::table('approval_requests', function (Blueprint $table) {
            $table->unique('active_key', 'approval_requests_active_key_unique');
        });
    }

    public function down(): void
    {
        Schema::table('approval_requests', function (Blueprint $table) {
            $table->dropUnique('approval_requests_active_key_unique');
            $table->dropColumn('active_key');
        });
        Schema::table('orders', function (Blueprint $table) {
            $table->dropUnique('orders_payment_reference_key_unique');
            $table->dropColumn('payment_reference_key');
        });
    }
};
