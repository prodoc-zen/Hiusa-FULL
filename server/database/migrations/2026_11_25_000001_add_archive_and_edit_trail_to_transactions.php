<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('transactions', function (Blueprint $table) {
            $table->dateTime('archived_at')->nullable();
            $table->unsignedBigInteger('archived_by')->nullable();
            $table->string('archive_reason', 500)->nullable();
            $table->dateTime('last_edited_at')->nullable();
            $table->unsignedBigInteger('last_edited_by')->nullable();
            $table->unsignedInteger('edit_count')->default(0);
            $table->index(['organization_id', 'archived_at'], 'transactions_org_archived_index');
        });
    }

    public function down(): void
    {
        Schema::table('transactions', function (Blueprint $table) {
            $table->dropIndex('transactions_org_archived_index');
            $table->dropColumn(['archived_at', 'archived_by', 'archive_reason', 'last_edited_at', 'last_edited_by', 'edit_count']);
        });
    }
};
