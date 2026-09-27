<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class EventRequirementFile extends Model
{
    protected $guarded = [];

    protected $hidden = ['path'];

    public function requirement(): BelongsTo
    {
        return $this->belongsTo(EventRequirement::class);
    }
}
