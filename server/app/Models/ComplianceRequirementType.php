<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ComplianceRequirementType extends Model
{
    protected $hidden = ['template_path'];

    public const SEMESTRAL_ACCOMPLISHMENT_REPORT = 'Semestral Accomplishment Report';

    public const SUPPORTED_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx', 'xls', 'xlsx'];

    protected $fillable = [
        'category',
        'academic_year',
        'academic_semester_id',
        'name',
        'description',
        'allowed_extensions',
        'template_path',
        'template_original_name',
        'template_url',
        'deadline_at',
        'is_active',
        'created_by',
    ];

    protected static function booted(): void
    {
        static::creating(function (self $type) {
            $type->category ??= $type->name === self::SEMESTRAL_ACCOMPLISHMENT_REPORT ? 'semestral_report' : 'organization';
        });
    }

    protected function casts(): array
    {
        return [
            'deadline_at' => 'datetime',
            'allowed_extensions' => 'array',
            'is_active' => 'boolean',
        ];
    }

    public function acceptedExtensions(): array
    {
        if ($this->allowed_extensions) {
            return $this->allowed_extensions;
        }

        return $this->academic_semester_id && $this->category !== 'semestral_report'
            ? ['pdf']
            : self::SUPPORTED_EXTENSIONS;
    }

    public function uploadRules(): array
    {
        $extensions = implode(',', $this->acceptedExtensions());

        return ['file', 'mimes:'.$extensions, 'extensions:'.$extensions, 'max:10240'];
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
