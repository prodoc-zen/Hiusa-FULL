<?php

namespace App\Models;

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
        ];
    }

    public static function currentLabel(): ?string
    {
        return static::where('is_current', true)->value('label');
    }

    public function semesters(): HasMany
    {
        return $this->hasMany(AcademicSemester::class)->orderBy('number');
    }
}
