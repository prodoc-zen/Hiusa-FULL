<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ClearancePeriod extends Model
{
    protected $fillable = [
        'academic_year',
        'academic_year_id',
        'title',
        'description',
        'required_roles',
        'deadline_at',
        'created_by',
    ];

    protected function casts(): array
    {
        return [
            'required_roles' => 'array',
            'deadline_at' => 'datetime',
        ];
    }

    public function signatures(): HasMany
    {
        return $this->hasMany(ClearanceSignature::class);
    }

    /** Periods opened for a year the SAO archived. A label archived and added again names a different year, so the year id decides, not the label. */
    public function scopeInArchivedYear(Builder $query): Builder
    {
        return $query->whereIn('clearance_periods.academic_year_id', AcademicYear::whereNotNull('archived_at')->select('id'));
    }

    public function scopeNotInArchivedYear(Builder $query): Builder
    {
        return $query->where(fn (Builder $live) => $live->whereNull('clearance_periods.academic_year_id')
            ->orWhereNotIn('clearance_periods.academic_year_id', AcademicYear::whereNotNull('archived_at')->select('id')));
    }

    public function isInArchivedYear(): bool
    {
        return $this->academic_year_id !== null && AcademicYear::whereKey($this->academic_year_id)->whereNotNull('archived_at')->exists();
    }
}
