<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('clearance_periods', function (Blueprint $table) {
            $table->id();
            $table->string('academic_year', 20);
            $table->string('title', 255);
            $table->text('description')->nullable();
            $table->json('required_roles'); // e.g. ["organization_treasurer", "adviser", "sao"]
            $table->dateTime('deadline_at')->nullable();
            $table->unsignedInteger('created_by');
            $table->timestamps();

            $table->foreign('created_by')->references('school_id')->on('users')->cascadeOnDelete();
        });

        Schema::create('clearance_signatures', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clearance_period_id')->constrained('clearance_periods')->cascadeOnDelete();
            $table->unsignedInteger('student_id');
            $table->foreignId('organization_id')->constrained('organizations')->cascadeOnDelete();
            $table->string('required_role', 50);
            $table->string('status', 20)->default('pending'); // pending, cleared, held
            $table->text('remarks')->nullable();
            $table->unsignedInteger('signed_by')->nullable();
            $table->dateTime('signed_at')->nullable();
            $table->timestamps();

            $table->unique(['clearance_period_id', 'student_id', 'required_role'], 'clearance_signatures_unique_row');
            $table->index(['organization_id', 'required_role', 'status'], 'clearance_signatures_org_role_status_index');
            $table->foreign('student_id')->references('school_id')->on('users')->cascadeOnDelete();
            $table->foreign('signed_by')->references('school_id')->on('users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('clearance_signatures');
        Schema::dropIfExists('clearance_periods');
    }
};
