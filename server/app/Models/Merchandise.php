<?php

namespace App\Models;

use Database\Factories\MerchandiseFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Merchandise extends Model
{
    /** @use HasFactory<MerchandiseFactory> */
    use HasFactory;

    protected $table = 'merchandise';

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'price' => 'decimal:2',
            'is_active' => 'boolean',
        ];
    }

    public function orders(): HasMany
    {
        return $this->hasMany(Order::class);
    }
}
