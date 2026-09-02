<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class AcademicProgram extends Model
{
    protected $fillable = ['organization_id', 'name'];

    public function sections(): HasMany
    {
        return $this->hasMany(AcademicSection::class)->orderBy('year_level')->orderBy('name');
    }
}
