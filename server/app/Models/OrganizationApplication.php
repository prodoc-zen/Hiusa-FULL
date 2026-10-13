<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class OrganizationApplication extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['email_verified_at' => 'datetime', 'endorsed_at' => 'datetime', 'reviewed_at' => 'datetime'];
    }

    public function college(): BelongsTo
    {
        return $this->belongsTo(College::class)->withTrashed();
    }
}
