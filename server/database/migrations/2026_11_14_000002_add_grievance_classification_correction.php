<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('grievances', function (Blueprint $table) {
            $table->string('machine_urgency', 20)->nullable()->after('classification_engine');
            $table->string('machine_category', 100)->nullable()->after('machine_urgency');
            $table->unsignedInteger('classification_corrected_by')->nullable()->after('machine_category');
            $table->dateTime('classification_corrected_at')->nullable()->after('classification_corrected_by');
        });
    }

    public function down(): void
    {
        Schema::table('grievances', fn (Blueprint $table) => $table->dropColumn(['machine_urgency', 'machine_category', 'classification_corrected_by', 'classification_corrected_at']));
    }
};
