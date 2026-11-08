<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class OrganizationApplication extends Model
{
    public const STATUSES = ['pending_dean', 'pending_sao', 'approved', 'returned', 'rejected'];

    /** Rows from the retired public form that never reached a dean. They stay readable and out of every queue. */
    public const LEGACY_UNQUEUED = ['pending_verification', 'expired'];

    protected $guarded = [];

    protected $hidden = ['edit_token_hash'];

    protected function casts(): array
    {
        return ['email_verified_at' => 'datetime', 'endorsed_at' => 'datetime', 'reviewed_at' => 'datetime', 'returned_at' => 'datetime', 'submitted_at' => 'datetime', 'requires_documents' => 'boolean', 'required_documents_count' => 'integer', 'round' => 'integer'];
    }

    public function college(): BelongsTo
    {
        return $this->belongsTo(College::class)->withTrashed();
    }

    public function applicant(): BelongsTo
    {
        return $this->belongsTo(User::class, 'school_id', 'school_id');
    }

    public function documents(): HasMany
    {
        return $this->hasMany(OrganizationApplicationDocument::class);
    }

    public function requirementReviews(): HasMany
    {
        return $this->hasMany(OrganizationApplicationRequirementReview::class);
    }

    public function reviewFiles(): HasMany
    {
        return $this->hasMany(OrganizationApplicationReviewFile::class);
    }
}
