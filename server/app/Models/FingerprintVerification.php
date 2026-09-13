<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class FingerprintVerification extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['verified_at' => 'datetime', 'score' => 'decimal:4', 'threshold' => 'decimal:4'];
    }
}
