<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private const ORG_EMAIL_INDEX = 'password_reset_tokens_org_email_index';

    /**
     * The same email can belong to accounts in different organizations, so a token is
     * keyed by organization and email together. With email alone as the primary key, a
     * second organization's reset request for a shared email hit a duplicate key error.
     */
    public function up(): void
    {
        // A token with no organization can never be redeemed: reset and validate always filter by it.
        DB::table('password_reset_tokens')->whereNull('organization_id')->delete();

        Schema::table('password_reset_tokens', function (Blueprint $table) {
            $table->unsignedBigInteger('organization_id')->nullable(false)->change();
        });

        Schema::table('password_reset_tokens', function (Blueprint $table) {
            $table->dropPrimary();
        });

        Schema::table('password_reset_tokens', function (Blueprint $table) {
            $table->primary(['organization_id', 'email']);
        });

        // The composite primary now serves lookups by organization and the foreign key on
        // organization_id, so it is dropped only after the primary exists.
        if (Schema::hasIndex('password_reset_tokens', self::ORG_EMAIL_INDEX)) {
            Schema::table('password_reset_tokens', function (Blueprint $table) {
                $table->dropIndex(self::ORG_EMAIL_INDEX);
            });
        }
    }

    public function down(): void
    {
        // Email alone must be unique again, so keep only the newest token for each email.
        $keep = [];
        foreach (DB::table('password_reset_tokens')->get() as $row) {
            $current = $keep[$row->email] ?? null;
            if ($current === null || (string) $row->created_at > (string) $current->created_at) {
                $keep[$row->email] = $row;
            }
        }
        foreach (DB::table('password_reset_tokens')->get() as $row) {
            if ($keep[$row->email]->organization_id !== $row->organization_id) {
                DB::table('password_reset_tokens')
                    ->where('organization_id', $row->organization_id)
                    ->where('email', $row->email)
                    ->delete();
            }
        }

        // The foreign key needs an index led by organization_id before the composite primary goes.
        Schema::table('password_reset_tokens', function (Blueprint $table) {
            $table->index(['organization_id', 'email'], self::ORG_EMAIL_INDEX);
        });

        Schema::table('password_reset_tokens', function (Blueprint $table) {
            $table->dropPrimary();
        });

        Schema::table('password_reset_tokens', function (Blueprint $table) {
            $table->primary('email');
        });

        Schema::table('password_reset_tokens', function (Blueprint $table) {
            $table->unsignedBigInteger('organization_id')->nullable()->change();
        });
    }
};
