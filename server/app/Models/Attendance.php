<?php

namespace App\Models;

use Database\Factories\AttendanceFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Attendance extends Model
{
    /** @use HasFactory<AttendanceFactory> */
    use HasFactory;

    protected $table = 'attendance';

    public $timestamps = false;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'check_in_time' => 'datetime',
            'check_out_time' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        // Both the manual (EventController::recordAttendance) and biometric
        // (FingerprintController::confirmAttendance) check-in paths create an
        // Attendance row here, so this is the one place that reliably sees
        // every check-in without duplicating the "mark attended" logic in both.
        static::created(function (Attendance $attendance): void {
            if (in_array($attendance->status ?? 'present', ['present', 'late'], true)) {
                EventRegistration::where('event_id', $attendance->event_id)
                    ->where('user_id', $attendance->user_id)
                    ->where('status', 'registered')
                    ->update(['status' => 'attended']);
            }
        });
    }

    public function event(): BelongsTo
    {
        return $this->belongsTo(Event::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id', 'school_id');
    }

    public function recorder(): BelongsTo
    {
        return $this->belongsTo(User::class, 'recorded_by', 'school_id');
    }
}
