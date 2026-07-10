<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private array $tables = [
        'users',
        'announcements',
        'events',
        'tasks',
        'budgets',
        'transactions',
        'financial_forecasts',
        'merchandise',
        'orders',
        'elections',
        'partylists',
        'notifications',
    ];

    public function up(): void
    {
        foreach ($this->tables as $tableName) {
            Schema::table($tableName, function (Blueprint $table) use ($tableName) {
                $column = $table->foreignId('organization_id');

                if ($tableName === 'users') {
                    $column = $column->nullable(false);
                } else {
                    $column = $column->nullable()->after('id');
                }

                if ($tableName !== 'users') {
                    $column->constrained('organizations')->nullOnDelete();
                } else {
                    $column->constrained('organizations')->restrictOnDelete();
                }

                $table->index('organization_id', $tableName . '_organization_id_index');
            });
        }

        Schema::table('users', function (Blueprint $table) {
            $table->dropUnique('users_email_unique');
            $table->unique(['organization_id', 'email'], 'users_organization_email_unique');
        });

        Schema::table('partylists', function (Blueprint $table) {
            $table->dropUnique('partylists_name_unique');
            $table->unique(['organization_id', 'name'], 'partylists_organization_name_unique');
        });
    }

    public function down(): void
    {
        Schema::table('partylists', function (Blueprint $table) {
            if (Schema::hasIndex('partylists', 'partylists_organization_name_unique')) {
                $table->dropUnique('partylists_organization_name_unique');
            }
        });

        Schema::table('users', function (Blueprint $table) {
            if (Schema::hasIndex('users', 'users_organization_email_unique')) {
                $table->dropUnique('users_organization_email_unique');
            }

            if (!Schema::hasIndex('users', 'users_email_unique')) {
                $table->unique('email', 'users_email_unique');
            }
        });

        foreach (array_reverse($this->tables) as $tableName) {
            Schema::table($tableName, function (Blueprint $table) use ($tableName) {
                if (Schema::hasColumn($tableName, 'organization_id')) {
                    $table->dropForeign(['organization_id']);
                    $table->dropIndex($tableName . '_organization_id_index');
                    $table->dropColumn('organization_id');
                }
            });
        }
    }
};
