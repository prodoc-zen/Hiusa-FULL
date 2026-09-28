<?php

use App\Services\BudgetSubmissionStatusBackfiller;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('budgets', function (Blueprint $table) {
            $table->string('submission_status', 40)->default('pending_department_head')->after('overspending_risk');
            $table->unsignedInteger('department_head_approved_by')->nullable()->after('submission_status');
            $table->timestamp('department_head_approved_at')->nullable()->after('department_head_approved_by');

            $table->foreign('department_head_approved_by')->references('school_id')->on('users')->nullOnDelete();
        });

        // Budgets created before this migration only ever went through one
        // approval stage. Without this, every existing row silently becomes
        // pending_department_head (the column default) regardless of whether
        // it was already approved, letting an already-approved legacy budget
        // be raised without re-approval and blocking a legitimately rejected
        // one from showing as such.
        BudgetSubmissionStatusBackfiller::run();
    }

    public function down(): void
    {
        Schema::table('budgets', function (Blueprint $table) {
            $table->dropForeign(['department_head_approved_by']);
            $table->dropColumn(['submission_status', 'department_head_approved_by', 'department_head_approved_at']);
        });
    }
};
