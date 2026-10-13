<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('organization_applications', function (Blueprint $table) {
            $table->id();
            $table->foreignId('college_id')->constrained()->restrictOnDelete();
            $table->string('name');
            $table->string('acronym', 50);
            $table->text('description')->nullable();
            $table->unsignedInteger('school_id');
            $table->string('first_name', 60);
            $table->string('last_name', 60);
            $table->string('email');
            $table->string('position_title', 100);
            $table->string('status', 30)->default('pending_verification')->index();
            $table->timestamp('email_verified_at')->nullable();
            $table->unsignedInteger('endorsed_by')->nullable();
            $table->foreign('endorsed_by')->references('school_id')->on('users')->nullOnDelete();
            $table->timestamp('endorsed_at')->nullable();
            $table->unsignedInteger('reviewed_by')->nullable();
            $table->foreign('reviewed_by')->references('school_id')->on('users')->nullOnDelete();
            $table->timestamp('reviewed_at')->nullable();
            $table->text('remarks')->nullable();
            $table->foreignId('organization_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('organization_applications');
    }
};
