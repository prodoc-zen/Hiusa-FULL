<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * status is kept as a plain string (not a DB-level enum), same portable
     * approach as the role model migration, so this works on both MySQL
     * (dev) and SQLite (tests) without a driver-specific ALTER MODIFY.
     */
    public function up(): void
    {
        Schema::table('elections', function (Blueprint $table) {
            $table->string('status_new', 20)->default('pending_approval')->after('status');
        });

        DB::table('elections')->update(['status_new' => DB::raw('status')]);

        Schema::table('elections', function (Blueprint $table) {
            $table->dropColumn('status');
        });

        Schema::table('elections', function (Blueprint $table) {
            $table->renameColumn('status_new', 'status');
        });
    }

    public function down(): void
    {
        Schema::table('elections', function (Blueprint $table) {
            $table->string('status_old', 20)->default('upcoming')->after('status');
        });

        DB::table('elections')->where('status', 'pending_approval')->update(['status_old' => 'upcoming']);
        DB::table('elections')->whereIn('status', ['upcoming', 'active', 'closed'])->update(['status_old' => DB::raw('status')]);

        Schema::table('elections', function (Blueprint $table) {
            $table->dropColumn('status');
        });

        Schema::table('elections', function (Blueprint $table) {
            $table->renameColumn('status_old', 'status');
        });
    }
};
