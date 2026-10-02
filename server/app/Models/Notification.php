<?php

namespace App\Models;

use Database\Factories\NotificationFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Notification extends Model
{
    /** @use HasFactory<NotificationFactory> */
    use HasFactory;

    protected $guarded = [];

    // Informational kinds a person may hide. Approvals, tasks, account and
    // finance notices always show, because someone is waiting on them.
    public const MUTABLE_TYPES = ['announcement', 'event', 'election', 'merchandise'];

    protected function casts(): array
    {
        return [
            'is_read' => 'boolean',
            'scheduled_at' => 'datetime',
            'sent_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id', 'school_id');
    }
}
