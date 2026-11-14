<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ai_conversations', function (Blueprint $table) {
            $table->id();
            $table->unsignedInteger('user_id');
            $table->unsignedBigInteger('organization_id')->nullable();
            $table->string('role', 30);
            $table->string('title', 160);
            $table->timestamp('last_message_at')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'last_message_at'], 'ai_conversations_user_recent_index');
            $table->index('organization_id', 'ai_conversations_organization_index');
            $table->foreign('user_id')->references('school_id')->on('users')->cascadeOnDelete();
            $table->foreign('organization_id')->references('id')->on('organizations')->cascadeOnDelete();
        });

        Schema::create('ai_messages', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('conversation_id');
            $table->string('role', 12);
            $table->longText('content');
            $table->json('payload')->nullable();
            $table->string('status', 12)->default('completed');
            $table->string('feedback', 4)->nullable();
            $table->unsignedBigInteger('ai_output_id')->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->index(['conversation_id', 'id'], 'ai_messages_conversation_order_index');
            $table->index('ai_output_id', 'ai_messages_output_index');
            $table->foreign('conversation_id')->references('id')->on('ai_conversations')->cascadeOnDelete();
            $table->foreign('ai_output_id')->references('id')->on('ai_outputs')->nullOnDelete();
        });

        Schema::create('ai_memories', function (Blueprint $table) {
            $table->id();
            $table->unsignedInteger('user_id');
            $table->unsignedBigInteger('organization_id')->nullable();
            $table->string('role', 30);
            $table->string('content', 300);
            $table->timestamps();

            $table->index('user_id', 'ai_memories_user_index');
            $table->index('organization_id', 'ai_memories_organization_index');
            $table->foreign('user_id')->references('school_id')->on('users')->cascadeOnDelete();
            $table->foreign('organization_id')->references('id')->on('organizations')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_memories');
        Schema::dropIfExists('ai_messages');
        Schema::dropIfExists('ai_conversations');
    }
};
