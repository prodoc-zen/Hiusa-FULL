<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('compliance_requirement_types', function (Blueprint $table) {
            $table->foreignId('academic_semester_id')->nullable()->constrained('academic_semesters')->restrictOnDelete();
            $table->index(['academic_semester_id', 'is_active']);
        });
    }

    public function down(): void
    {
        Schema::table('compliance_requirement_types', function (Blueprint $table) {
            $table->dropIndex(['academic_semester_id', 'is_active']);
            $table->dropConstrainedForeignId('academic_semester_id');
        });
    }
};
