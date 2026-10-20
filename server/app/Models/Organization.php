<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Organization extends Model
{
    use HasFactory;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
            'is_university_wide' => 'boolean',
            'submitted_at' => 'datetime',
            'reviewed_at' => 'datetime',
            'archived_at' => 'datetime',
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
        return $this->lifecycle_status === 'active' && $this->collegeAllowsAccess();
    }

    public function collegeAllowsAccess(): bool
    {
        if ($this->is_university_wide) {
            return true;
        }
        if ($this->organization_type === 'SYSTEM_ADMINISTRATION' || (! $this->college_id && ! $this->getRawOriginal('college'))) {
            return true;
        }
        $college = $this->college_id
            ? ($this->relationLoaded('catalogCollege') ? $this->getRelation('catalogCollege') : College::withTrashed()->find($this->college_id))
            : College::withTrashed()->where('name', $this->getRawOriginal('college'))->first();

        return $college ? ($college->is_active && ! $college->trashed()) : ! $this->college_id;
    }

    public function catalogCollege(): BelongsTo
    {
        return $this->belongsTo(College::class, 'college_id')->withTrashed();
    }

    public function approvalRole(string $default): string
    {
        return $this->is_university_wide && $default === 'DEPARTMENT_HEAD' ? 'SUPER_ADMIN' : $default;
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
