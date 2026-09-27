<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('organizations', function (Blueprint $table) {
            $table->string('accreditation_status', 20)->default('Active')->after('gcash_qr_url');
            $table->dateTime('accredited_at')->nullable()->after('accreditation_status');
            $table->dateTime('expires_at')->nullable()->after('accredited_at');
        });
    }

    public function down(): void
    {
        Schema::table('organizations', function (Blueprint $table) {
            $table->dropColumn(['accreditation_status', 'accredited_at', 'expires_at']);
        });
    }
};
