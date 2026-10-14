<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('file_storage_settings', function (Blueprint $table) {
            $table->unsignedTinyInteger('id')->primary();
            $table->unsignedSmallInteger('max_file_mb')->default(10);
            $table->unsignedSmallInteger('max_organization_mb')->default(200);
            $table->timestamps();
        });
        DB::table('file_storage_settings')->insert([
            'id' => 1, 'max_file_mb' => 10, 'max_organization_mb' => 200,
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    public function down(): void
    {
        Schema::dropIfExists('file_storage_settings');
    }
};
