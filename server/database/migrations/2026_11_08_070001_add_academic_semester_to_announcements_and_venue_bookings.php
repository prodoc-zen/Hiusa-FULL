<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private const TABLES = ['announcements', 'venue_bookings'];

    public function up(): void
    {
        foreach (self::TABLES as $name) {
            Schema::table($name, function (Blueprint $table) {
                $table->foreignId('academic_semester_id')->nullable()->constrained('academic_semesters')->nullOnDelete();
            });

            $inRange = '(select id from academic_semesters where date(starts_on) <= date('.$name.'.created_at) and date(ends_on) >= date('.$name.'.created_at) order by id limit 1)';
            DB::table($name)->update(['academic_semester_id' => DB::raw($inRange)]);
            $active = DB::table('academic_semesters')->where('status', 'active')->value('id');
            if ($active) {
                DB::table($name)->whereNull('academic_semester_id')->update(['academic_semester_id' => $active]);
            }
        }

        DB::table('venue_bookings')->whereNotNull('event_id')
            ->update(['academic_semester_id' => DB::raw('coalesce((select academic_semester_id from events where events.id = venue_bookings.event_id), venue_bookings.academic_semester_id)')]);
    }

    public function down(): void
    {
        foreach (self::TABLES as $name) {
            Schema::table($name, function (Blueprint $table) {
                $table->dropConstrainedForeignId('academic_semester_id');
            });
        }
    }
};
