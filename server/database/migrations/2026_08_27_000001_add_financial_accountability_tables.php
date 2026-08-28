<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('department', 120)->nullable();
            $table->string('program', 120)->nullable();
            $table->string('year_level', 30)->nullable();
        });
        Schema::create('collections', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('reference', 50)->unique();
            $table->decimal('expected_amount', 12, 2)->default(0);
            $table->decimal('amount_collected', 12, 2);
            $table->string('source', 100);
            $table->text('notes')->nullable();
            $table->foreignId('event_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('order_id')->nullable()->constrained()->nullOnDelete();
            $table->unsignedInteger('collected_by');
            $table->unsignedInteger('verified_by')->nullable();
            $table->timestamp('collected_at');
            $table->timestamp('verified_at')->nullable();
            $table->enum('status', ['pending', 'verified', 'rejected'])->default('pending');
            $table->foreignId('ledger_transaction_id')->nullable()->constrained('transactions')->nullOnDelete();
            $table->timestamps();
            $table->foreign('collected_by')->references('school_id')->on('users')->restrictOnDelete();
            $table->foreign('verified_by')->references('school_id')->on('users')->nullOnDelete();
        });
        Schema::create('remittances', function (Blueprint $table) {
            $table->id();
            $table->foreignId('collection_id')->constrained()->cascadeOnDelete();
            $table->string('reference', 50)->unique();
            $table->decimal('amount', 12, 2);
            $table->unsignedInteger('remitted_by');
            $table->unsignedInteger('verified_by')->nullable();
            $table->timestamp('remitted_at');
            $table->timestamp('verified_at')->nullable();
            $table->string('status', 20)->default('recorded');
            $table->text('notes')->nullable();
            $table->timestamps();
            $table->foreign('remitted_by')->references('school_id')->on('users')->restrictOnDelete();
            $table->foreign('verified_by')->references('school_id')->on('users')->nullOnDelete();
        });
        Schema::create('cash_advances', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('reference', 50)->unique();
            $table->unsignedInteger('borrower_id');
            $table->decimal('amount', 12, 2);
            $table->text('purpose');
            $table->foreignId('event_id')->nullable()->constrained()->nullOnDelete();
            $table->enum('status', ['pending', 'approved', 'released', 'partially_repaid', 'fully_repaid', 'rejected', 'cancelled'])->default('pending');
            $table->unsignedInteger('approved_by')->nullable();
            $table->timestamp('approved_at')->nullable();
            $table->unsignedInteger('released_by')->nullable();
            $table->timestamp('released_at')->nullable();
            $table->foreignId('release_transaction_id')->nullable()->constrained('transactions')->nullOnDelete();
            $table->text('notes')->nullable();
            $table->timestamps();
            $table->foreign('borrower_id')->references('school_id')->on('users')->restrictOnDelete();
            $table->foreign('approved_by')->references('school_id')->on('users')->nullOnDelete();
            $table->foreign('released_by')->references('school_id')->on('users')->nullOnDelete();
        });
        Schema::create('cash_advance_repayments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('cash_advance_id')->constrained()->cascadeOnDelete();
            $table->decimal('amount', 12, 2);
            $table->unsignedInteger('recorded_by');
            $table->timestamp('repaid_at');
            $table->text('notes')->nullable();
            $table->foreignId('ledger_transaction_id')->nullable()->constrained('transactions')->nullOnDelete();
            $table->timestamps();
            $table->foreign('recorded_by')->references('school_id')->on('users')->restrictOnDelete();
        });
        Schema::create('invoices', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('reference', 50)->unique();
            $table->unsignedInteger('student_id');
            $table->string('description');
            $table->decimal('amount_due', 12, 2);
            $table->date('due_date')->nullable();
            $table->foreignId('event_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('order_id')->nullable()->constrained()->nullOnDelete();
            $table->string('status', 20)->default('unpaid');
            $table->timestamps();
            $table->foreign('student_id')->references('school_id')->on('users')->restrictOnDelete();
        });
        Schema::create('invoice_payments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('invoice_id')->constrained()->cascadeOnDelete();
            $table->decimal('amount', 12, 2);
            $table->unsignedInteger('recorded_by');
            $table->string('status', 20)->default('pending');
            $table->foreignId('ledger_transaction_id')->nullable()->constrained('transactions')->nullOnDelete();
            $table->timestamps();
            $table->foreign('recorded_by')->references('school_id')->on('users')->restrictOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('invoice_payments');
        Schema::dropIfExists('invoices');
        Schema::dropIfExists('cash_advance_repayments');
        Schema::dropIfExists('cash_advances');
        Schema::dropIfExists('remittances');
        Schema::dropIfExists('collections');
        Schema::table('users', fn (Blueprint $t) => $t->dropColumn(['department', 'program', 'year_level']));
    }
};
