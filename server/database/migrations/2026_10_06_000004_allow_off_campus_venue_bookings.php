<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('venue_bookings', function (Blueprint $table) {
            $table->foreignId('venue_id')->nullable()->change();
            $table->string('off_campus_location')->nullable();
        });
    }

    public function down(): void
    {
        foreach (DB::table('venue_bookings')->whereNull('venue_id')->get() as $booking) {
            $id = DB::table('venues')->insertGetId([
                'name' => 'Off-campus venue from booking #'.$booking->id,
                'location' => $booking->off_campus_location ?: 'Off campus',
                'capacity' => 0,
                'is_active' => false,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            DB::table('venue_bookings')->where('id', $booking->id)->update(['venue_id' => $id]);
        }
        Schema::table('venue_bookings', function (Blueprint $table) {
            $table->foreignId('venue_id')->nullable(false)->change();
            $table->dropColumn('off_campus_location');
        });
    }
};
