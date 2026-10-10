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
     * snapshots existed has none, so it reads the live ledger entries it listed. A caller
     * listing many reports passes the entries from legacyLedgerFor() so those reports
     * share one query; the entries carry no event or budget titles then, which totals do not need.
     */
    public function savedTransactions(?Collection $legacyLedger = null): Collection
    {
        if ($this->transactions_snapshot !== null) {
            return collect($this->transactions_snapshot);
        }

        if ($legacyLedger !== null) {
            return collect($this->source_transaction_ids ?? [])
                ->map(fn ($id) => $legacyLedger->get($id))
                ->filter(fn (?Transaction $entry) => $entry !== null && $entry->organization_id === $this->organization_id)
                ->sortBy([['transaction_date', 'asc'], ['id', 'asc']])
                ->values();
        }

        return Transaction::with(['event:id,title', 'budget:id,title'])
            ->where('organization_id', $this->organization_id)
            ->whereIn('id', $this->source_transaction_ids ?? [])
            ->orderBy('transaction_date')
            ->orderBy('id')
            ->get();
    }

    /**
     * The live ledger entries listed by the reports that have no snapshot, in one query,
     * keyed by entry id.
     *
     * @param  iterable<FinancialReport>  $reports
     */
    public static function legacyLedgerFor(iterable $reports): Collection
    {
        $ids = collect($reports)
            ->filter(fn (FinancialReport $report) => $report->transactions_snapshot === null)
            ->flatMap(fn (FinancialReport $report) => $report->source_transaction_ids ?? [])
            ->unique()
            ->values();

        if ($ids->isEmpty()) {
            return collect();
        }

        return Transaction::whereIn('id', $ids)->get(['id', 'organization_id', 'type', 'amount', 'transaction_date'])->keyBy('id');
    }

    /**
     * A report that has gone to review or been approved freezes the entries it lists,
     * so the live ledger keeps matching what was reviewed. A draft or returned report
     * does not.
     */
    public const LOCKING_STATUSES = ['pending_department_head', 'pending_sao', 'approved'];

    /**
     * The title of the locking report for each of these ledger entries, in one query
     * however many entries are passed. Entries no locking report lists are left out.
     *
     * @param  iterable<Transaction>  $transactions
     * @return array<int, string> ledger entry id => report title
     */
    public static function lockingTitles(iterable $transactions): array
    {
        $entries = collect($transactions)->keyBy('id');

        if ($entries->isEmpty()) {
            return [];
        }

        $reports = static::query()
            ->whereIn('submission_status', self::LOCKING_STATUSES)
            ->whereIn('organization_id', $entries->pluck('organization_id')->unique()->all())
            ->where(function ($listing) use ($entries) {
                foreach ($entries->keys() as $id) {
                    $listing->orWhereJsonContains('source_transaction_ids', $id);
                }
            })
            ->orderBy('id')
            ->get(['id', 'organization_id', 'title', 'source_transaction_ids']);

        $titles = [];
        foreach ($reports as $report) {
            foreach ($report->source_transaction_ids ?? [] as $id) {
                $entry = $entries->get((int) $id);

                if ($entry && (int) $entry->organization_id === (int) $report->organization_id) {
                    $titles[$entry->id] ??= $report->title;
                }
            }
        }

        return $titles;
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
