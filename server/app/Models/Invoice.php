<?php

namespace App\Models;

use App\Models\Concerns\SerializesLocalDates;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Invoice extends Model
{
    use SerializesLocalDates;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['amount_due' => 'decimal:2', 'due_date' => 'date'];
    }

    public function payments(): HasMany
    {
        return $this->hasMany(InvoicePayment::class);
    }

    /** What the student still owes on this charge: the amount due minus its approved payments. */
    public function remainingBalance(): float
    {
        return round((float) $this->amount_due - (float) $this->payments()->where('status', 'approved')->sum('amount'), 2);
    }
}
