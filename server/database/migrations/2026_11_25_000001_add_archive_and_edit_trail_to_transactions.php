<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A ledger entry is never deleted: it is archived with a reason, and every edit leaves who, when and how often.
     * archived_by and last_edited_by hold users.school_id, the key the users table uses.
     */
    public function up(): void
    {
        Schema::table('transactions', function (Blueprint $table) {
            $table->dateTime('archived_at')->nullable();
            $table->unsignedInteger('archived_by')->nullable();
            $table->string('archive_reason', 500)->nullable();
            $table->dateTime('last_edited_at')->nullable();
            $table->unsignedInteger('last_edited_by')->nullable();
            $table->unsignedInteger('edit_count')->default(0);

            $table->foreign('archived_by')->references('school_id')->on('users')->nullOnDelete();
            $table->foreign('last_edited_by')->references('school_id')->on('users')->nullOnDelete();
            $table->index(['organization_id', 'archived_at'], 'transactions_org_archived_index');
        });
    }

    public function down(): void
    {
        Schema::table('transactions', function (Blueprint $table) {
            $table->dropIndex('transactions_org_archived_index');
            $table->dropForeign(['archived_by']);
            $table->dropForeign(['last_edited_by']);
            $table->dropColumn(['archived_at', 'archived_by', 'archive_reason', 'last_edited_at', 'last_edited_by', 'edit_count']);
        });
    }
};
