<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DepartmentHeadInvitation extends Model
{
    protected $fillable = [
        'college_id',
        'first_name',
        'last_name',
        'email',
        'school_id',
        'token_hash',
        'invited_by',
        'expires_at',
        'accepted_at',
    ];

    protected $casts = [
        'expires_at' => 'datetime',
        'accepted_at' => 'datetime',
        'school_id' => 'integer',
        'college_id' => 'integer',
        'invited_by' => 'integer',
    ];

    protected $hidden = [
        'token_hash',
    ];

    public function college(): BelongsTo
    {
        return $this->belongsTo(College::class);
    }

    public function inviter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'invited_by', 'school_id');
    }

    public function scopePending(Builder $query): Builder
    {
        return $query->whereNull('accepted_at')->where('expires_at', '>', now());
    }

    public function isExpired(): bool
    {
        return $this->expires_at->isPast();
    }

    public function isAccepted(): bool
    {
        return $this->accepted_at !== null;
    }
}

