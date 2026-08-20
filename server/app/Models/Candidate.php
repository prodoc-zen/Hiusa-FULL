<?php

namespace App\Models;

use Database\Factories\CandidateFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Candidate extends Model
{
    /** @use HasFactory<CandidateFactory> */
    use HasFactory;

    protected $guarded = [];

    public function election(): BelongsTo
    {
        return $this->belongsTo(Election::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id', 'school_id');
    }

    public function position(): BelongsTo
    {
        return $this->belongsTo(ElectionPosition::class, 'position_id');
    }

    public function partylist(): BelongsTo
    {
        return $this->belongsTo(Partylist::class, 'partylist_id');
    }

    public function votes(): HasMany
    {
        return $this->hasMany(Vote::class);
    }
}
