<?php

namespace App\Models;

use App\Models\Concerns\SerializesLocalDates;
use Database\Factories\TransactionFactory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Transaction extends Model
{
    use SerializesLocalDates;

    /** @use HasFactory<TransactionFactory> */
    use HasFactory;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'transaction_date' => 'datetime',
        ];
    }

    public function budget(): BelongsTo
    {
        return $this->belongsTo(Budget::class);
    }

    public function event(): BelongsTo
    {
        return $this->belongsTo(Event::class);
    }

    public function recorder(): BelongsTo
    {
        return $this->belongsTo(User::class, 'recorded_by', 'school_id');
    }

    public function payer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'payer_id', 'school_id');
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function merchandiseOrder(): HasOne
    {
        return $this->hasOne(Order::class);
    }

    /** The cash advance this entry paid out, when it is one. */
    public function releasedCashAdvance(): HasOne
    {
        return $this->hasOne(CashAdvance::class, 'release_transaction_id');
    }

    /** The cash advance repayment this entry received, when it is one. */
    public function cashAdvanceRepayment(): HasOne
    {
        return $this->hasOne(CashAdvanceRepayment::class, 'ledger_transaction_id');
    }

    /** Cash advances move cash but are money lent out and returned, so neither a statement nor a forecast counts them as expense or income. */
    public function scopeExcludingCashAdvances(Builder $query): void
    {
        $query->whereDoesntHave('releasedCashAdvance')->whereDoesntHave('cashAdvanceRepayment');
    }

    /**
     * Which of these ledger entries are cash advance movements, found through the
     * records that created them rather than the category text, which anyone can type.
     *
     * @param  iterable<int>  $ids
     * @return array<int, string> ledger entry id => 'release' or 'repayment'
     */
    public static function cashAdvanceKinds(iterable $ids): array
    {
        $kinds = [];
        foreach (collect($ids)->chunk(500) as $chunk) {
            foreach (CashAdvance::whereIn('release_transaction_id', $chunk)->pluck('release_transaction_id') as $id) {
                $kinds[$id] = 'release';
            }
            foreach (CashAdvanceRepayment::whereIn('ledger_transaction_id', $chunk)->pluck('ledger_transaction_id') as $id) {
                $kinds[$id] = 'repayment';
            }
        }

        return $kinds;
    }
}
