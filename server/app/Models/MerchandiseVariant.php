<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class MerchandiseVariant extends Model
{
    protected $guarded = [];

    public function merchandise(): BelongsTo
    {
        return $this->belongsTo(Merchandise::class);
    }

    public function orders(): HasMany
    {
        return $this->hasMany(Order::class, 'merchandise_variant_id');
    }
}
