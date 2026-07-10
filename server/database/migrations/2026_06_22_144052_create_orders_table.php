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
        Schema::create('orders', function (Blueprint $table) {
            $table->id();
            $table->unsignedInteger('student_id');
            $table->foreignId('merchandise_id')->constrained('merchandise')->cascadeOnDelete();
            $table->integer('quantity')->default(1);
            $table->decimal('total_price', 10, 2);
            $table->enum('status', ['pending', 'paid', 'claimed', 'cancelled'])->default('pending');
            $table->string('claim_token', 50)->unique();
            $table->unsignedInteger('processed_by')->nullable();
            $table->unsignedInteger('approved_by')->nullable();
            $table->dateTime('claimed_at')->nullable();
            $table->timestamps();

            $table->foreign('student_id')->references('school_id')->on('users')->cascadeOnDelete();
            $table->foreign('processed_by')->references('school_id')->on('users')->nullOnDelete();
            $table->foreign('approved_by')->references('school_id')->on('users')->nullOnDelete();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('orders');
    }
};
