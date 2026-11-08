<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('organization_applicant_grants', function (Blueprint $table) {
            $table->id();
            $table->foreignId('college_id')->constrained('colleges')->cascadeOnDelete();
            $table->unsignedInteger('user_school_id');
            $table->foreign('user_school_id')->references('school_id')->on('users')->cascadeOnDelete();
            $table->unsignedInteger('granted_by')->nullable();
            $table->foreign('granted_by')->references('school_id')->on('users')->nullOnDelete();
            $table->unsignedBigInteger('used_application_id')->nullable();
            $table->foreign('used_application_id')->references('id')->on('organization_applications')->nullOnDelete();
            $table->timestamp('revoked_at')->nullable();
            $table->timestamps();
            $table->index(['college_id', 'user_school_id'], 'applicant_grants_college_user_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('organization_applicant_grants');
    }
};
