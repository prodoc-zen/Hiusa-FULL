<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class OrganizationApplicationRequirementReview extends Model
{
    public const STATUSES = ['ok', 'missing', 'needs_changes'];

    protected $guarded = [];
}
