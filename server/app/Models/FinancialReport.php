<?php

namespace App\Models;

use App\Models\Concerns\SerializesLocalDates;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

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
