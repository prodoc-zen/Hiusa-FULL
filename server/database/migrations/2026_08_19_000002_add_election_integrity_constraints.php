<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('candidates', function (Blueprint $table) {
            if (! Schema::hasIndex('candidates', 'candidates_election_user_unique')) {
                $table->unique(['election_id', 'user_id'], 'candidates_election_user_unique');
            }
        });

        Schema::table('election_positions', function (Blueprint $table) {
            if (! Schema::hasIndex('election_positions', 'election_positions_election_title_unique')) {
                $table->unique(['election_id', 'title'], 'election_positions_election_title_unique');
            }
        });
    }

    public function down(): void
    {
        Schema::table('candidates', function (Blueprint $table) {
            if (Schema::hasIndex('candidates', 'candidates_election_user_unique')) {
                $table->dropUnique('candidates_election_user_unique');
            }
        });

        Schema::table('election_positions', function (Blueprint $table) {
            if (Schema::hasIndex('election_positions', 'election_positions_election_title_unique')) {
                $table->dropUnique('election_positions_election_title_unique');
            }
        });
    }
};
