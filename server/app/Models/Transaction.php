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
    /** @use HasFactory<TransactionFactory> */
    use HasFactory;

    use SerializesLocalDates;

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

    /** The collection whose verification recorded this entry, when it is one. */
    public function collectionSource(): HasOne
    {
        return $this->hasOne(Collection::class, 'ledger_transaction_id');
    }

    /** The invoice payment whose approval recorded this entry, when it is one. */
    public function invoicePaymentSource(): HasOne
    {
        return $this->hasOne(InvoicePayment::class, 'ledger_transaction_id');
    }

    /**
     * The records that write a ledger entry on their own, in the order they are checked:
     * source key => [reverse relation, short label shown in the ledger].
     */
    private const SYSTEM_SOURCES = [
        'collection' => ['collectionSource', 'Collection verification'],
        'cash_advance' => ['releasedCashAdvance', 'Cash advance release'],
        'repayment' => ['cashAdvanceRepayment', 'Cash advance repayment'],
        'invoice_payment' => ['invoicePaymentSource', 'Invoice payment'],
        'order' => ['merchandiseOrder', 'Merchandise order'],
    ];

    private static function systemSourceRelations(): array
    {
        return collect(self::SYSTEM_SOURCES)->map(fn (array $source, string $key) => "{$source[0]} as source_{$key}")->values()->all();
    }

    /** Adds one exists subselect per system source to the page query, so no row costs a query of its own. */
    public function scopeWithSystemSource(Builder $query): void
    {
        $query->withExists(self::systemSourceRelations());
    }

    public function loadSystemSource(): static
    {
        return $this->loadExists(self::systemSourceRelations());
    }

    /** The source key found by scopeWithSystemSource or loadSystemSource, or null for a manual entry. */
    public function systemSource(): ?string
    {
        foreach (array_keys(self::SYSTEM_SOURCES) as $key) {
            if ($this->getAttribute("source_{$key}")) {
                return $key;
            }
        }

        return null;
    }

    /** Replaces the raw exists columns with the three keys the ledger screens read. */
    public function exposeSystemSource(): static
    {
        $source = $this->systemSource();

        $this->makeHidden(array_map(fn (string $key) => "source_{$key}", array_keys(self::SYSTEM_SOURCES)));

        return $this->setAttribute('is_system_generated', $source !== null)
            ->setAttribute('system_source', $source)
            ->setAttribute('system_source_label', $source ? self::SYSTEM_SOURCES[$source][1] : null);
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
