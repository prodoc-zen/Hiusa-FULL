<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ClearanceSignature extends Model
{
    use HasFactory;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'cleared_at' => 'datetime',
        ];
    }

    public function clearance(): BelongsTo
    {
        return $this->belongsTo(Clearance::class);
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function officer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'officer_id', 'school_id');
    }

    public function clearingUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'cleared_by', 'school_id');
    }
}
