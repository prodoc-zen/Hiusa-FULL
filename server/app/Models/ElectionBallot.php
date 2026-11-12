<?php

namespace App\Models;

use Database\Factories\ElectionBallotFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Who took part in an election round. The choices live apart in votes and carry no voter id. */
class ElectionBallot extends Model
{
    /** @use HasFactory<ElectionBallotFactory> */
    use HasFactory;

    public $timestamps = false;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'round' => 'integer',
            'submitted_at' => 'datetime',
        ];
    }

    public function election(): BelongsTo
    {
        return $this->belongsTo(Election::class);
    }

    public function voter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'voter_id', 'school_id');
    }

    public static function hasVoted(int $electionId, int $schoolId, int $round = 1): bool
    {
        return static::query()
            ->where('election_id', $electionId)
            ->where('voter_id', $schoolId)
            ->where('round', $round)
            ->exists();
    }
}
