<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('student_registry', function (Blueprint $table) {
            $table->string('record_type', 20)->default('student')->after('school_id');
            $table->string('position', 100)->nullable()->after('year_level');
            $table->string('program', 120)->nullable()->change();
            $table->string('year_level', 30)->nullable()->change();
        });

        Schema::table('department_head_invitations', function (Blueprint $table) {
            $table->unsignedInteger('registry_school_id')->nullable()->after('school_id');
        });
    }

    public function down(): void
    {
        Schema::table('department_head_invitations', function (Blueprint $table) {
            $table->dropColumn('registry_school_id');
        });

        Schema::table('student_registry', function (Blueprint $table) {
            $table->dropColumn(['record_type', 'position']);
        });
    }
};
