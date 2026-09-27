<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('compliance_requirement_types', function (Blueprint $table) {
            $table->id();
            $table->string('academic_year', 20);
            $table->string('name', 255);
            $table->text('description')->nullable();
            $table->dateTime('deadline_at');
            $table->boolean('is_active')->default(true);
            $table->unsignedInteger('created_by');
            $table->timestamps();

            $table->foreign('created_by')->references('school_id')->on('users')->cascadeOnDelete();
            $table->index(['academic_year', 'is_active'], 'compliance_requirement_types_year_active_index');
        });

        Schema::create('organization_compliance_submissions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained('organizations')->cascadeOnDelete();
            $table->foreignId('requirement_type_id')->constrained('compliance_requirement_types')->cascadeOnDelete();
            $table->string('status', 20)->default('submitted'); // submitted, approved, returned
            $table->string('file_path', 500);
            $table->string('file_original_name', 255);
            $table->string('mime_type', 100);
            $table->unsignedInteger('file_size');
            $table->text('remarks')->nullable();
            $table->unsignedInteger('submitted_by');
            $table->dateTime('submitted_at');
            $table->unsignedInteger('reviewed_by')->nullable();
            $table->dateTime('reviewed_at')->nullable();
            $table->timestamps();

            $table->unique(['organization_id', 'requirement_type_id'], 'org_compliance_submissions_org_requirement_unique');
            $table->foreign('submitted_by')->references('school_id')->on('users')->cascadeOnDelete();
            $table->foreign('reviewed_by')->references('school_id')->on('users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('organization_compliance_submissions');
        Schema::dropIfExists('compliance_requirement_types');
    }
};
