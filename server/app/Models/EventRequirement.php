<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

class EventRequirement extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['allowed_extensions' => 'array', 'is_active' => 'boolean', 'is_optional' => 'boolean'];
    }

    public function scopeForPeriod(Builder $query, ?int $semesterId): Builder
    {
        return $query->where(fn (Builder $period) => $period->whereNull('academic_semester_id')
            ->orWhere('academic_semester_id', $semesterId));
    }

    public function scopeForEvent(Builder $query, Event $event): Builder
    {
        $venueType = data_get($event->planning_details, 'venue_type');

        return $query->forPeriod($event->academic_semester_id)
            ->when($venueType, fn (Builder $requirements) => $requirements
                ->whereIn('venue_type', ['all', $venueType]), fn (Builder $requirements) => $requirements->where('venue_type', 'all'));
    }

    public function scopeActiveForEvent(Builder $query, Event $event): Builder
    {
        return $query->forEvent($event)->where('is_active', true);
    }
}
