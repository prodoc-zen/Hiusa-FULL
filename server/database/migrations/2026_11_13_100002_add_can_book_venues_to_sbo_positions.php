<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sbo_positions', function (Blueprint $table) {
            $table->boolean('can_book_venues')->default(false)->after('is_active');
        });

        // The positions that book venues today keep doing so; Assistant Secretary and the rest start off.
        DB::table('sbo_positions')
            ->where(fn ($query) => $query
                ->whereIn(DB::raw('LOWER(TRIM(title))'), ['president', 'secretary', 'business manager'])
                ->orWhere(DB::raw('LOWER(TRIM(title))'), 'like', 'vice president%'))
            ->update(['can_book_venues' => true]);
    }

    public function down(): void
    {
        Schema::table('sbo_positions', function (Blueprint $table) {
            $table->dropColumn('can_book_venues');
        });
    }
};
