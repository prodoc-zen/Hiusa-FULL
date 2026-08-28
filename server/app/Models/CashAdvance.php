<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class CashAdvance extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['amount' => 'decimal:2', 'approved_at' => 'datetime', 'released_at' => 'datetime'];
    }

    public function repayments(): HasMany
    {
        return $this->hasMany(CashAdvanceRepayment::class);
    }
}
