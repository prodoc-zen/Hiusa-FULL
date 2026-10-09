<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class OrganizationComplianceSubmission extends Model
{
    protected $fillable = [
        'organization_id',
        'requirement_type_id',
        'status',
        'file_path',
        'file_original_name',
        'mime_type',
        'file_size',
        'remarks',
        'submitted_by',
        'submitted_at',
        'reviewed_by',
        'reviewed_at',
    ];

    protected $hidden = ['file_path'];

    protected function casts(): array
    {
        return [
            'submitted_at' => 'datetime',
            'reviewed_at' => 'datetime',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function requirementType(): BelongsTo
    {
        return $this->belongsTo(ComplianceRequirementType::class, 'requirement_type_id');
    }

    public function submitter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'submitted_by', 'school_id');
    }

    public function reviewer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewed_by', 'school_id');
    }
}
