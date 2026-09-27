<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('clearances', function (Blueprint $table) {
            $table->id();
            $table->string('academic_year', 20);
            $table->string('semester', 20);
            $table->string('title', 255);
            $table->text('description')->nullable();
            $table->dateTime('deadline')->nullable();
            $table->timestamps();
        });

        Schema::create('clearance_signatures', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clearance_id')->constrained('clearances')->cascadeOnDelete();
            $table->unsignedInteger('officer_id');
            $table->foreignId('organization_id')->constrained('organizations')->cascadeOnDelete();
            $table->string('status', 20)->default('Pending'); // Pending, Cleared, Denied
            $table->text('remarks')->nullable();
            $table->unsignedInteger('cleared_by')->nullable();
            $table->dateTime('cleared_at')->nullable();
            $table->timestamps();

            $table->foreign('officer_id')->references('school_id')->on('users')->cascadeOnDelete();
            $table->foreign('cleared_by')->references('school_id')->on('users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('clearance_signatures');
        Schema::dropIfExists('clearances');
    }
};
