<?php

namespace App\Models;

use Database\Factories\ElectionApplicationFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ElectionApplication extends Model
{
    /** @use HasFactory<ElectionApplicationFactory> */
    use HasFactory;

    protected $guarded = [];

    // The private documents are opened through a protected endpoint, never by path.
    protected $hidden = ['coc_path', 'credentials_path'];

    protected function casts(): array
    {
        return [
            'rules_version' => 'integer',
            'rules_accepted_at' => 'datetime',
            'submitted_at' => 'datetime',
            'reviewed_at' => 'datetime',
        ];
    }

    public function election(): BelongsTo
    {
        return $this->belongsTo(Election::class);
    }

    public function position(): BelongsTo
    {
        return $this->belongsTo(ElectionPosition::class, 'position_id');
    }

    public function partylist(): BelongsTo
    {
        return $this->belongsTo(Partylist::class);
    }

    public function candidate(): BelongsTo
    {
        return $this->belongsTo(Candidate::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_school_id', 'school_id');
    }
}
