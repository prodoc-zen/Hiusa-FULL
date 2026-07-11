<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * role/target_role are kept as plain strings (not a DB-level enum) so this
     * migration ports cleanly between MySQL (local/dev) and SQLite (test suite)
     * without driver-specific ALTER MODIFY statements. Allowed values are
     * already enforced at the application layer via validation rules.
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('position_title', 100)->nullable()->after('role');
            $table->string('role_new', 20)->default('STUDENT')->after('role');
        });

        DB::table('users')->where('role', 'adviser')->update(['role_new' => 'ADMIN', 'position_title' => 'Adviser']);
        DB::table('users')->where('role', 'officer')->update(['role_new' => 'SBO_OFFICER']);
        DB::table('users')->where('role', 'admin')->update(['role_new' => 'ADMIN']);
        DB::table('users')->where('role', 'student')->update(['role_new' => 'STUDENT']);

        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('role');
        });

        Schema::table('users', function (Blueprint $table) {
            $table->renameColumn('role_new', 'role');
        });

        Schema::table('announcements', function (Blueprint $table) {
            $table->string('target_role_new', 20)->default('all')->after('target_role');
        });

        DB::table('announcements')->where('target_role', 'adviser')->update(['target_role_new' => 'ADMIN']);
        DB::table('announcements')->where('target_role', 'officer')->update(['target_role_new' => 'SBO_OFFICER']);
        DB::table('announcements')->where('target_role', 'admin')->update(['target_role_new' => 'ADMIN']);
        DB::table('announcements')->where('target_role', 'student')->update(['target_role_new' => 'STUDENT']);
        DB::table('announcements')->where('target_role', 'all')->update(['target_role_new' => 'all']);

        Schema::table('announcements', function (Blueprint $table) {
            $table->dropIndex('announcements_published_role_index');
            $table->dropColumn('target_role');
        });

        Schema::table('announcements', function (Blueprint $table) {
            $table->renameColumn('target_role_new', 'target_role');
        });

        Schema::table('announcements', function (Blueprint $table) {
            $table->index(['is_published', 'target_role'], 'announcements_published_role_index');
        });
    }

    /**
     * Lossy: former-adviser users were merged into 'ADMIN' with
     * position_title = 'Adviser' in up(), so down() cannot tell them apart
     * from originally-seeded admins — both map back to 'admin'. Any
     * 'DEPARTMENT_HEAD' users created after this migration have no
     * equivalent in the old 4-role model and also become 'admin'.
     */
    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('role_old', 20)->default('student')->after('role');
        });

        DB::table('users')->where('role', 'STUDENT')->update(['role_old' => 'student']);
        DB::table('users')->where('role', 'SBO_OFFICER')->update(['role_old' => 'officer']);
        DB::table('users')->whereIn('role', ['ADMIN', 'DEPARTMENT_HEAD'])->update(['role_old' => 'admin']);

        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['role', 'position_title']);
        });

        Schema::table('users', function (Blueprint $table) {
            $table->renameColumn('role_old', 'role');
        });

        Schema::table('announcements', function (Blueprint $table) {
            $table->string('target_role_old', 20)->default('all')->after('target_role');
        });

        DB::table('announcements')->where('target_role', 'STUDENT')->update(['target_role_old' => 'student']);
        DB::table('announcements')->where('target_role', 'SBO_OFFICER')->update(['target_role_old' => 'officer']);
        DB::table('announcements')->whereIn('target_role', ['ADMIN', 'DEPARTMENT_HEAD'])->update(['target_role_old' => 'adviser']);
        DB::table('announcements')->where('target_role', 'all')->update(['target_role_old' => 'all']);

        Schema::table('announcements', function (Blueprint $table) {
            $table->dropIndex('announcements_published_role_index');
            $table->dropColumn('target_role');
        });

        Schema::table('announcements', function (Blueprint $table) {
            $table->renameColumn('target_role_old', 'target_role');
        });

        Schema::table('announcements', function (Blueprint $table) {
            $table->index(['is_published', 'target_role'], 'announcements_published_role_index');
        });
    }
};
