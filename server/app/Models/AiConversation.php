<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class AiConversation extends Model
{
    use HasFactory;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['last_message_at' => 'datetime'];
    }

    /**
     * The one privacy rule: a conversation belongs to the user, the role and the organization it was
     * started in. After a role or organization change the old rows stop existing for that user.
     */
    public function scopeOwnedBy(Builder $query, User $user): Builder
    {
        return $query
            ->where('user_id', $user->school_id)
            ->where('role', $user->role)
            ->where(fn (Builder $scope) => $user->organization_id === null
                ? $scope->whereNull('organization_id')
                : $scope->where('organization_id', $user->organization_id));
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id', 'school_id');
    }

    public function messages(): HasMany
    {
        return $this->hasMany(AiMessage::class, 'conversation_id')->orderBy('id');
    }
}
