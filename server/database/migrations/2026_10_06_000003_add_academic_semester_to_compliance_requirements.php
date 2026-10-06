<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private const INDEX = 'compliance_req_semester_active_idx';

    private function hasSemesterForeignKey(): bool
    {
        foreach (Schema::getForeignKeys('compliance_requirement_types') as $foreignKey) {
            if (in_array('academic_semester_id', $foreignKey['columns'] ?? [], true)) {
                return true;
            }
        }

        return false;
    }

    public function up(): void
    {
        if (! Schema::hasColumn('compliance_requirement_types', 'academic_semester_id')) {
            Schema::table('compliance_requirement_types', function (Blueprint $table) {
                $table->foreignId('academic_semester_id')->nullable();
            });
        }

        if (! $this->hasSemesterForeignKey()) {
            Schema::table('compliance_requirement_types', function (Blueprint $table) {
                $table->foreign('academic_semester_id')->references('id')->on('academic_semesters')->restrictOnDelete();
            });
        }

        if (! Schema::hasIndex('compliance_requirement_types', self::INDEX)) {
            Schema::table('compliance_requirement_types', function (Blueprint $table) {
                $table->index(['academic_semester_id', 'is_active'], self::INDEX);
            });
        }
    }

    public function down(): void
    {
        if ($this->hasSemesterForeignKey()) {
            Schema::table('compliance_requirement_types', function (Blueprint $table) {
                $table->dropForeign(['academic_semester_id']);
            });
        }

        if (Schema::hasIndex('compliance_requirement_types', self::INDEX)) {
            Schema::table('compliance_requirement_types', function (Blueprint $table) {
                $table->dropIndex(self::INDEX);
            });
        }

        if (Schema::hasColumn('compliance_requirement_types', 'academic_semester_id')) {
            Schema::table('compliance_requirement_types', function (Blueprint $table) {
                $table->dropColumn('academic_semester_id');
            });
        }
    }
};
