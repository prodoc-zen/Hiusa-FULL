<?php

namespace App\Models;

use App\Models\Concerns\SerializesLocalDates;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Collection;

class FinancialReport extends Model
{
    use SerializesLocalDates;

    public $timestamps = false;

    protected $guarded = [];

    protected $hidden = ['letterhead_path', 'transactions_snapshot'];

    protected $appends = ['has_letterhead'];

    protected function casts(): array
    {
        return [
            'period_start' => 'date',
            'period_end' => 'date',
            'generated_at' => 'datetime',
            'submitted_at' => 'datetime',
            'department_head_approved_at' => 'datetime',
            'sao_approved_at' => 'datetime',
            'source_transaction_ids' => 'array',
            'opening_balance_snapshot' => 'decimal:2',
            'transactions_snapshot' => 'array',
            'custody_snapshot' => 'array',
            'signatories' => 'array',
            'supporting_documents' => 'array',
            'letter_details' => 'array',
        ];
    }

    public function getHasLetterheadAttribute(): bool
    {
        return filled($this->letterhead_path);
    }

    /**
     * The stored entries keep their private disk path for the server. Responses
     * carry only the authorized route, never the path or a storage URL.
     */
    public function attributesToArray(): array
    {
        $attributes = parent::attributesToArray();

        if (array_key_exists('supporting_documents', $attributes)) {
            $attributes['supporting_documents'] = $this->supportingDocumentLinks();
        }

        return $attributes;
    }

    public function supportingDocumentLinks(): array
    {
        return collect($this->supporting_documents ?? [])
            ->values()
            ->map(fn (array $document, int $index) => [
                'index' => $index,
                'name' => $document['name'] ?? null,
                'mime_type' => $document['mime_type'] ?? null,
                'size' => $document['size'] ?? null,
                'open_url' => '/financial-reports/'.$this->id.'/documents/'.$index,
            ])
            ->all();
    }

    /**
     * The ledger entries as they were when the report was generated. Every total the
     * report shows (card, PDF, Excel) must come from these rows. A report saved before
     * snapshots existed has none, so it reads the live ledger entries it listed.
     */
    public function savedTransactions(): Collection
    {
        if ($this->transactions_snapshot !== null) {
            return collect($this->transactions_snapshot);
        }

        return Transaction::with(['event:id,title', 'budget:id,title'])
            ->where('organization_id', $this->organization_id)
            ->whereIn('id', $this->source_transaction_ids ?? [])
            ->orderBy('transaction_date')
            ->orderBy('id')
            ->get();
    }

    public function aiOutput(): BelongsTo
    {
        return $this->belongsTo(AiOutput::class);
    }

    public function event(): BelongsTo
    {
        return $this->belongsTo(Event::class);
    }

    public function semester(): BelongsTo
    {
        return $this->belongsTo(FinancialSemester::class, 'financial_semester_id');
    }

    public function generator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'generated_by', 'school_id');
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function deadline(): BelongsTo
    {
        return $this->belongsTo(FinancialReportDeadline::class);
    }

    public function departmentHeadApprover(): BelongsTo
    {
        return $this->belongsTo(User::class, 'department_head_approved_by', 'school_id');
    }

    public function saoApprover(): BelongsTo
    {
        return $this->belongsTo(User::class, 'sao_approved_by', 'school_id');
    }
}
