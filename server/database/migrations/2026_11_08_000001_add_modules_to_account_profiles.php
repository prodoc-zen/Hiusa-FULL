<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('account_profiles', function (Blueprint $table) {
            $table->json('modules')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('account_profiles', function (Blueprint $table) {
            $table->dropColumn('modules');
        });
    }
};
