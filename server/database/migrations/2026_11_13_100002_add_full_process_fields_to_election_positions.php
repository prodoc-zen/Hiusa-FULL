<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('election_positions', function (Blueprint $table) {
            $table->string('description')->nullable();
            $table->boolean('is_executive')->default(false);
            $table->unsignedTinyInteger('vote_limit')->nullable();
            $table->json('eligible_year_levels')->nullable();
            $table->string('other_qualifications', 500)->nullable();
            $table->boolean('is_active')->default(true);
            $table->json('runoff_candidate_ids')->nullable();
            $table->unsignedTinyInteger('runoff_seats')->nullable();
            $table->string('result_status', 24)->nullable();
            $table->json('resolved_winner_ids')->nullable();
            $table->string('tie_rule_used', 500)->nullable();
            $table->text('tie_explanation')->nullable();
            $table->unsignedInteger('tie_resolved_by')->nullable();
            $table->timestamp('tie_resolved_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('election_positions', function (Blueprint $table) {
            $table->dropColumn([
                'description', 'is_executive', 'vote_limit', 'eligible_year_levels', 'other_qualifications',
                'is_active', 'runoff_candidate_ids', 'runoff_seats', 'result_status', 'resolved_winner_ids',
                'tie_rule_used', 'tie_explanation', 'tie_resolved_by', 'tie_resolved_at',
            ]);
        });
    }
};
