<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class OrganizationApplicationDocument extends Model
{
    protected $guarded = [];

    protected $hidden = ['file_path'];

    public function requirementType(): BelongsTo
    {
        return $this->belongsTo(ComplianceRequirementType::class, 'requirement_type_id');
    }
}
