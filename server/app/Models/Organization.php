<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Organization extends Model
{
    use HasFactory;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
        ];
    }

    public function users(): HasMany
    {
        return $this->hasMany(User::class);
    }

    public function parentOrganization(): BelongsTo
    {
        return $this->belongsTo(Organization::class, 'parent_organization_id');
    }

    public function suborganizations(): HasMany
    {
        return $this->hasMany(Organization::class, 'parent_organization_id');
    }

    public function administrators(): HasMany
    {
        return $this->hasMany(User::class)->where('role', 'ADMIN');
    }
}
