<?php

namespace App\Models;

use App\Services\ElectionHandoverService;
use Database\Factories\ElectionFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Election extends Model
{
    /** @use HasFactory<ElectionFactory> */
    use HasFactory;

    protected $guarded = [];

    protected $hidden = ['informative_letter_path'];

    protected $appends = ['has_informative_letter'];

    public function getHasInformativeLetterAttribute(): bool
    {
        return filled($this->informative_letter_path);
    }

    protected function casts(): array
    {
        return [
            'start_time' => 'datetime',
            'end_time' => 'datetime',
            'approved_at' => 'datetime',
            'finalized_at' => 'datetime',
            'results_visible' => 'boolean',
        ];
    }

    /**
     * Keep the persisted workflow status aligned with the approved voting
     * schedule. Closed elections stay closed so an administrator can still end
     * voting early without the scheduler reopening them. Only approved,
     * finalized ballots open, and only inside their voting window.
     *
     * @param  array<int>|null  $organizationIds  null covers every organization
     * @return array{opened: int, closed: int}
     */
    public static function synchronizeScheduledStatuses(?array $organizationIds = null, ?int $electionId = null): array
    {
        $now = now();
        $semesterId = AcademicSemester::active()?->id;
        $baseQuery = fn () => static::query()
            ->whereNotNull('approved_at')
            ->where(fn ($query) => $query->whereNull('academic_semester_id')->orWhere('academic_semester_id', $semesterId))
            ->when($organizationIds !== null, fn ($query) => $query->whereIn('organization_id', $organizationIds))
            ->when($electionId, fn ($query) => $query->whereKey($electionId));

        $closed = $baseQuery()
            ->whereIn('status', ['upcoming', 'active'])
            ->where('end_time', '<', $now)
            ->update(['status' => 'closed']);

        $opened = $baseQuery()
            ->where('status', 'upcoming')
            ->whereNotNull('finalized_at')
            ->where('start_time', '<=', $now)
            ->where('end_time', '>=', $now)
            ->update(['status' => 'active']);

        $service = app(ElectionHandoverService::class);
        $baseQuery()
            ->where('status', 'closed')
            ->where('results_visible', true)
            ->whereNotNull('finalized_at')
            ->whereNull('access_handed_over_at')
            ->get()
            ->each(fn (Election $election) => $service->handOver($election));

        return ['opened' => $opened, 'closed' => $closed];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function positions(): HasMany
    {
        return $this->hasMany(ElectionPosition::class)->orderBy('id');
    }

    public function candidates(): HasMany
    {
        return $this->hasMany(Candidate::class);
    }

    public function votes(): HasMany
    {
        return $this->hasMany(Vote::class);
    }
}
