<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /** A link that adds someone to the SAO belongs to no college. Existing rows keep their college. */
    public function up(): void
    {
        Schema::table('department_head_invitations', function (Blueprint $table) {
            $table->unsignedBigInteger('college_id')->nullable()->change();
        });
    }

    public function down(): void
    {
        DB::table('department_head_invitations')->whereNull('college_id')->delete();

        Schema::table('department_head_invitations', function (Blueprint $table) {
            $table->unsignedBigInteger('college_id')->nullable(false)->change();
        });
    }
};
