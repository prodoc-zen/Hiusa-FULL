<?php

namespace App\Models;

use Carbon\CarbonInterface;
use Database\Factories\OrderFactory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Order extends Model
{
    /** @use HasFactory<OrderFactory> */
    use HasFactory;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'total_price' => 'decimal:2',
            'unit_price' => 'decimal:2',
            'promotion_applied' => 'boolean',
            'claimed_at' => 'datetime',
            'claim_verified_at' => 'datetime',
        ];
    }

    public function student(): BelongsTo
    {
        return $this->belongsTo(User::class, 'student_id', 'school_id');
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function merchandise(): BelongsTo
    {
        return $this->belongsTo(Merchandise::class)->withTrashed();
    }

    public function variant(): BelongsTo
    {
        return $this->belongsTo(MerchandiseVariant::class, 'merchandise_variant_id');
    }

    public function processor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'processed_by', 'school_id');
    }

    public function approver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by', 'school_id');
    }

    public function claimVerifier(): BelongsTo
    {
        return $this->belongsTo(User::class, 'claim_verified_by', 'school_id');
    }

    public function transaction(): BelongsTo
    {
        return $this->belongsTo(Transaction::class);
    }

    /** How many days an order may sit with no payment and no payment proof before it lapses. */
    public static function unpaidExpiryDays(): int
    {
        return max(1, (int) config('hiusa.orders.unpaid_expiry_days', 5));
    }

    /** Pending orders nobody has paid on or sent proof for: no proof, no review begun, no receipt, no payment approved on the invoice that bills them. */
    public function scopeAwaitingFirstPayment(Builder $query): Builder
    {
        return $query->where('status', 'pending')
            ->whereNull('payment_proof_url')
            ->whereNull('transaction_id')
            ->where('officer_review_status', 'pending')
            ->where('admin_review_status', 'pending')
            ->whereDoesntHave('billingInvoice', fn (Builder $invoice) => $invoice->whereHas('payments', fn (Builder $payment) => $payment->where('status', 'approved')));
    }

    /** When this order lapses if it stays unpaid, or null once it has any payment activity. Reads `invoice_payment_recorded` when the row query loaded it. */
    public function lapsesAt(): ?CarbonInterface
    {
        $untouched = $this->status === 'pending' && ! $this->payment_proof_url && ! $this->transaction_id
            && $this->officer_review_status === 'pending' && $this->admin_review_status === 'pending'
            && ! ($this->getAttribute('invoice_payment_recorded') ?? false);

        return $untouched && $this->created_at ? $this->created_at->copy()->addDays(self::unpaidExpiryDays()) : null;
    }

    /** The student charge that bills this order; a cancelled or waived one no longer does. */
    public function billingInvoice(): HasOne
    {
        return $this->hasOne(Invoice::class)->whereNotIn('status', ['cancelled', 'waived']);
    }
}
