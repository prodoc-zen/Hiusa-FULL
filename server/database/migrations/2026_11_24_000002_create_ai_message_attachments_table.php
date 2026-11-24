<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ai_message_attachments', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('message_id');
            // The owner's school ID. No foreign key: the row goes with its message, which goes with the owner's conversation.
            $table->unsignedInteger('user_id');
            $table->string('disk', 30)->default('local');
            $table->string('path', 255);
            $table->string('original_name', 255);
            $table->string('mime_type', 100);
            $table->unsignedInteger('size_bytes');
            $table->timestamp('created_at')->useCurrent();

            $table->unique('message_id', 'ai_message_attachments_message_unique');
            $table->index('user_id', 'ai_message_attachments_user_index');
            $table->foreign('message_id')->references('id')->on('ai_messages')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_message_attachments');
    }
};
