<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AccountProfile extends Model
{
    protected $guarded = [];

    /** The one rule every administrator count follows: an administrator whose profile or user account is disabled or inactive is not counted. */
    public function scopeActiveAdministrators(Builder $query): Builder
    {
        return $query->where('account_profiles.role', 'ADMIN')->where('account_profiles.account_status', 'active')
            ->whereHas('user', fn ($user) => $user->where('users.account_status', 'active'));
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_school_id', 'school_id');
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }
}
