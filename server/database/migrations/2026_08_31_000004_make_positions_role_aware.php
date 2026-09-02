<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // InnoDB requires the organization_id foreign key to be backed by an index whose
        // leading column is organization_id. The legacy unique index was the only one, so
        // dropping it first fails on MySQL/MariaDB with error 1553. Create the replacement
        // (which also leads with organization_id) before dropping the old one. SQLite does
        // not enforce this, which is why the test suite could not catch it.
        Schema::table('sbo_positions', function (Blueprint $table) {
            $table->string('role', 30)->default('SBO_OFFICER')->after('organization_id');
            $table->unique(['organization_id', 'role', 'title'], 'positions_organization_role_title_unique');
        });

        Schema::table('sbo_positions', function (Blueprint $table) {
            $table->dropUnique(['organization_id', 'title']);
        });

        $now = now();
        $rows = DB::table('organizations')->pluck('id')->flatMap(fn ($organizationId) => collect([
            'President',
            'Vice President',
            'Secretary',
        ])->map(fn ($title) => [
            'organization_id' => $organizationId,
            'role' => 'ADMIN',
            'title' => $title,
            'description' => null,
            'is_active' => true,
            'created_at' => $now,
            'updated_at' => $now,
        ]))->all();

        if ($rows !== []) {
            DB::table('sbo_positions')->insertOrIgnore($rows);
        }
    }

    public function down(): void
    {
        // The legacy schema cannot represent the same title for both roles.
        DB::table('sbo_positions')->where('role', 'ADMIN')->delete();

        // Same constraint in reverse: restore the legacy index before dropping the one
        // that currently backs the foreign key.
        Schema::table('sbo_positions', function (Blueprint $table) {
            $table->unique(['organization_id', 'title']);
        });

        Schema::table('sbo_positions', function (Blueprint $table) {
            $table->dropUnique('positions_organization_role_title_unique');
            $table->dropColumn('role');
        });
    }
};
