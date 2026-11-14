<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Facades\DB;

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

    /** Adds message_count and the last assistant message's text (as preview_source) for list and detail headers. */
    public function scopeWithSummary(Builder $query): Builder
    {
        return $query
            ->withCount('messages')
            ->addSelect([
                'preview_source' => AiMessage::select('content')
                    ->whereColumn('conversation_id', 'ai_conversations.id')
                    ->where('role', 'assistant')
                    ->orderByDesc('id')
                    ->limit(1),
                'preview_payload' => AiMessage::select('payload')
                    ->whereColumn('conversation_id', 'ai_conversations.id')
                    ->where('role', 'assistant')
                    ->orderByDesc('id')
                    ->limit(1),
            ]);
    }

    /**
     * Deletes the matching conversations, their messages and the ai_outputs rows those messages point to, so the
     * question and answer text is gone everywhere and not only from the conversation list.
     */
    public static function eraseWithOutputs(Builder $conversations): void
    {
        DB::transaction(function () use ($conversations): void {
            $ids = (clone $conversations)->select('ai_conversations.id');

            AiOutput::query()->whereIn('id', AiMessage::query()
                ->select('ai_output_id')
                ->whereIn('conversation_id', $ids)
                ->whereNotNull('ai_output_id'))->delete();
            AiMessage::query()->whereIn('conversation_id', $ids)->delete();
            $conversations->delete();
        });
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
