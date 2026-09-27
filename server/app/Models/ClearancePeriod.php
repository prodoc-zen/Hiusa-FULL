<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ClearancePeriod extends Model
{
    protected $fillable = [
        'academic_year',
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
}
