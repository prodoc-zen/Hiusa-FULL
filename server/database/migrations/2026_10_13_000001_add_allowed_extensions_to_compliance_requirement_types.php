<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('compliance_requirement_types', function (Blueprint $table) {
            $table->json('allowed_extensions')->nullable();
        });

        // Registration has historically accepted PDF; other compliance uploads accepted these formats.
        DB::table('compliance_requirement_types')->whereNotNull('academic_semester_id')
            ->where('name', '!=', 'Semestral Accomplishment Report')
            ->update(['allowed_extensions' => json_encode(['pdf'])]);
        DB::table('compliance_requirement_types')->whereNull('allowed_extensions')
            ->update(['allowed_extensions' => json_encode(['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx', 'xls', 'xlsx'])]);
    }

    public function down(): void
    {
        Schema::table('compliance_requirement_types', function (Blueprint $table) {
            $table->dropColumn('allowed_extensions');
        });
    }
};
