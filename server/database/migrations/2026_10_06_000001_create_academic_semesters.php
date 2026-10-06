<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('academic_semesters', function (Blueprint $table) {
            $table->id();
            $table->foreignId('academic_year_id')->constrained()->restrictOnDelete();
            $table->unsignedTinyInteger('number');
            $table->date('starts_on');
            $table->date('ends_on');
            $table->string('status', 20)->default('upcoming');
            $table->unsignedInteger('created_by')->nullable();
            $table->timestamps();
            $table->unique(['academic_year_id', 'number']);
            $table->index('status');
            $table->foreign('created_by')->references('school_id')->on('users')->nullOnDelete();
        });

        Schema::table('events', function (Blueprint $table) {
            $table->foreignId('academic_semester_id')->nullable()->constrained('academic_semesters')->restrictOnDelete();
            $table->index(['organization_id', 'academic_semester_id']);
        });
    }

    public function down(): void
    {
        Schema::table('events', function (Blueprint $table) {
            $table->dropIndex(['organization_id', 'academic_semester_id']);
            $table->dropConstrainedForeignId('academic_semester_id');
        });
        Schema::dropIfExists('academic_semesters');
    }
};
