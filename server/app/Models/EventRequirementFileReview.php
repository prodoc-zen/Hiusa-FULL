<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class EventRequirementFileReview extends Model
{
    public const STATUSES = ['ok', 'needs_changes'];

    protected $guarded = [];

    protected $hidden = ['reviewed_by'];
}
