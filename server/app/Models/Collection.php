<?php

namespace App\Models;

use App\Models\Concerns\SerializesLocalDates;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Collection extends Model
{
    use SerializesLocalDates;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['expected_amount' => 'decimal:2', 'amount_collected' => 'decimal:2', 'collected_at' => 'datetime', 'verified_at' => 'datetime'];
    }

    public function remittances(): HasMany
    {
        return $this->hasMany(Remittance::class);
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }
}
