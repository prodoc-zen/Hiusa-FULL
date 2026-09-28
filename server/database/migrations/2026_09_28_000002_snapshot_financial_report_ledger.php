<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('financial_reports', function (Blueprint $table) {
            $table->decimal('opening_balance_snapshot', 14, 2)->nullable();
            $table->json('transactions_snapshot')->nullable();
            $table->json('custody_snapshot')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('financial_reports', function (Blueprint $table) {
            $table->dropColumn(['opening_balance_snapshot', 'transactions_snapshot', 'custody_snapshot']);
        });
    }
};
