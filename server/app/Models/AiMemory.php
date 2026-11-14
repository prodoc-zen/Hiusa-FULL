<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class AiMemory extends Model
{
    use HasFactory;

    public const LIMIT = 30;

    protected $table = 'ai_memories';

    protected $guarded = [];

    /** Same rule as AiConversation::scopeOwnedBy: a memory from an old role or organization is never read. */
    public function scopeOwnedBy(Builder $query, User $user): Builder
    {
        return $query
            ->where('user_id', $user->school_id)
            ->where('role', $user->role)
            ->where(fn (Builder $scope) => $user->organization_id === null
                ? $scope->whereNull('organization_id')
                : $scope->where('organization_id', $user->organization_id));
    }
}
