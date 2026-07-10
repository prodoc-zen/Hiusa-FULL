<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('tasks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('event_id')->nullable()->constrained('events')->cascadeOnDelete();
            $table->unsignedInteger('created_by');
            $table->string('title');
            $table->text('description')->nullable();
            $table->unsignedInteger('assigned_to')->nullable();
            $table->enum('status', ['pending', 'in_progress', 'completed', 'overdue'])->default('pending');
            $table->dateTime('deadline');
            $table->text('ai_recommendation_note')->nullable();
            $table->timestamps();

            $table->foreign('created_by')->references('school_id')->on('users')->cascadeOnDelete();
            $table->foreign('assigned_to')->references('school_id')->on('users')->nullOnDelete();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('tasks');
    }
};
