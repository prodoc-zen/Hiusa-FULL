<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('users', 'account_status')) {
            Schema::table('users', function (Blueprint $table) {
                $table->string('account_status', 20)->default('active')->after('is_member');
                $table->index('account_status', 'users_account_status_index');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('users', 'account_status')) {
            Schema::table('users', function (Blueprint $table) {
                $table->dropIndex('users_account_status_index');
                $table->dropColumn('account_status');
            });
        }
    }
};
