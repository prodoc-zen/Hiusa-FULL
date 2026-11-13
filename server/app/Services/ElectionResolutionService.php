<?php

namespace App\Services;

use App\Models\AccountProfile;
use App\Models\AuditLog;
use App\Models\Election;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Everything after voting closes: canvassing, publication at the scheduled moment, the one runoff, a tie the runoff
 * could not break, and completion. A closed election counted under the earlier reading (tally version 1), a cancelled
 * one and a suspended one are left alone. Each notice is sent once, tracked in elections.notices_sent.
 */
class ElectionResolutionService
{
    public function __construct(
        private readonly ElectionTallyService $tally,
        private readonly OrganizationRecipients $recipients,
    ) {}

    /** Brings one closed election up to date with the clock and the votes. Safe to run on every sync. */
    public function advance(Election $election): void
    {
        DB::transaction(function () use ($election) {
            $locked = Election::query()->lockForUpdate()->find($election->id);

            if ($locked === null || $locked->status !== 'closed' || $locked->cancelled_at !== null || $locked->suspended_at !== null
                || $locked->completed_at !== null || (int) $locked->tally_version !== 2) {
                return;
            }

            $rows = $this->tally->standings($locked);
            $this->record($rows);

            if (! in_array($locked->phase, ['canvassing', 'runoff', 'tie_resolution'], true)) {
                $this->changePhase($locked, 'canvassing');
            }

            $this->publish($locked);

            $unresolved = $rows->filter(fn (array $row) => in_array($row['status'], ElectionTallyService::UNRESOLVED, true));
            $titlesOf = fn (string $status) => $unresolved->where('status', $status)->map(fn (array $row) => $row['position']->title)->values();

            if ($titlesOf('runoff_required')->isNotEmpty()) {
                $this->once($locked, 'runoff_needed', fn () => $this->notify(
                    $locked,
                    $this->administratorIds($locked),
                    'Runoff needed',
                    'A runoff is needed for '.$titlesOf('runoff_required')->implode(', ').'. Set the runoff schedule.',
                ));
            }

            if ($titlesOf('runoff_voting')->isNotEmpty()) {
                $this->changePhase($locked, 'runoff');
            } elseif ($titlesOf('tie_pending')->isNotEmpty()) {
                $this->changePhase($locked, 'tie_resolution');
                $this->once($locked, 'tie_pending', fn () => $this->notifyReviewers(
                    $locked,
                    'Tie needs a decision',
                    'A tie in "'.$locked->title.'" survived the runoff. Choose the winner for '.$titlesOf('tie_pending')->implode(', ').'.',
                ));
            } elseif ($unresolved->isNotEmpty()) {
                $this->changePhase($locked, 'canvassing');
            } else {
                $this->settle($locked, $rows->contains(fn (array $row) => $row['runoff'] !== null));
            }
        });
    }

    /**
     * Stores the Admin's one runoff schedule. The dates were checked by the caller. Returns the reason it cannot be
     * scheduled, or null when it was saved.
     */
    public function scheduleRunoff(Election $election, Carbon $starts, Carbon $ends, Carbon $publish, User $actor, ?string $ip): ?string
    {
        $refusal = null;

        DB::transaction(function () use ($election, $starts, $ends, $publish, $actor, $ip, &$refusal) {
            $locked = Election::query()->lockForUpdate()->find($election->id);

            if ($locked === null || $locked->status !== 'closed' || (int) $locked->tally_version !== 2 || $locked->isHalted() || $locked->completed_at !== null) {
                $refusal = 'This election has no runoff to schedule.';

                return;
            }

            if ($locked->runoff_starts_at !== null && $locked->runoff_starts_at->lte(now())) {
                $refusal = 'The runoff has already started and can no longer be changed.';

                return;
            }

            $waiting = $this->tally->standings($locked)->filter(fn (array $row) => in_array($row['status'], ['runoff_required', 'runoff_scheduled'], true));

            if ($waiting->isEmpty()) {
                $refusal = 'No position needs a runoff.';

                return;
            }

            $locked->forceFill(['runoff_starts_at' => $starts, 'runoff_ends_at' => $ends, 'runoff_publish_at' => $publish])->save();
            $positions = $waiting->map(fn (array $row) => $row['position']->title)->values();

            $this->audit($locked, 'runoff_scheduled', $actor->school_id, $ip, [
                'positions' => $positions->all(),
                'runoff_starts_at' => $locked->runoff_starts_at->toDateTimeString(),
                'runoff_ends_at' => $locked->runoff_ends_at->toDateTimeString(),
                'runoff_publish_at' => $locked->runoff_publish_at->toDateTimeString(),
            ]);

            $this->notify(
                $locked,
                $this->votingMemberIds($locked)->merge($this->administratorIds($locked)),
                'Runoff scheduled',
                'A runoff for '.$positions->implode(', ').' in "'.$locked->title.'" opens '.$this->when($locked->runoff_starts_at).' and closes '.$this->when($locked->runoff_ends_at).'.',
            );
        });

        if ($refusal === null) {
            $this->advance($election);
        }

        return $refusal;
    }

