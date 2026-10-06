<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tasks', function (Blueprint $table) {
            $table->foreignId('academic_semester_id')->nullable()->constrained('academic_semesters')->restrictOnDelete();
            $table->index(['organization_id', 'academic_semester_id']);
        });
    }

    public function down(): void
    {
        Schema::table('tasks', function (Blueprint $table) {
            $table->dropIndex(['organization_id', 'academic_semester_id']);
            $table->dropConstrainedForeignId('academic_semester_id');
        });
    }
};
