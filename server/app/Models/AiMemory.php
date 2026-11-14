<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;

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

    /**
     * Saves one memory under the cap. The user's row is locked while the count is read and the row written, so
     * parallel requests cannot all see room. Null when the scope already holds the limit.
     */
    public static function remember(User $user, string $content): ?self
    {
        return DB::transaction(function () use ($user, $content): ?self {
            User::query()->whereKey($user->school_id)->lockForUpdate()->first();

            $existing = static::ownedBy($user)->where('content', $content)->first();
            if ($existing !== null) {
                return $existing;
            }
            if (static::ownedBy($user)->count() >= self::LIMIT) {
                return null;
            }

            return static::create([
                'user_id' => $user->school_id,
                'organization_id' => $user->organization_id,
                'role' => $user->role,
                'content' => $content,
            ]);
        });
    }
}
