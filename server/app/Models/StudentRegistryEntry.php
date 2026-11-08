<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class StudentRegistryEntry extends Model
{
    protected $table = 'student_registry';

    protected $guarded = [];

    protected $hidden = ['birth_date'];

    protected function casts(): array
    {
        return ['birth_date' => 'date:Y-m-d', 'claimed_at' => 'datetime'];
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
