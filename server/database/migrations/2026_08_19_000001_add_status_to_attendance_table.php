<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('attendance', function (Blueprint $table) {
            if (! Schema::hasColumn('attendance', 'status')) {
                $table->string('status', 20)->default('present')->after('method');
                $table->index(['event_id', 'status'], 'attendance_event_status_index');
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasColumn('attendance', 'status')) {
            return;
        }

        Schema::table('attendance', function (Blueprint $table) {
            $table->dropIndex('attendance_event_status_index');
            $table->dropColumn('status');
        });
    }
};
