<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class College extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['is_active' => 'boolean'];
    }

    public function organizations(): HasMany
    {
        return $this->hasMany(Organization::class);
    }

    public function homeOrganization(): HasOne
    {
        return $this->hasOne(Organization::class)->where('organization_type', 'COLLEGE');
    }
}
