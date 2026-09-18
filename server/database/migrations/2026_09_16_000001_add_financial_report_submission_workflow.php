<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('financial_report_deadlines', function (Blueprint $table) {
            $table->id();
            $table->timestamp('deadline_at');
            $table->text('instructions')->nullable();
            $table->unsignedInteger('set_by')->nullable();
            $table->foreignId('announcement_id')->nullable()->constrained('announcements')->nullOnDelete();
            $table->timestamps();

            $table->foreign('set_by')->references('school_id')->on('users')->nullOnDelete();
            $table->index('deadline_at');
        });

        Schema::table('financial_reports', function (Blueprint $table) {
            $table->json('signatories')->nullable()->after('summary_text');
            $table->json('supporting_documents')->nullable()->after('source_transaction_ids');
            $table->string('submission_status', 40)->default('draft')->after('supporting_documents');
            $table->foreignId('deadline_id')->nullable()->after('submission_status')->constrained('financial_report_deadlines')->nullOnDelete();
            $table->timestamp('submitted_at')->nullable()->after('generated_at');
            $table->unsignedInteger('department_head_approved_by')->nullable()->after('submitted_at');
            $table->timestamp('department_head_approved_at')->nullable()->after('department_head_approved_by');
            $table->unsignedInteger('sao_approved_by')->nullable()->after('department_head_approved_at');
            $table->timestamp('sao_approved_at')->nullable()->after('sao_approved_by');

            $table->foreign('department_head_approved_by')->references('school_id')->on('users')->nullOnDelete();
            $table->foreign('sao_approved_by')->references('school_id')->on('users')->nullOnDelete();
            $table->index(['organization_id', 'submission_status'], 'financial_reports_submission_index');
        });
    }

    public function down(): void
    {
        Schema::table('financial_reports', function (Blueprint $table) {
            $table->dropIndex('financial_reports_submission_index');
            $table->dropForeign(['department_head_approved_by']);
            $table->dropForeign(['sao_approved_by']);
            $table->dropConstrainedForeignId('deadline_id');
            $table->dropColumn([
                'signatories', 'supporting_documents', 'submission_status', 'submitted_at',
                'department_head_approved_by', 'department_head_approved_at',
                'sao_approved_by', 'sao_approved_at',
            ]);
        });

        Schema::dropIfExists('financial_report_deadlines');
    }
};
