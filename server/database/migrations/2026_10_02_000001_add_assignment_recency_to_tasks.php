<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tasks', function (Blueprint $table) {
            $table->timestamp('assigned_at')->nullable()->after('assigned_to');
            $table->decimal('recency_score', 6, 2)->nullable()->after('performance_score');
            $table->index(['organization_id', 'assigned_to', 'assigned_at'], 'tasks_assignment_recency_index');
        });

        Schema::table('task_recommendations', function (Blueprint $table) {
            $table->decimal('recency_score', 6, 2)->nullable()->after('performance_score');
        });

        // Existing assignments are dated from task creation, the best record available.
        DB::table('tasks')->whereNotNull('assigned_to')->update(['assigned_at' => DB::raw('created_at')]);
    }

    public function down(): void
    {
        Schema::table('task_recommendations', function (Blueprint $table) {
            $table->dropColumn('recency_score');
        });

        Schema::table('tasks', function (Blueprint $table) {
            $table->dropIndex('tasks_assignment_recency_index');
            $table->dropColumn(['assigned_at', 'recency_score']);
        });
    }
};
