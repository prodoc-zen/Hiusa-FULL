<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('event_requirements', function (Blueprint $table) {
            $table->string('description', 500)->nullable();
            $table->unsignedInteger('sort_order')->default(0);
        });
    }

    public function down(): void
    {
        Schema::table('event_requirements', function (Blueprint $table) {
            $table->dropColumn(['description', 'sort_order']);
        });
    }
};
