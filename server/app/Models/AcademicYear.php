<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class AcademicYear extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'starts_on' => 'date:Y-m-d',
            'ends_on' => 'date:Y-m-d',
            'is_current' => 'boolean',
            'closed_at' => 'datetime',
            'archived_at' => 'datetime',
        ];
    }

    public static function currentLabel(): ?string
    {
        return static::whereNull('archived_at')->where('is_current', true)->value('label');
    }

    /** Years the SAO archived to start a new setup. They stay readable in records but leave every current view. */
    public function scopeNotArchived(Builder $query): Builder
    {
        return $query->whereNull('archived_at');
    }

    /**
     * The labels of archived years, as a subquery, for queries that must not fall back to a year that was put away.
     * A label that a live year carries again is not archived: the live year owns it.
     */
    public static function archivedLabels(): Builder
    {
        return static::whereNotNull('archived_at')->whereNotIn('label', static::whereNull('archived_at')->select('label'))->select('label');
    }

    public function semesters(): HasMany
    {
        return $this->hasMany(AcademicSemester::class)->orderBy('number');
    }
}
