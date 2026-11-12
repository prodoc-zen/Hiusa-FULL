<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('elections', function (Blueprint $table) {
            $table->text('description')->nullable();
            $table->dateTime('filing_starts_at')->nullable();
            $table->dateTime('filing_ends_at')->nullable();
            $table->dateTime('screening_starts_at')->nullable();
            $table->dateTime('screening_ends_at')->nullable();
            $table->dateTime('campaign_starts_at')->nullable();
            $table->dateTime('campaign_ends_at')->nullable();
            $table->dateTime('results_publish_at')->nullable();
            $table->dateTime('runoff_starts_at')->nullable();
            $table->dateTime('runoff_ends_at')->nullable();
            $table->dateTime('runoff_publish_at')->nullable();
            $table->longText('rules')->nullable();
            $table->unsignedSmallInteger('rules_version')->default(0);
            $table->string('tie_break_rule', 500)->nullable();
            $table->decimal('min_gpa', 3, 2)->nullable();
            $table->unsignedTinyInteger('min_units')->nullable();
            $table->string('phase', 24)->nullable()->index();
            $table->string('phase_alert')->nullable();
            $table->json('notices_sent')->nullable();
            $table->timestamp('submitted_at')->nullable();
            $table->timestamp('declined_at')->nullable();
            $table->timestamp('suspended_at')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->string('halt_reason', 500)->nullable();
            $table->unsignedTinyInteger('tally_version')->default(2);
        });

        // Every election that exists today was submitted when it was created.
        DB::table('elections')->update(['submitted_at' => DB::raw('created_at')]);

        // Elections already closed keep today's reading of their results (tally version 1).
        DB::table('elections')->where('status', 'closed')->update(['tally_version' => 1]);
    }

    public function down(): void
    {
        Schema::table('elections', function (Blueprint $table) {
            $table->dropIndex(['phase']);
            $table->dropColumn([
                'description', 'filing_starts_at', 'filing_ends_at', 'screening_starts_at', 'screening_ends_at',
                'campaign_starts_at', 'campaign_ends_at', 'results_publish_at', 'runoff_starts_at', 'runoff_ends_at',
                'runoff_publish_at', 'rules', 'rules_version', 'tie_break_rule', 'min_gpa', 'min_units', 'phase',
                'phase_alert', 'notices_sent', 'submitted_at', 'declined_at', 'suspended_at', 'cancelled_at',
                'completed_at', 'halt_reason', 'tally_version',
            ]);
        });
    }
};
