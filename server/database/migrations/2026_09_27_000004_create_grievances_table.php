<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('grievances', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->nullable()->constrained('organizations')->nullOnDelete();
            $table->string('title', 255);
            $table->text('description');
            $table->string('status', 20)->default('Open'); // Open, In Progress, Resolved
            $table->boolean('is_anonymous')->default(false);
            $table->unsignedInteger('submitted_by')->nullable(); // Null if anonymous
            $table->unsignedInteger('assigned_to')->nullable(); // SAO Admin
            $table->text('resolution_remarks')->nullable();
            $table->dateTime('resolved_at')->nullable();
            $table->timestamps();

            $table->foreign('submitted_by')->references('school_id')->on('users')->nullOnDelete();
            $table->foreign('assigned_to')->references('school_id')->on('users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('grievances');
    }
};
