<?php

use App\Models\SboPosition;
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
        $ids = DB::table('sbo_positions')->select('id', 'title')->get()
            ->filter(fn ($position) => SboPosition::bookingDefaultFor((string) $position->title))
            ->pluck('id');
        foreach ($ids->chunk(500) as $chunk) {
            DB::table('sbo_positions')->whereIn('id', $chunk->all())->update(['can_book_venues' => true]);
        }
    }

    public function down(): void
    {
        Schema::table('sbo_positions', function (Blueprint $table) {
            $table->dropColumn('can_book_venues');
        });
    }
};
