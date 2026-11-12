<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('officer_handovers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained('organizations')->cascadeOnDelete();
            $table->foreignId('election_id')->constrained('elections')->cascadeOnDelete();
            $table->string('academic_year', 20)->nullable();
            // finance, events, tasks, organization, election, compliance
            $table->string('category', 20);
            $table->string('reference_url')->nullable();
            $table->text('remarks')->nullable();
            $table->string('attachment_path')->nullable();
            $table->string('attachment_name')->nullable();
            // pending, prepared, under_review, acknowledged
            $table->string('status', 16)->default('pending');
            $table->unsignedInteger('prepared_by')->nullable();
            $table->timestamp('prepared_at')->nullable();
            $table->unsignedInteger('acknowledged_by')->nullable();
            $table->timestamp('acknowledged_at')->nullable();
            $table->timestamps();

            $table->unique(['election_id', 'category']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('officer_handovers');
    }
};
