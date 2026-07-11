<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('approval_requests', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained('organizations')->cascadeOnDelete();
            $table->enum('entity_type', ['event', 'budget', 'election']);
            $table->unsignedBigInteger('entity_id');
            $table->string('title');
            $table->text('summary')->nullable();
            $table->unsignedInteger('requested_by');
            $table->enum('status', ['pending', 'approved', 'rejected'])->default('pending');
            $table->unsignedInteger('reviewed_by')->nullable();
            $table->text('remarks')->nullable();
            $table->timestamp('requested_at')->useCurrent();
            $table->dateTime('reviewed_at')->nullable();
            $table->timestamps();

            $table->unique(['entity_type', 'entity_id']);
            $table->foreign('requested_by')->references('school_id')->on('users')->cascadeOnDelete();
            $table->foreign('reviewed_by')->references('school_id')->on('users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('approval_requests');
    }
};
