<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Partylist extends Model
{
    use HasFactory;

    protected $guarded = [];

    public function election(): BelongsTo
    {
        return $this->belongsTo(Election::class);
    }

    public function applications(): HasMany
    {
        return $this->hasMany(ElectionApplication::class);
    }

    public function candidates(): HasMany
    {
        return $this->hasMany(Candidate::class, 'partylist_id');
    }
}
