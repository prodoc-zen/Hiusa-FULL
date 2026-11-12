<?php

namespace App\Models;

use Database\Factories\ElectionPositionFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ElectionPosition extends Model
{
    /** @use HasFactory<ElectionPositionFactory> */
    use HasFactory;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'is_executive' => 'boolean',
            'is_active' => 'boolean',
            'eligible_year_levels' => 'array',
            'runoff_candidate_ids' => 'array',
            'resolved_winner_ids' => 'array',
            'tie_resolved_at' => 'datetime',
        ];
    }

    public function election(): BelongsTo
    {
        return $this->belongsTo(Election::class);
    }

    public function candidates(): HasMany
    {
        return $this->hasMany(Candidate::class, 'position_id');
    }

    public function votes(): HasMany
    {
        return $this->hasMany(Vote::class, 'position_id');
    }
}
