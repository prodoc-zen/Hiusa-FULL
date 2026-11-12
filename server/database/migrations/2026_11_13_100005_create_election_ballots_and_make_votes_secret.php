<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('election_ballots', function (Blueprint $table) {
            $table->id();
            $table->foreignId('election_id')->constrained('elections')->cascadeOnDelete();
            $table->unsignedTinyInteger('round')->default(1);
            $table->unsignedInteger('voter_id');
            $table->string('receipt_ref', 16)->unique();
            $table->timestamp('submitted_at')->useCurrent();

            $table->unique(['election_id', 'round', 'voter_id']);
        });

        // New ballots are secret: the choices carry no voter id. Rows already cast keep theirs.
        Schema::table('votes', function (Blueprint $table) {
            $table->unsignedInteger('voter_id')->nullable()->change();
            $table->unsignedTinyInteger('round')->default(1);
        });

        $this->backfillBallots();
    }

    /** One round 1 participation row per voter who already has votes in an election. */
    private function backfillBallots(): void
    {
        $taken = [];
        $page = 1;

        do {
            $voters = DB::table('votes')
                ->select('election_id', 'voter_id', DB::raw('MIN(vote_hash) as first_hash'), DB::raw('MIN(cast_at) as first_cast_at'))
                ->whereNotNull('voter_id')
                ->groupBy('election_id', 'voter_id')
                ->orderBy('election_id')
                ->orderBy('voter_id')
                ->forPage($page++, 500)
                ->get();

            $rows = [];
            foreach ($voters as $voter) {
                $reference = $this->receiptReference($voter->first_hash, $voter->election_id, $voter->voter_id, $taken);
                $taken[$reference] = true;
                $rows[] = [
                    'election_id' => $voter->election_id,
                    'round' => 1,
                    'voter_id' => $voter->voter_id,
                    'receipt_ref' => $reference,
                    'submitted_at' => $voter->first_cast_at,
                ];
            }

            if ($rows !== []) {
                DB::table('election_ballots')->insert($rows);
            }
        } while ($voters->count() === 500);
    }

    /** The receipt column holds 16 characters, so a longer hash is cut and a clash falls back to a derived value. */
    private function receiptReference(string $hash, int $electionId, int $voterId, array $taken): string
    {
        $reference = substr($hash, 0, 16);

        for ($attempt = 0; isset($taken[$reference]); $attempt++) {
            $reference = substr(hash('sha256', $hash.'|'.$electionId.'|'.$voterId.'|'.$attempt), 0, 16);
        }

        return $reference;
    }

    public function down(): void
    {
        // Rows without a voter id cannot satisfy the old NOT NULL column, so they go with the secret ballots.
        DB::table('votes')->whereNull('voter_id')->delete();

        Schema::table('votes', function (Blueprint $table) {
            $table->dropColumn('round');
            $table->unsignedInteger('voter_id')->nullable(false)->change();
        });

        Schema::dropIfExists('election_ballots');
    }
};
