<?php

namespace App\Services;

use App\Models\AcademicSemester;
use App\Models\AccountProfile;
use App\Models\AuditLog;
use App\Models\Candidate;
use App\Models\Election;
use App\Models\ElectionApplication;
use App\Models\ElectionBallot;
use App\Models\Notification;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Moves an election with a filing window through its phases from the schedule, up to the close of voting. A phase that
 * cannot safely start leaves the election where it is and tells the organization's Admins once per cause. The phases
 * only move forward, and a suspended or cancelled election does not move at all.
 */
class ElectionPhaseService
{
    /** Phases before canvassing, in order. */
    private const ORDER = ['scheduled', 'filing', 'screening', 'campaign', 'voting'];

    public const CORRECTIONS_NOT_COMPLETED = 'Corrections were not completed before screening closed';

    public const NOT_SUBMITTED = 'Not submitted before filing closed';

    public function __construct(private readonly OrganizationRecipients $recipients) {}

    /** @param  array<int>|null  $organizationIds  null covers every organization */
    public function sync(?array $organizationIds = null, ?int $electionId = null): void
    {
        $semesterId = AcademicSemester::active()?->id;

        Election::query()
            ->whereNotNull('approved_at')
            ->whereNull('suspended_at')
            ->whereNull('cancelled_at')
            ->whereNotNull('filing_starts_at')
            ->whereIn('status', ['upcoming', 'active'])
            ->where(fn ($query) => $query->whereNull('academic_semester_id')->orWhere('academic_semester_id', $semesterId))
            ->when($organizationIds !== null, fn ($query) => $query->whereIn('organization_id', $organizationIds))
            ->when($electionId, fn ($query) => $query->whereKey($electionId))
            ->pluck('id')
            ->each(function ($id) {
                try {
                    DB::transaction(fn () => $this->advance((int) $id));
                } catch (\Throwable $exception) {
                    // One election that cannot advance must not stop the others or break the request that triggered the sync.
                    report($exception);
                }
            });
    }

    /** An election that has just closed enters canvassing; the counting itself belongs to the next stage. */
    public function enterCanvassing(Collection $elections): void
    {
        foreach ($elections as $election) {
            DB::transaction(function () use ($election) {
                $locked = Election::query()->lockForUpdate()->find($election->id);

                if ($locked === null || $locked->status !== 'closed' || $locked->cancelled_at !== null || $locked->phase === 'canvassing') {
                    return;
                }

                $this->changePhase($locked, 'canvassing');
            });
        }
    }

    private function advance(int $id): void
    {
        $election = Election::query()->lockForUpdate()->find($id);
        $now = now();

        if ($election === null || $election->isHalted() || $election->approved_at === null
            || ! in_array($election->status, ['upcoming', 'active'], true) || ! $election->usesFiling()
            || ($election->end_time !== null && $now->gte($election->end_time))) {
            return;
        }

        $current = $election->phase;
        $target = $current;
        $alert = null;

        if ($current === 'voting' && $election->finalized_at !== null) {
            $target = 'voting';
        } elseif ($now->lt($election->filing_starts_at)) {
            $target = 'scheduled';
        } elseif ($now->lt($election->filing_ends_at)) {
            $target = 'filing';
        } else {
            $this->withdrawDrafts($election);

            if ($election->screening_ends_at !== null && $now->gte($election->screening_ends_at)) {
                $this->rejectUnansweredCorrections($election);
            }

            $target = 'screening';
            $votingDue = $election->start_time !== null && $now->gte($election->start_time);

            if ($election->campaign_starts_at !== null && $now->gte($election->campaign_starts_at)) {
                $pending = ElectionApplication::where('election_id', $election->id)->where('status', 'pending_review')->count();

                if ($pending > 0) {
                    $count = $pending === 1 ? '1 application still needs a decision.' : "{$pending} applications still need a decision.";
                    $alert = ($votingDue ? 'Voting cannot open: ' : 'Screening is not finished: ').$count;
                } else {
                    $target = 'campaign';

                    if ($votingDue) {
                        if ($this->hasApprovedCandidate($election)) {
                            $target = 'voting';
                        } else {
                            $alert = 'Voting cannot open: no approved candidate on any active position.';
                        }
                    }
                }
            }
        }

        // Phases never move backward: a held election keeps the furthest phase it reached.
        if ($current !== null && $this->rank($target) < $this->rank($current)) {
            $target = $current;
        }

        if ($target === 'voting' && $election->finalized_at === null) {
            $election->forceFill(['finalized_at' => $now])->save();
            $this->audit($election, 'ballot_locked', null, ['finalized_at' => $now->toDateTimeString()]);
        }

        if ($target !== $current) {
            $this->changePhase($election, $target);
        }

        $this->recordAlert($election, $alert);
        $this->sendDeadlineNotices($election, $now);
    }

