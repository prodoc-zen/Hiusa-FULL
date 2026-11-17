<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('account_profiles', function (Blueprint $table) {
            // An organization head seat that oversees only: the person sees the records and changes none of them.
            $table->boolean('view_only')->default(false);
        });
    }

    public function down(): void
    {
        Schema::table('account_profiles', function (Blueprint $table) {
            $table->dropColumn('view_only');
        });
    }
};
