<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('approval_requests', function (Blueprint $table) {
            $table->unsignedInteger('assigned_approver')->nullable()->after('required_role');
            $table->string('decision', 20)->nullable()->after('status');
            $table->foreign('assigned_approver')->references('school_id')->on('users')->nullOnDelete();
            $table->index(['required_role', 'assigned_approver', 'status'], 'approval_routing_index');
        });

        Schema::table('audit_logs', function (Blueprint $table) {
            $table->string('actor_role', 30)->nullable()->after('user_id');
            $table->text('description')->nullable()->after('action');
        });
    }

    public function down(): void
    {
        Schema::table('audit_logs', function (Blueprint $table) {
            $table->dropColumn(['actor_role', 'description']);
        });

        Schema::table('approval_requests', function (Blueprint $table) {
            $table->dropIndex('approval_routing_index');
            $table->dropForeign(['assigned_approver']);
            $table->dropColumn(['assigned_approver', 'decision']);
        });
    }
};