    /**
     * The reviewer's choice for a tie the runoff could not break. Only candidates still tied, for exactly the seats left.
     * Returns the reason it cannot be settled, or null when it was saved; a wrong choice throws a validation error.
     *
     * @param  array<int, int>  $winnerIds
     */
    public function resolveTie(Election $election, int $positionId, array $winnerIds, string $explanation, ?string $ruleUsed, User $actor, ?string $ip): ?string
    {
        $refusal = null;

        DB::transaction(function () use ($election, $positionId, $winnerIds, $explanation, $ruleUsed, $actor, $ip, &$refusal) {
            $locked = Election::query()->lockForUpdate()->find($election->id);
            $row = $locked === null || $locked->isHalted() || $locked->status !== 'closed' || (int) $locked->tally_version !== 2
                ? null
                : $this->tally->standings($locked)->first(fn (array $candidate) => $candidate['position']->id === $positionId);

            if ($row === null || $row['status'] !== 'tie_pending') {
                $refusal = 'This position is not waiting for a tie decision.';

                return;
            }

            $tiedIds = $row['tied']->pluck('id')->map(fn ($id) => (int) $id)->all();
            $chosen = array_values(array_unique(array_map('intval', $winnerIds)));

            if (array_diff($chosen, $tiedIds) !== [] || count($chosen) !== $row['open_seats']) {
                throw ValidationException::withMessages([
                    'winner_candidate_ids' => [
                        'Choose exactly '.$row['open_seats'].' of the '.count($tiedIds).' candidates who are still tied.',
                    ],
                ]);
            }

            $rule = filled($locked->tie_break_rule) ? $locked->tie_break_rule : $ruleUsed;
            $position = $row['position'];
            $position->forceFill([
                'resolved_winner_ids' => $chosen,
                'tie_rule_used' => $rule,
                'tie_explanation' => $explanation,
                'tie_resolved_by' => $actor->school_id,
                'tie_resolved_at' => now(),
                'result_status' => 'resolved',
            ])->save();

            $this->audit($locked, 'tie_resolved', $actor->school_id, $ip, [
                'position_id' => $position->id,
                'position' => $position->title,
                'tied_candidate_ids' => $tiedIds,
                'winner_candidate_ids' => $chosen,
                'rule_used' => $rule,
                'explanation' => $explanation,
            ]);

            $this->notify(
                $locked,
                $this->administratorIds($locked),
                'Tie resolved',
                'The tie for '.$position->title.' in "'.$locked->title.'" was settled by the reviewer.',
            );
        });

        if ($refusal === null) {
            $this->advance($election);
        }

        return $refusal;
    }

    /** Keeps each position's stored result and its round 1 tie in step with the count. */
    private function record(Collection $rows): void
    {
        foreach ($rows as $row) {
            $position = $row['position'];
            $changes = [];

            if ($position->result_status !== $row['status']) {
                $changes['result_status'] = $row['status'];
            }

            if ($row['runoff'] !== null && $position->runoff_candidate_ids === null) {
                $changes['runoff_candidate_ids'] = $row['runoff']['candidate_ids'];
                $changes['runoff_seats'] = $row['runoff']['seats'];
            }

            if ($changes !== []) {
                $position->forceFill($changes)->save();
            }
        }
    }

