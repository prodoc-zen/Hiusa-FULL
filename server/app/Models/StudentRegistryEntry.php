<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class StudentRegistryEntry extends Model
{
    protected $table = 'student_registry';

    protected $guarded = [];

    public const STUDENT = 'student';

    public const EMPLOYEE = 'employee';

    protected $hidden = ['birth_date'];

    protected function casts(): array
    {
        return ['birth_date' => 'date:Y-m-d', 'claimed_at' => 'datetime'];
    }

    public function scopeStudents(Builder $query): Builder
    {
        return $query->where('record_type', self::STUDENT);
    }

    public function scopeEmployees(Builder $query): Builder
    {
        return $query->where('record_type', self::EMPLOYEE);
    }

    public function college(): BelongsTo
    {
        return $this->belongsTo(College::class)->withTrashed();
    }

    public function getFullNameAttribute(): string
    {
        return trim($this->first_name.' '.$this->last_name);
    }
}
