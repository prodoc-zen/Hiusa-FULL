<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A year label may be added again once the year that held it is archived, so the label is no longer unique in
     * the table (the controller keeps at most one live year per label). Clearance periods carried only the label, so
     * they now also carry the year they were opened for; every existing label is unique, so the backfill is exact.
     */
    public function up(): void
    {
        Schema::table('academic_years', function (Blueprint $table) {
            $table->dropUnique('academic_years_label_unique');
            $table->index('label');
        });

        Schema::table('clearance_periods', function (Blueprint $table) {
            $table->unsignedBigInteger('academic_year_id')->nullable()->index();
        });
        DB::table('clearance_periods')->orderBy('id')->get(['id', 'academic_year'])->each(function ($period) {
            $yearId = DB::table('academic_years')->where('label', $period->academic_year)->value('id');
            if ($yearId) {
                DB::table('clearance_periods')->where('id', $period->id)->update(['academic_year_id' => $yearId]);
            }
        });
    }

    public function down(): void
    {
        Schema::table('clearance_periods', fn (Blueprint $table) => $table->dropIndex(['academic_year_id']));
        Schema::table('clearance_periods', fn (Blueprint $table) => $table->dropColumn('academic_year_id'));
        Schema::table('academic_years', function (Blueprint $table) {
            $table->dropIndex(['label']);
            $table->unique('label');
        });
    }
};
