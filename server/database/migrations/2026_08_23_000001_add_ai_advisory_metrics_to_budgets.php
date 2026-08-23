<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('budgets', function (Blueprint $table) {
            $table->decimal('recommended_allocation', 12, 2)->nullable()->after('overspending_risk');
            $table->decimal('safe_spending_limit', 12, 2)->nullable()->after('recommended_allocation');
            $table->timestamp('advice_generated_at')->nullable()->after('safe_spending_limit');
        });
    }

    public function down(): void
    {
        Schema::table('budgets', function (Blueprint $table) {
            $table->dropColumn(['recommended_allocation', 'safe_spending_limit', 'advice_generated_at']);
        });
    }
};
