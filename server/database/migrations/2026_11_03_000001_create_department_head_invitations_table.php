<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('department_head_invitations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('college_id')->constrained('colleges')->cascadeOnDelete();
            $table->string('first_name', 60);
            $table->string('last_name', 60);
            $table->string('email', 100);
            $table->unsignedInteger('school_id')->nullable();
            $table->string('token_hash', 64)->unique();
            $table->unsignedInteger('invited_by');
            $table->foreign('invited_by')->references('school_id')->on('users')->cascadeOnDelete();
            $table->timestamp('expires_at');
            $table->timestamp('accepted_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('department_head_invitations');
    }
};
