<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('event_requirements', function (Blueprint $table) {
            $table->id();
            $table->string('name', 150);
            $table->json('allowed_extensions');
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('event_requirement_files', function (Blueprint $table) {
            $table->id();
            $table->foreignId('event_id')->constrained()->cascadeOnDelete();
            $table->foreignId('requirement_id')->constrained('event_requirements')->restrictOnDelete();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('path');
            $table->string('original_name');
            $table->unsignedInteger('uploaded_by');
            $table->timestamps();
            $table->foreign('uploaded_by')->references('school_id')->on('users')->restrictOnDelete();
            $table->unique(['event_id', 'requirement_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('event_requirement_files');
        Schema::dropIfExists('event_requirements');
    }
};
