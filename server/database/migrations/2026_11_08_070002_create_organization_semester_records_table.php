<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('organization_semester_records', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained('organizations')->cascadeOnDelete();
            $table->foreignId('academic_semester_id')->constrained('academic_semesters')->cascadeOnDelete();
            $table->string('lifecycle_status', 30);
            $table->json('officers');
            $table->timestamps();
            $table->unique(['organization_id', 'academic_semester_id'], 'org_semester_records_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('organization_semester_records');
    }
};
