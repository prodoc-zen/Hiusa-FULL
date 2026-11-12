<?php

namespace App\Models;

use Database\Factories\OfficerAppointmentFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class OfficerAppointment extends Model
{
    /** @use HasFactory<OfficerAppointmentFactory> */
    use HasFactory;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'is_executive' => 'boolean',
            'deadline_at' => 'datetime',
            'term_starts_on' => 'date:Y-m-d',
            'term_ends_on' => 'date:Y-m-d',
            'result_final_at' => 'datetime',
            'last_recalculated_at' => 'datetime',
            'activated_at' => 'datetime',
            'ended_at' => 'datetime',
            'start_notice_at' => 'datetime',
            'end_notice_at' => 'datetime',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function election(): BelongsTo
    {
        return $this->belongsTo(Election::class);
    }

    public function position(): BelongsTo
    {
        return $this->belongsTo(ElectionPosition::class, 'election_position_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_school_id', 'school_id');
    }

    /** Which administration a person belongs to for an election's handover. Someone on both sides counts as incoming. */
    public static function sideOf(int $schoolId, int $electionId): ?string
    {
        $kinds = static::query()
            ->where('election_id', $electionId)
            ->where('user_school_id', $schoolId)
            ->pluck('kind');

        return match (true) {
            $kinds->contains('incoming') => 'incoming',
            $kinds->contains('outgoing') => 'outgoing',
            default => null,
        };
    }
}