    /** A filing election publishes at results_publish_at (at close when none is set); a legacy election is already visible. */
    private function publish(Election $election): void
    {
        if ($election->results_visible || ! $election->usesFiling()) {
            return;
        }

        $moment = $election->results_publish_at ?? $election->end_time;

        if ($moment === null || now()->lt($moment)) {
            return;
        }

        $election->forceFill(['results_visible' => true])->save();
        $this->audit($election, 'results_published', null, null, ['results_publish_at' => $moment->toDateTimeString()]);

        $this->once($election, 'results_published', fn () => $this->notify(
            $election,
            $this->votingMemberIds($election)->merge($this->administratorIds($election)),
            'Results published',
            'The results of "'.$election->title.'" are now available.',
        ));
    }

    /** Nothing is left to settle: complete once the results, and any runoff outcome, are public. */
    private function settle(Election $election, bool $hadRunoff): void
    {
        $published = $election->results_visible
            && ! ($election->usesFiling() && now()->lt($election->results_publish_at ?? $election->end_time))
            && (! $hadRunoff || $election->runoff_publish_at === null || now()->gte($election->runoff_publish_at));

        if (! $published) {
            $this->changePhase($election, 'canvassing');

            return;
        }

        $this->changePhase($election, 'completed');
        $election->forceFill(['completed_at' => now()])->save();
        $this->audit($election, 'election_completed', null, null, ['completed_at' => now()->toDateTimeString()]);
    }

    private function changePhase(Election $election, string $to): void
    {
        if ($election->phase === $to) {
            return;
        }

        $from = $election->phase;
        $election->forceFill(['phase' => $to])->save();
        $this->audit($election, 'phase_changed', null, null, ['from' => $from, 'to' => $to]);
    }

    /** Runs the notice the first time only; the key is stored on the election so the every-minute sync never repeats it. */
    private function once(Election $election, string $key, callable $send): void
    {
        $sent = $election->notices_sent ?? [];

        if (isset($sent[$key])) {
            return;
        }

        $sent[$key] = now()->toDateTimeString();
        $election->forceFill(['notices_sent' => $sent])->save();
        $send();
    }

    /** @return Collection<int, int> */
    private function administratorIds(Election $election): Collection
    {
        return $this->recipients->administrators($election->organization_id)->pluck('user_school_id');
    }

    /** @return Collection<int, int> */
    private function votingMemberIds(Election $election): Collection
    {
        return AccountProfile::votingMembers()
            ->where('account_profiles.organization_id', $election->organization_id)
            ->distinct()
            ->pluck('account_profiles.user_school_id');
    }

    /** Who decides this organization's elections: the college's Department Heads, or the SAO for a university-wide organization. */
    private function notifyReviewers(Election $election, string $title, string $message): void
    {
        $organization = $election->organization()->first(['id', 'college_id', 'is_university_wide']);
        $role = $organization->approvalRole(config('approvals.routes.election'));
        $reviewers = AccountProfile::query()
            ->where('role', $role)
            ->where('account_status', 'active')
            ->whereHas('organization', function ($home) use ($role, $organization) {
                if ($role === 'SUPER_ADMIN') {
                    $home->where('organization_type', 'SYSTEM_ADMINISTRATION');
                } else {
                    $home->where('organization_type', 'COLLEGE')->where('college_id', $organization->college_id);
                }
            })
            ->get(['user_school_id', 'organization_id'])
            ->unique(fn ($profile) => $profile->user_school_id.'-'.$profile->organization_id);

        $now = now();

        foreach ($reviewers->chunk(500) as $chunk) {
            Notification::insert($chunk->map(fn ($profile) => [
                'organization_id' => $profile->organization_id,
                'user_id' => $profile->user_school_id,
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

    /** One notice per person, written in chunks of 500. */
    private function notify(Election $election, Collection $schoolIds, string $title, string $message): void
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

    private function audit(Election $election, string $action, ?int $actorSchoolId, ?string $ip, array $new): void
    {
        AuditLog::create([
            'organization_id' => $election->organization_id,
            'user_id' => $actorSchoolId,
            'module' => 'elections',
            'action' => $action,
            'record_type' => Election::class,
            'record_id' => $election->id,
            'old_values' => null,
            'new_values' => $new,
            'ip_address' => $ip,
            'created_at' => now(),
        ]);
    }
}
