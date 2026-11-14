<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\DB;

class AiMessage extends Model
{
    use HasFactory;

    public const UPDATED_AT = null;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['payload' => 'array', 'created_at' => 'datetime'];
    }

    public function conversation(): BelongsTo
    {
        return $this->belongsTo(AiConversation::class, 'conversation_id');
    }

    /** Deletes the message together with the ai_outputs row that holds its text. */
    public function eraseWithOutput(): void
    {
        DB::transaction(function (): void {
            $outputId = $this->ai_output_id;
            $this->delete();
            if ($outputId !== null) {
                AiOutput::query()->whereKey($outputId)->delete();
            }
        });
    }
}
