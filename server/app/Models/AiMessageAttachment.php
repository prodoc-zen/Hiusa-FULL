<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\Storage;

/** A file a person attached to a question in Ask AI. It lives on a private disk and only its owner can open it. */
class AiMessageAttachment extends Model
{
    public const UPDATED_AT = null;

    /** The only types accepted, and the largest file in kilobytes (the unit the validator counts in). */
    public const EXTENSIONS = ['jpeg', 'png', 'webp', 'pdf'];

    public const MAX_KILOBYTES = 5120;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['size_bytes' => 'integer', 'created_at' => 'datetime'];
    }

    public function message(): BelongsTo
    {
        return $this->belongsTo(AiMessage::class, 'message_id');
    }

    public function scopeOwnedBy(Builder $query, User $user): Builder
    {
        return $query->where('user_id', $user->school_id);
    }

    /** What a client needs to show the chip and open the file; the path on disk never leaves the server. */
    public function present(): array
    {
        return [
            'id' => $this->id,
            'name' => $this->original_name,
            'mime_type' => $this->mime_type,
            'size_bytes' => $this->size_bytes,
            'open_url' => '/ai/assistant/attachments/'.$this->id,
        ];
    }

    /** Removes the files from disk for every attachment the query matches. The rows go with their messages. */
    public static function eraseFiles(Builder $attachments): void
    {
        $attachments->get(['id', 'disk', 'path'])->each(function (self $attachment): void {
            Storage::disk($attachment->disk)->delete($attachment->path);
        });
    }
}
