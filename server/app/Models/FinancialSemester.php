<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class FinancialSemester extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['starts_on' => 'date:Y-m-d', 'ends_on' => 'date:Y-m-d'];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }
}
