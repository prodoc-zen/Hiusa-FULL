<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class Grievance extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'organization_id',
        'submitted_by',
        'is_anonymous',
        'title',
        'description',
        'category',
        'urgency',
        'classification_confidence',
        'classification_reasoning',
        'classification_engine',
        'status',
        'remarks',
        'resolved_at',
    ];

    protected function casts(): array
    {
        return [
            'is_anonymous' => 'boolean',
            'classification_confidence' => 'float',
            'resolved_at' => 'datetime',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function submitter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'submitted_by', 'school_id');
    }
}
