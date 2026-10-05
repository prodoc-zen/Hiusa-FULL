<?php

namespace App\Models;

use App\Models\Concerns\SerializesLocalDates;
use Illuminate\Database\Eloquent\Model;

class CashAdvanceRepayment extends Model
{
    use SerializesLocalDates;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['amount' => 'decimal:2', 'repaid_at' => 'datetime'];
    }
}
