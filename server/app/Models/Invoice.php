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

    /** A cancelled or waived charge is not owed any more. */
    public function isVoided(): bool
    {
        return in_array($this->status, ['cancelled', 'waived'], true);
    }

    /** What the student still owes on this charge: the amount due minus its approved payments, nothing once it is cancelled or waived. */
    public function remainingBalance(): float
    {
        if ($this->isVoided()) {
            return 0.0;
        }

        return round((float) $this->amount_due - (float) $this->payments()->where('status', 'approved')->sum('amount'), 2);
    }

    /** Why this charge can no longer be cancelled or waived, or null while it still can: it is closed already, or a payment was approved on it. */
    public function closeRefusal(): ?string
    {
        if ($this->status === 'paid' || $this->isVoided()) {
            return "This invoice is already {$this->status}.";
        }

        return $this->payments()->where('status', 'approved')->exists()
            ? 'Payments were already approved on this invoice, so it can no longer be cancelled or waived.'
            : null;
    }
}
