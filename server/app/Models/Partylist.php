<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Partylist extends Model
{
    use HasFactory;

    protected $guarded = [];

    public function candidates(): HasMany
    {
        return $this->hasMany(Candidate::class, 'partylist_id');
    }
}
