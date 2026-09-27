<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AccountProfile extends Model
{
    protected $guarded = [];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_school_id', 'school_id');
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }
}
