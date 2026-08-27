<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('task_progress_updates', function (Blueprint $table) {
            $table->id();
            $table->foreignId('task_id')->constrained('tasks')->cascadeOnDelete();
            $table->foreignId('organization_id')->constrained('organizations')->cascadeOnDelete();
            $table->unsignedInteger('updated_by')->nullable();
            $table->string('status', 30);
            $table->unsignedTinyInteger('progress_percent')->default(0);
            $table->text('note')->nullable();
            $table->timestamps();

            $table->foreign('updated_by')->references('school_id')->on('users')->nullOnDelete();
            $table->index(['organization_id', 'task_id', 'created_at'], 'task_progress_org_task_created_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('task_progress_updates');
    }
};
