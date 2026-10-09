<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private const INDEXES = [
        'audit_logs_organization_id_created_at_index' => ['organization_id', 'created_at'],
        'audit_logs_user_id_created_at_index' => ['user_id', 'created_at'],
    ];

    public function up(): void
    {
        foreach (self::INDEXES as $name => $columns) {
            if (Schema::hasIndex('audit_logs', $name)) {
                continue;
            }

            Schema::table('audit_logs', function (Blueprint $table) use ($name, $columns) {
                $table->index($columns, $name);
            });
        }
    }

    public function down(): void
    {
        foreach (self::INDEXES as $name => $columns) {
            if (! Schema::hasIndex('audit_logs', $name)) {
                continue;
            }

            $leading = $columns[0];

            if (! Schema::hasIndex('audit_logs', [$leading])) {
                Schema::table('audit_logs', function (Blueprint $table) use ($leading) {
                    $table->index($leading);
                });
            }

            Schema::table('audit_logs', function (Blueprint $table) use ($name) {
                $table->dropIndex($name);
            });
        }
    }
};
