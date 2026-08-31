<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('academic_programs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('name', 120);
            $table->timestamps();
            $table->unique(['organization_id', 'name']);
        });

        Schema::create('academic_sections', function (Blueprint $table) {
            $table->id();
            $table->foreignId('academic_program_id')->constrained()->cascadeOnDelete();
            $table->unsignedTinyInteger('year_level');
            $table->string('name', 60);
            $table->timestamps();
            $table->unique(['academic_program_id', 'year_level', 'name']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('academic_sections');
        Schema::dropIfExists('academic_programs');
    }
};
