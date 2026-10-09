<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('elections', function (Blueprint $table) {
            $table->timestamp('finalized_at')->nullable();
        });

        DB::table('elections')
            ->whereIn('status', ['active', 'closed'])
            ->whereNotNull('approved_at')
            ->update(['finalized_at' => DB::raw('approved_at')]);
    }

    public function down(): void
    {
        Schema::table('elections', function (Blueprint $table) {
            $table->dropColumn('finalized_at');
        });
    }
};
