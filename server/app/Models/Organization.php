<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
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

    public function scopeStudent(Builder $query): Builder
    {
        return $query->where('organization_type', 'STUDENT_ORGANIZATION');
    }

    public function isArchived(): bool
    {
        return $this->lifecycle_status === 'archived';
    }

    public function isWritable(): bool
    {
        return $this->lifecycle_status === 'active';
    }

    public function college(): BelongsTo
    {
        return $this->belongsTo(College::class);
    }

    public function collegeHomeOrganization(): HasOne
    {
        return $this->hasOne(Organization::class, 'college_id', 'college_id')->where('organization_type', 'COLLEGE');
    }

    public function users(): HasMany
    {
        return $this->hasMany(User::class);
    }

    public function accountProfiles(): HasMany
    {
        return $this->hasMany(AccountProfile::class);
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
