<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('financial_reports', function (Blueprint $table) {
            $table->string('document_type', 40)->default('financial_report')->after('report_type');
            $table->string('letterhead_path', 500)->nullable()->after('summary_text');
            $table->json('letter_details')->nullable()->after('letterhead_path');
            $table->index(['organization_id', 'document_type'], 'financial_reports_document_type_index');
        });
    }

    public function down(): void
    {
        Schema::table('financial_reports', function (Blueprint $table) {
            $table->dropIndex('financial_reports_document_type_index');
            $table->dropColumn(['document_type', 'letterhead_path', 'letter_details']);
        });
    }
};
