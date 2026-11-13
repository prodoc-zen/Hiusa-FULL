<?php

namespace App\Models;

use App\Services\ElectionHandoverService;
use App\Services\ElectionPhaseService;
use App\Services\ElectionResolutionService;
use App\Services\OfficerAppointmentService;
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
            'filing_starts_at' => 'datetime',
            'filing_ends_at' => 'datetime',
            'screening_starts_at' => 'datetime',
            'screening_ends_at' => 'datetime',
            'campaign_starts_at' => 'datetime',
            'campaign_ends_at' => 'datetime',
            'results_publish_at' => 'datetime',
            'runoff_starts_at' => 'datetime',
            'runoff_ends_at' => 'datetime',
            'runoff_publish_at' => 'datetime',
            'submitted_at' => 'datetime',
            'declined_at' => 'datetime',
            'suspended_at' => 'datetime',
            'cancelled_at' => 'datetime',
            'completed_at' => 'datetime',
            'rules_version' => 'integer',
            'tally_version' => 'integer',
            'min_gpa' => 'decimal:2',
            'min_units' => 'integer',
            'notices_sent' => 'array',
        ];
    }

    /** A filing election runs the full process; one without a filing window is the short form where the Admin adds candidates. */
    public function usesFiling(): bool
    {
        return $this->filing_starts_at !== null;
    }

    /** Suspended and cancelled elections pause every phase, filing window and ballot. */
    public function isHalted(): bool
    {
        return $this->suspended_at !== null || $this->cancelled_at !== null;
    }

    /** The ballot round that accepts votes right now: 1 inside the voting window, 2 inside the runoff window, otherwise null. */
    public function openRound(): ?int
    {
        if ($this->isHalted()) {
            return null;
        }

        $now = now();

        if ($this->status === 'active'
            && $this->approved_at !== null
            && $this->finalized_at !== null
            && $this->start_time !== null && $this->end_time !== null
            && $this->start_time->lte($now) && $this->end_time->gte($now)) {
            return 1;
        }

        if ($this->phase === 'runoff'
            && $this->runoff_starts_at !== null && $this->runoff_ends_at !== null
            && $this->runoff_starts_at->lte($now) && $this->runoff_ends_at->gte($now)) {
            return 2;
        }

        return null;
    }

    /**
     * Keep the persisted workflow status aligned with the approved voting
     * schedule. Closed elections stay closed so an administrator can still end
     * voting early without the scheduler reopening them. Only approved,
     * finalized ballots open, and only inside their voting window. A suspended
     * or cancelled election neither opens nor closes. Elections with a filing
     * window first move through their phases (ElectionPhaseService), which locks
     * the ballot when voting is due; a closed election then enters canvassing, where the resolution
     * service publishes, runs the runoff and the tie decision and completes it. Released winners then become officer
     * appointments, which start, and expire, on their own dates.
     *
     * @param  array<int>|null  $organizationIds  null covers every organization
     * @return array{opened: int, closed: int}
     */
    public static function synchronizeScheduledStatuses(?array $organizationIds = null, ?int $electionId = null): array
    {
        $phases = app(ElectionPhaseService::class);
        $phases->sync($organizationIds, $electionId);

        $now = now();
        $semesterId = AcademicSemester::active()?->id;
        $baseQuery = fn () => static::query()
            ->whereNotNull('approved_at')
            ->where(fn ($query) => $query->whereNull('academic_semester_id')->orWhere('academic_semester_id', $semesterId))
            ->when($organizationIds !== null, fn ($query) => $query->whereIn('organization_id', $organizationIds))
            ->when($electionId, fn ($query) => $query->whereKey($electionId));
        $running = fn () => $baseQuery()->whereNull('suspended_at')->whereNull('cancelled_at');

        // A filing election whose ballot was never locked never opened voting (pending reviews or no candidate held it),
        // so its end time closes nothing: there are no ballots to count and no results to publish.
        $closed = $running()
            ->whereIn('status', ['upcoming', 'active'])
            ->where(fn ($query) => $query->whereNull('filing_starts_at')->orWhereNotNull('finalized_at'))
            ->where('end_time', '<', $now)
            ->update(['status' => 'closed']);

        $opened = $running()
            ->where('status', 'upcoming')
            ->whereNotNull('finalized_at')
            ->where('start_time', '<=', $now)
            ->where('end_time', '>=', $now)
            ->update(['status' => 'active']);

        // Elections already counted under the earlier reading (tally version 1) keep no phase.
        $phases->enterCanvassing($baseQuery()
            ->where('status', 'closed')
            ->where('tally_version', 2)
            ->whereNull('cancelled_at')
            ->where(fn ($query) => $query->whereNull('phase')->orWhereIn('phase', ['scheduled', 'filing', 'screening', 'campaign', 'voting']))
            ->get());

        // Counting, publication, the runoff and the tie decision follow the closed election whatever semester is active.
        $resolution = app(ElectionResolutionService::class);
        static::query()
            ->where('status', 'closed')
            ->where('tally_version', 2)
            ->whereNotNull('approved_at')
            ->whereNull('cancelled_at')
            ->whereNull('suspended_at')
            ->whereNull('completed_at')
            ->when($organizationIds !== null, fn ($query) => $query->whereIn('organization_id', $organizationIds))
            ->when($electionId, fn ($query) => $query->whereKey($electionId))
            ->get()
            ->each(function (Election $election) use ($resolution) {
                try {
                    $resolution->advance($election);
                } catch (\Throwable $exception) {
                    // One election that cannot advance must not stop the others or break the request that triggered the sync.
                    report($exception);
                }
            });

        // Appointments, activation and expiry follow the closed election whatever semester is active (D-25).
        $service = app(ElectionHandoverService::class);
        static::query()
            ->where('status', 'closed')
            ->where('results_visible', true)
            ->whereNotNull('approved_at')
            ->whereNotNull('finalized_at')
            ->whereNull('access_handed_over_at')
            ->whereNull('cancelled_at')
            ->when($organizationIds !== null, fn ($query) => $query->whereIn('organization_id', $organizationIds))
            ->when($electionId, fn ($query) => $query->whereKey($electionId))
            ->get()
            ->each(function (Election $election) use ($service) {
                try {
                    $service->handOver($election);
                } catch (\Throwable $exception) {
                    report($exception);
                }
            });

        $appointments = app(OfficerAppointmentService::class);
        foreach (['schedule', 'activateDue', 'expireDue'] as $step) {
            try {
                $appointments->{$step}($electionId, $organizationIds);
            } catch (\Throwable $exception) {
                report($exception);
            }
        }

        return ['opened' => $opened, 'closed' => $closed];
    }

    /** The one rule for who may vote: the member was on the organization's voter roll when the ballot was finalized. */
    public function listsVoter(int $schoolId): bool
    {
        return AccountProfile::onVoterRoll($this->finalized_at)
            ->where('account_profiles.organization_id', $this->organization_id)
            ->where('account_profiles.user_school_id', $schoolId)
            ->exists();
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

    public function applications(): HasMany
    {
        return $this->hasMany(ElectionApplication::class);
    }

    public function ballots(): HasMany
    {
        return $this->hasMany(ElectionBallot::class);
    }

    public function ruleVersions(): HasMany
    {
        return $this->hasMany(ElectionRuleVersion::class);
    }

    public function appointments(): HasMany
    {
        return $this->hasMany(OfficerAppointment::class);
    }
}
