<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('approval_requests', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->nullable()->constrained('organizations')->nullOnDelete();
            $table->string('entity_type', 40);
            $table->unsignedBigInteger('entity_id');
            $table->unsignedInteger('requested_by');
            $table->string('required_role', 30);
            $table->string('status', 20)->default('pending');
            $table->unsignedInteger('reviewed_by')->nullable();
            $table->text('remarks')->nullable();
            $table->timestamp('requested_at')->useCurrent();
            $table->dateTime('reviewed_at')->nullable();

            $table->index(['entity_type', 'entity_id'], 'approval_entity_index');
            $table->index(['status', 'required_role'], 'approval_status_role_index');
            $table->foreign('requested_by')->references('school_id')->on('users')->cascadeOnDelete();
            $table->foreign('reviewed_by')->references('school_id')->on('users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('approval_requests');
    }
};
