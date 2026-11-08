<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('department_head_invitations', function (Blueprint $table) {
            $table->string('first_name', 60)->nullable()->change();
            $table->string('last_name', 60)->nullable()->change();
            $table->string('email', 100)->nullable()->change();
            $table->string('role', 30)->default('DEPARTMENT_HEAD')->after('college_id');
            $table->string('position_title', 100)->nullable()->after('role');
        });
    }

    public function down(): void
    {
        Schema::table('department_head_invitations', function (Blueprint $table) {
            $table->dropColumn(['role', 'position_title']);
        });
    }
};
