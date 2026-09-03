<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('ai_outputs', function (Blueprint $table) {
            $table->string('context_version', 40)->default('v1')->after('model_name');
            $table->json('structured_input')->nullable()->after('context_version');
            $table->json('structured_output')->nullable()->after('structured_input');
            $table->string('status', 20)->default('completed')->after('structured_output');
            $table->text('error_message')->nullable()->after('status');
            $table->unsignedInteger('version')->default(1)->after('error_message');
            $table->string('decision_status', 20)->default('pending')->after('version');
            $table->unsignedInteger('decided_by')->nullable()->after('requested_by');
            $table->timestamp('decided_at')->nullable()->after('decided_by');

            $table->foreign('decided_by')->references('school_id')->on('users')->nullOnDelete();
            $table->index(['organization_id', 'feature_type', 'reference_id', 'version'], 'ai_outputs_history_index');
        });

        Schema::table('tasks', function (Blueprint $table) {
            $table->string('phase', 40)->nullable()->after('task_type');
            $table->string('priority', 20)->default('medium')->after('phase');
            $table->unsignedInteger('sequence')->nullable()->after('priority');
            $table->string('preferred_role', 100)->nullable()->after('sequence');
            $table->foreignId('depends_on_task_id')->nullable()->after('preferred_role')->constrained('tasks')->nullOnDelete();
            $table->json('delegation_snapshot')->nullable()->after('final_score');
            $table->index(['event_id', 'phase', 'sequence'], 'tasks_event_workflow_order_index');
        });

        Schema::create('task_recommendations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('task_id')->nullable()->constrained('tasks')->cascadeOnDelete();
            $table->foreignId('ai_output_id')->nullable()->constrained('ai_outputs')->cascadeOnDelete();
            $table->foreignId('organization_id')->constrained('organizations')->cascadeOnDelete();
            $table->unsignedInteger('officer_id')->nullable();
            $table->decimal('role_score', 6, 2)->nullable();
            $table->decimal('workload_score', 6, 2)->nullable();
            $table->decimal('performance_score', 6, 2)->nullable();
            $table->json('weights');
            $table->decimal('total_score', 6, 2)->nullable();
            $table->unsignedInteger('rank')->nullable();
            $table->string('eligibility_result', 30);
            $table->timestamp('calculated_at')->useCurrent();

            $table->foreign('officer_id')->references('school_id')->on('users')->nullOnDelete();
            $table->index(['organization_id', 'task_id', 'rank'], 'task_recommendations_lookup_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('task_recommendations');

        Schema::table('tasks', function (Blueprint $table) {
            $table->dropForeign(['depends_on_task_id']);
            $table->dropIndex('tasks_event_workflow_order_index');
            $table->dropColumn(['phase', 'priority', 'sequence', 'preferred_role', 'depends_on_task_id', 'delegation_snapshot']);
        });

        Schema::table('ai_outputs', function (Blueprint $table) {
            $table->dropForeign(['decided_by']);
            $table->dropIndex('ai_outputs_history_index');
            $table->dropColumn(['context_version', 'structured_input', 'structured_output', 'status', 'error_message', 'version', 'decision_status', 'decided_by', 'decided_at']);
        });
    }
};
