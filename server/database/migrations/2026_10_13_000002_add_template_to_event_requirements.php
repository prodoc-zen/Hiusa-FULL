<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('event_requirements', function (Blueprint $table) {
            $table->string('template_path', 500)->nullable();
            $table->string('template_original_name', 255)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('event_requirements', function (Blueprint $table) {
            $table->dropColumn(['template_path', 'template_original_name']);
        });
    }
};