    private function rank(?string $phase): int
    {
        $index = array_search($phase, self::ORDER, true);

        return $index === false ? -1 : $index;
    }

    private function hasApprovedCandidate(Election $election): bool
    {
        return Candidate::where('election_id', $election->id)
            ->whereIn('position_id', $election->positions()->where('is_active', true)->select('id'))
            ->exists();
    }

    private function changePhase(Election $election, string $to): void
    {
        $from = $election->phase;
        $election->forceFill(['phase' => $to])->save();
        $this->audit($election, 'phase_changed', null, ['from' => $from, 'to' => $to]);

        if ($to === 'filing') {
            $this->notifyMembers(
                $election,
                $this->votingMembers($election),
                'Candidacy filing is open',
                'Filing for "'.$election->title.'" is open until '.$this->when($election->filing_ends_at).'. Read the rules and file your candidacy.',
            );
        }

        if ($to === 'voting') {
            $this->notifyMembers(
                $election,
                $this->votingMembers($election),
                'Voting is open',
                '"'.$election->title.'" is open for voting until '.$this->when($election->end_time).'.',
            );
        }
    }

    /**
     * The alert text is stored, so a cause is announced once and only a different cause announces again. The live count
     * is not part of the cause: a screening decision while the election is held refreshes the stored text and tells nobody.
     */
    private function recordAlert(Election $election, ?string $alert): void
    {
        if ($alert === $election->phase_alert) {
            return;
        }

        $sameCause = $alert !== null && $election->phase_alert !== null
            && $this->alertCause($alert) === $this->alertCause($election->phase_alert);

        $election->forceFill(['phase_alert' => $alert])->save();

        if ($sameCause) {
            return;
        }

        if ($alert === null) {
            return;
        }

        $this->audit($election, 'phase_alert', null, ['alert' => $alert]);
        $this->notifyMembers($election, $this->recipients->administrators($election->organization_id)->pluck('user_school_id'), 'Election needs attention', $alert);
    }

    /** The alert with its count of waiting applications removed, so '2 applications' and '1 application' are one cause. */
    private function alertCause(string $alert): string
    {
        return preg_replace('/\d{1,6} applications? still needs? a decision\./', 'applications still need a decision.', $alert) ?? $alert;
    }

