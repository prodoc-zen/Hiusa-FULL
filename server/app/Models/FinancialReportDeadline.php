<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class FinancialReportDeadline extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['deadline_at' => 'datetime'];
    }

    public function setter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'set_by', 'school_id');
    }

    public function announcement(): BelongsTo
    {
        return $this->belongsTo(Announcement::class);
    }
}
