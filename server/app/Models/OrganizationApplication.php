<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class OrganizationApplication extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['email_verified_at' => 'datetime', 'endorsed_at' => 'datetime', 'reviewed_at' => 'datetime', 'requires_documents' => 'boolean', 'required_documents_count' => 'integer'];
    }

    public function college(): BelongsTo
    {
        return $this->belongsTo(College::class)->withTrashed();
    }

    public function documents(): HasMany
    {
        return $this->hasMany(OrganizationApplicationDocument::class);
    }
}