    private function sendDeadlineNotices(Election $election, Carbon $now): void
    {
        $sent = $election->notices_sent ?? [];

        if ($election->phase === 'filing' && ! isset($sent['filing_closing']) && $now->gte($election->filing_ends_at->copy()->subDay())) {
            $sent['filing_closing'] = $now->toDateTimeString();
            $election->forceFill(['notices_sent' => $sent])->save();
            $this->notifyMembers(
                $election,
                $this->votingMembers($election),
                'Candidacy filing closes soon',
                'Filing for "'.$election->title.'" closes '.$this->when($election->filing_ends_at).'.',
            );
        }

        if ($election->phase === 'voting' && ! isset($sent['voting_closing']) && $now->gte($election->end_time->copy()->subDay())) {
            $sent['voting_closing'] = $now->toDateTimeString();
            $election->forceFill(['notices_sent' => $sent])->save();

            $waiting = AccountProfile::onVoterRoll($election->finalized_at)
                ->where('account_profiles.organization_id', $election->organization_id)
                ->whereNotIn('account_profiles.user_school_id', ElectionBallot::where('election_id', $election->id)->where('round', 1)->select('voter_id'))
                ->distinct()
                ->pluck('account_profiles.user_school_id');

            $this->notifyMembers(
                $election,
                $waiting,
                'Voting closes soon',
                'Voting in "'.$election->title.'" closes '.$this->when($election->end_time).'. You have not voted yet.',
            );
        }
    }

    private function withdrawDrafts(Election $election): void
    {
        $drafts = ElectionApplication::where('election_id', $election->id)->where('status', 'draft')->get(['id']);

        if ($drafts->isEmpty()) {
            return;
        }

        ElectionApplication::whereIn('id', $drafts->pluck('id'))->where('status', 'draft')
            ->update(['status' => 'withdrawn', 'review_notes' => self::NOT_SUBMITTED, 'updated_at' => now()]);

        $this->audit($election, 'application_withdrawn', null, ['application_ids' => $drafts->pluck('id')->all(), 'reason' => self::NOT_SUBMITTED]);
    }

    private function rejectUnansweredCorrections(Election $election): void
    {
        $applications = ElectionApplication::with('position:id,title')
            ->where('election_id', $election->id)->where('status', 'for_revision')->get();

        foreach ($applications as $application) {
            $application->forceFill([
                'status' => 'rejected',
                'review_notes' => self::CORRECTIONS_NOT_COMPLETED,
                'reviewed_at' => now(),
            ])->save();

            $this->audit($election, 'application_auto_rejected', ['status' => 'for_revision'], [
                'application_id' => $application->id,
                'status' => 'rejected',
                'reason' => self::CORRECTIONS_NOT_COMPLETED,
            ]);

            $recipients = collect([$application->user_school_id, $application->submitted_by])->filter()->unique()->values();

            $this->notifyMembers(
                $election,
                $recipients,
                'Your candidacy was not accepted',
                'Your application for '.($application->position?->title ?? 'a position').' in "'.$election->title.'" was not accepted. '.self::CORRECTIONS_NOT_COMPLETED.'.',
            );
        }
    }

    /** @return Collection<int, int> */
    private function votingMembers(Election $election): Collection
    {
        return AccountProfile::votingMembers()
            ->where('account_profiles.organization_id', $election->organization_id)
            ->distinct()
            ->pluck('account_profiles.user_school_id');
    }

    /** One notice per person, written in chunks of 500. */
    private function notifyMembers(Election $election, Collection $schoolIds, string $title, string $message): void
    {
        $now = now();

        foreach ($schoolIds->unique()->values()->chunk(500) as $chunk) {
            Notification::insert($chunk->map(fn ($schoolId) => [
                'organization_id' => $election->organization_id,
                'user_id' => $schoolId,
                'title' => $title,
                'message' => $message,
                'notification_type' => 'election',
                'reference_type' => 'election',
                'reference_id' => $election->id,
                'is_read' => false,
                'sent_at' => $now,
                'created_at' => $now,
                'updated_at' => $now,
            ])->all());
        }
    }

    private function when(?Carbon $moment): string
    {
        return $moment?->format('M j, Y g:i A') ?? '';
    }

    private function audit(Election $election, string $action, ?array $old, ?array $new): void
    {
        AuditLog::create([
            'organization_id' => $election->organization_id,
            'user_id' => null,
            'module' => 'elections',
            'action' => $action,
            'record_type' => Election::class,
            'record_id' => $election->id,
            'old_values' => $old,
            'new_values' => $new,
            'ip_address' => null,
            'created_at' => now(),
        ]);
    }
}
