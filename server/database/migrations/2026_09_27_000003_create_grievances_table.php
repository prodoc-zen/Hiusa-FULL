<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('grievances', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->nullable()->constrained('organizations')->nullOnDelete();
            $table->unsignedInteger('submitted_by');
            $table->boolean('is_anonymous')->default(false);
            $table->string('title', 255);
            $table->text('description');
            $table->string('category', 100)->nullable();
            $table->string('urgency', 20)->nullable();
            $table->float('classification_confidence')->nullable();
            $table->text('classification_reasoning')->nullable();
            $table->string('classification_engine', 20)->nullable();
            $table->string('status', 20)->default('submitted'); // submitted, under_review, resolved, dismissed
            $table->text('remarks')->nullable();
            $table->dateTime('resolved_at')->nullable();
            $table->timestamps();

            $table->index(['organization_id', 'status'], 'grievances_organization_status_index');
            $table->foreign('submitted_by')->references('school_id')->on('users')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('grievances');
    }
};
