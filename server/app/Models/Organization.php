<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Organization extends Model
{
    use HasFactory;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
            'accredited_at' => 'datetime',
            'expires_at' => 'datetime',
        ];
    }

    public function users(): HasMany
    {
        return $this->hasMany(User::class);
    }

    public function administrators(): HasMany
    {
        return $this->hasMany(User::class)->where('role', 'ADMIN');
    }

    public function complianceRequirements(): HasMany
    {
        return $this->hasMany(OrganizationCompliance::class);
    }

    public function grievances(): HasMany
    {
        return $this->hasMany(Grievance::class);
    }
}
