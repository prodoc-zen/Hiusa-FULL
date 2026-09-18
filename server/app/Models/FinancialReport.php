<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class FinancialReport extends Model
{
    public $timestamps = false;

    protected $guarded = [];

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
            'signatories' => 'array',
            'supporting_documents' => 'array',
        ];
    }

    public function aiOutput(): BelongsTo
    {
        return $this->belongsTo(AiOutput::class);
    }

    public function event(): BelongsTo
    {
        return $this->belongsTo(Event::class);
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
