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
        Schema::create('transactions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('budget_id')->nullable()->constrained('budgets')->nullOnDelete();
            $table->unsignedInteger('recorded_by');
            $table->enum('type', ['income', 'expense']);
            $table->string('category', 100);
            $table->decimal('amount', 10, 2);
            $table->text('description');
            $table->string('receipt_reference', 100)->nullable()->unique();
            $table->dateTime('transaction_date')->useCurrent();
            $table->timestamps();

            $table->foreign('recorded_by')->references('school_id')->on('users')->restrictOnDelete();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('transactions');
    }
};
