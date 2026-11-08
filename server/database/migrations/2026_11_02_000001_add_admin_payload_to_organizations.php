<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('organizations', 'admin_payload')) {
            Schema::table('organizations', function (Blueprint $table) {
                $table->json('admin_payload')->nullable()->after('color');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('organizations', 'admin_payload')) {
            Schema::table('organizations', function (Blueprint $table) {
                $table->dropColumn('admin_payload');
            });
        }
    }
};
