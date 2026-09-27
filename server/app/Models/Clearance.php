<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Clearance extends Model
{
    use HasFactory;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'deadline' => 'datetime',
        ];
    }

    public function signatures(): HasMany
    {
        return $this->hasMany(ClearanceSignature::class);
    }
}
