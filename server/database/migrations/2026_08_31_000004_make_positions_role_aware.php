<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // InnoDB requires organization_id to remain the leading column of an
        // index while the legacy unique index is replaced. A standalone index
        // keeps the foreign key valid throughout the migration and rollback.
        Schema::table('sbo_positions', function (Blueprint $table) {
            $table->index('organization_id', 'sbo_positions_organization_id_index');
        });
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

        Schema::table('sbo_positions', function (Blueprint $table) {
            $table->dropIndex('sbo_positions_organization_id_index');
        });
    }
};
