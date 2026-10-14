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
            $table->string('category', 30)->default('organization')->index();
        });
        DB::table('compliance_requirement_types')->where('name', 'Semestral Accomplishment Report')->update(['category' => 'semestral_report']);
    }

    public function down(): void
    {
        Schema::table('compliance_requirement_types', function (Blueprint $table) {
            $table->dropIndex(['category']);
            $table->dropColumn('category');
        });
    }
};
