<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Remittance extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['amount' => 'decimal:2', 'remitted_at' => 'datetime', 'verified_at' => 'datetime'];
    }

    public function collection(): BelongsTo
    {
        return $this->belongsTo(Collection::class);
    }
}
