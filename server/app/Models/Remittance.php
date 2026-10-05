<?php

namespace App\Models;

use App\Models\Concerns\SerializesLocalDates;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Remittance extends Model
{
    use SerializesLocalDates;

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
