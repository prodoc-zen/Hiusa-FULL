<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Fingerprint extends Model
{
    protected $guarded = [];

    protected $hidden = ['template'];

    protected function casts(): array
    {
        return ['enrolled_at' => 'datetime'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id', 'school_id');
    }
}
