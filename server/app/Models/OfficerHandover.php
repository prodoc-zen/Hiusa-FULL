<?php

namespace App\Models;

use Database\Factories\OfficerHandoverFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class OfficerHandover extends Model
{
    /** @use HasFactory<OfficerHandoverFactory> */
    use HasFactory;

    /** The six handover items and the page each one points to by default. */
    public const CATEGORIES = [
        'finance' => '/dashboard/finance',
        'events' => '/dashboard/events',
        'tasks' => '/dashboard/tasks',
        'organization' => '/dashboard/records',
        'election' => '/dashboard/elections/election-results',
        'compliance' => '/dashboard/compliance',
    ];

    protected $guarded = [];

    // The attachment is private and opened through a protected endpoint, never by path.
    protected $hidden = ['attachment_path'];

    protected function casts(): array
    {
        return [
            'prepared_at' => 'datetime',
            'acknowledged_at' => 'datetime',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function election(): BelongsTo
    {
        return $this->belongsTo(Election::class);
    }

    /** Create the six handover rows for an election once. Rows that already exist are left as they are. */
    public static function ensureFor(Election $election): void
    {
        $academicYear = $election->academic_semester_id
            ? AcademicSemester::with('academicYear')->find($election->academic_semester_id)?->academicYear?->label
            : null;

        foreach (self::CATEGORIES as $category => $referenceUrl) {
            static::query()->firstOrCreate(
                ['election_id' => $election->id, 'category' => $category],
                [
                    'organization_id' => $election->organization_id,
                    'academic_year' => $academicYear,
                    'reference_url' => $referenceUrl,
                    'status' => 'pending',
                ],
            );
        }
    }
}
