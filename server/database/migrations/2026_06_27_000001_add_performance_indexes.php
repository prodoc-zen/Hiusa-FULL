<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('announcements', function (Blueprint $table) {
            $table->index(['is_published', 'target_role'], 'announcements_published_role_index');
        });

        Schema::table('tasks', function (Blueprint $table) {
            $table->index(['assigned_to', 'status'], 'tasks_assigned_status_index');
        });

        Schema::table('events', function (Blueprint $table) {
            $table->index(['status', 'start_time'], 'events_status_start_index');
        });

        Schema::table('orders', function (Blueprint $table) {
            $table->index(['student_id', 'status'], 'orders_student_status_index');
        });
    }

    public function down(): void
    {
        Schema::disableForeignKeyConstraints();

        if (Schema::hasTable('announcements')) {
            Schema::table('announcements', function (Blueprint $table) {
                if (Schema::hasIndex('announcements', 'announcements_published_role_index')) {
                    $table->dropIndex('announcements_published_role_index');
                }
            });
        }

        if (Schema::hasTable('tasks')) {
            Schema::table('tasks', function (Blueprint $table) {
                if (Schema::hasIndex('tasks', 'tasks_assigned_status_index')) {
                    $table->dropIndex('tasks_assigned_status_index');
                }
            });
        }

        if (Schema::hasTable('events')) {
            Schema::table('events', function (Blueprint $table) {
                if (Schema::hasIndex('events', 'events_status_start_index')) {
                    $table->dropIndex('events_status_start_index');
                }
            });
        }

        if (Schema::hasTable('orders')) {
            Schema::table('orders', function (Blueprint $table) {
                if (Schema::hasIndex('orders', 'orders_student_status_index')) {
                    $table->dropIndex('orders_student_status_index');
                }
            });
        }

        Schema::enableForeignKeyConstraints();
    }
};
