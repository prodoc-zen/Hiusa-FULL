<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ComplianceRequirementType extends Model
{
    public const SEMESTRAL_ACCOMPLISHMENT_REPORT = 'Semestral Accomplishment Report';

    protected $fillable = [
        'academic_year',
        'academic_semester_id',
        'name',
        'description',
        'deadline_at',
        'is_active',
        'created_by',
    ];

    protected function casts(): array
    {
        return [
            'deadline_at' => 'datetime',
            'is_active' => 'boolean',
        ];
    }

    public function submissions(): HasMany
    {
        return $this->hasMany(OrganizationComplianceSubmission::class, 'requirement_type_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by', 'school_id');
    }
}
