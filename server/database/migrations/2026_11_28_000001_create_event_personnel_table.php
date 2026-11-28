<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('event_personnel', function (Blueprint $table) {
            $table->id();
            $table->foreignId('event_id')->constrained('events')->cascadeOnDelete();
            $table->unsignedInteger('user_school_id');
            $table->string('role_label', 80);
            $table->unsignedInteger('assigned_by')->nullable();
            $table->timestamps();

            $table->unique(['event_id', 'user_school_id']);
            $table->foreign('user_school_id')->references('school_id')->on('users')->cascadeOnDelete();
            $table->foreign('assigned_by')->references('school_id')->on('users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('event_personnel');
    }
};
