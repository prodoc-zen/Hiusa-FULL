<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A dean's permission for one student of the college to apply for a new organization. One grant carries one application. */
class OrganizationApplicantGrant extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['revoked_at' => 'datetime'];
    }

    public function scopeOpen(Builder $query): Builder
    {
        return $query->whereNull('used_application_id')->whereNull('revoked_at');
    }

    public function college(): BelongsTo
    {
        return $this->belongsTo(College::class)->withTrashed();
    }

    public function student(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_school_id', 'school_id');
    }

    public function grantor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'granted_by', 'school_id');
    }

    public function application(): BelongsTo
    {
        return $this->belongsTo(OrganizationApplication::class, 'used_application_id');
    }

    public function state(): string
    {
        return match (true) {
            $this->revoked_at !== null => 'revoked',
            $this->used_application_id !== null => 'used',
            default => 'open',
        };
    }
}
