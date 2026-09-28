<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('evaluation_responses', function (Blueprint $table) {
            $table->id();
            $table->foreignId('evaluation_window_id')->constrained('evaluation_windows')->cascadeOnDelete();
            $table->foreignId('organization_id')->constrained('organizations')->cascadeOnDelete();
            $table->unsignedInteger('user_id');
            $table->string('respondent_type', 20);
            $table->timestamp('consent_given_at')->nullable();
            $table->json('profile')->nullable();
            $table->json('answers');
            $table->text('feedback')->nullable();
            $table->timestamp('submitted_at')->nullable();
            $table->timestamps();

            $table->foreign('user_id')->references('school_id')->on('users')->cascadeOnDelete();
            $table->unique(['evaluation_window_id', 'user_id']);
            $table->index(['organization_id', 'respondent_type'], 'evaluation_responses_org_type_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('evaluation_responses');
    }
};
