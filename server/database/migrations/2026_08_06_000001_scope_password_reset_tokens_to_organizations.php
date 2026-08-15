<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('password_reset_tokens', 'organization_id')) {
            Schema::table('password_reset_tokens', function (Blueprint $table) {
                $table->foreignId('organization_id')
                    ->nullable()
                    ->after('email')
                    ->constrained('organizations')
                    ->cascadeOnDelete();

                $table->index(['organization_id', 'email'], 'password_reset_tokens_org_email_index');
            });

            DB::table('password_reset_tokens')
                ->orderBy('email')
                ->each(function (object $resetToken): void {
                    $organizationId = DB::table('users')
                        ->where('email', $resetToken->email)
                        ->value('organization_id');

                    if ($organizationId) {
                        DB::table('password_reset_tokens')
                            ->where('email', $resetToken->email)
                            ->update(['organization_id' => $organizationId]);

                        return;
                    }

                    DB::table('password_reset_tokens')
                        ->where('email', $resetToken->email)
                        ->delete();
                });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('password_reset_tokens', 'organization_id')) {
            Schema::table('password_reset_tokens', function (Blueprint $table) {
                $table->dropForeign(['organization_id']);
                $table->dropIndex('password_reset_tokens_org_email_index');
                $table->dropColumn('organization_id');
            });
        }
    }
};
