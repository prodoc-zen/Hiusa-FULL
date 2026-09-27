<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ClearanceSignature extends Model
{
    protected $fillable = [
        'clearance_period_id',
        'student_id',
        'organization_id',
        'required_role',
        'status',
        'remarks',
        'signed_by',
        'signed_at',
    ];

    protected function casts(): array
    {
        return [
            'signed_at' => 'datetime',
        ];
    }

    public function clearancePeriod(): BelongsTo
    {
        return $this->belongsTo(ClearancePeriod::class);
    }

    public function student(): BelongsTo
    {
        return $this->belongsTo(User::class, 'student_id', 'school_id');
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function signer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'signed_by', 'school_id');
    }
}
