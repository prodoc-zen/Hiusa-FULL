<?php

namespace App\Models\Concerns;

use DateTimeInterface;
use Illuminate\Support\Carbon;

/**
 * Dates leave the API in Manila time with their offset (2026-10-06T00:30:00+08:00)
 * instead of UTC. The client reads the first ten characters as the calendar
 * date, and in UTC every date before 8 AM Manila time reads a day early.
 */
trait SerializesLocalDates
{
    protected function serializeDate(DateTimeInterface $date): string
    {
        return Carbon::instance($date)->setTimezone(config('app.timezone'))->toIso8601String();
    }
}
