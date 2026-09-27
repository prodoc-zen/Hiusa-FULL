<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('venues', function (Blueprint $table) {
            $table->id();
            $table->string('name', 255);
            $table->integer('capacity')->default(0);
            $table->text('description')->nullable();
            $table->string('status', 20)->default('Available'); // Available, Maintenance
            $table->timestamps();
        });

        Schema::create('venue_bookings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('venue_id')->constrained('venues')->cascadeOnDelete();
            $table->foreignId('event_id')->nullable()->constrained('events')->cascadeOnDelete();
            $table->foreignId('organization_id')->constrained('organizations')->cascadeOnDelete();
            $table->dateTime('start_time');
            $table->dateTime('end_time');
            $table->string('status', 20)->default('Pending'); // Pending, Approved, Rejected
            $table->unsignedInteger('requested_by');
            $table->unsignedInteger('approved_by')->nullable();
            $table->timestamps();

            $table->foreign('requested_by')->references('school_id')->on('users')->cascadeOnDelete();
            $table->foreign('approved_by')->references('school_id')->on('users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('venue_bookings');
        Schema::dropIfExists('venues');
    }
};
