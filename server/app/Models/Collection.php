<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Collection extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['expected_amount' => 'decimal:2', 'amount_collected' => 'decimal:2', 'collected_at' => 'datetime', 'verified_at' => 'datetime'];
    }

    public function remittances(): HasMany
    {
        return $this->hasMany(Remittance::class);
    }
}
