<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class EvaluationResponse extends Model
{
    protected $fillable = [
        'evaluation_window_id',
        'organization_id',
        'user_id',
        'respondent_type',
        'consent_given_at',
        'profile',
        'answers',
        'feedback',
        'submitted_at',
    ];

    protected function casts(): array
    {
        return [
            'consent_given_at' => 'datetime',
            'profile' => 'array',
            'answers' => 'array',
            'submitted_at' => 'datetime',
        ];
    }

    public function window(): BelongsTo
    {
        return $this->belongsTo(EvaluationWindow::class, 'evaluation_window_id');
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function respondent(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id', 'school_id');
    }
}
