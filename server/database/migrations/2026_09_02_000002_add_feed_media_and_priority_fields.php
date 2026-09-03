<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('announcements', function (Blueprint $table) {
            $table->string('image_url')->nullable()->after('body');
            $table->boolean('is_pinned')->default(false)->after('is_published');
            $table->boolean('is_important')->default(false)->after('is_pinned');
            $table->index(['organization_id', 'is_published', 'approval_status', 'created_at'], 'announcements_feed_lookup');
        });

        Schema::table('events', function (Blueprint $table) {
            $table->string('image_url')->nullable()->after('description');
            $table->index(['organization_id', 'status', 'created_at'], 'events_feed_lookup');
        });
    }

    public function down(): void
    {
        Schema::table('announcements', function (Blueprint $table) {
            $table->dropIndex('announcements_feed_lookup');
            $table->dropColumn(['image_url', 'is_pinned', 'is_important']);
        });

        Schema::table('events', function (Blueprint $table) {
            $table->dropIndex('events_feed_lookup');
            $table->dropColumn('image_url');
        });
    }
};
