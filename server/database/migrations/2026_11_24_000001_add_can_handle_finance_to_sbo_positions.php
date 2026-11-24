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
            $table->boolean('can_handle_finance')->default(false)->after('can_book_venues');
        });

        // The Treasurer, the Auditor and the Business Manager start with the switch on; every other position starts off.
        $ids = DB::table('sbo_positions')->select('id', 'title')->get()
            ->filter(fn ($position) => SboPosition::financeDefaultFor((string) $position->title))
            ->pluck('id');
        foreach ($ids->chunk(500) as $chunk) {
            DB::table('sbo_positions')->whereIn('id', $chunk->all())->update(['can_handle_finance' => true]);
        }
    }

    public function down(): void
    {
        Schema::table('sbo_positions', function (Blueprint $table) {
            $table->dropColumn('can_handle_finance');
        });
    }
};
