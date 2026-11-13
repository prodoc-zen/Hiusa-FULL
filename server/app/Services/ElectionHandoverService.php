<?php

namespace App\Services;

use App\Models\AccountProfile;
use App\Models\AuditLog;
use App\Models\Candidate;
use App\Models\Election;
use App\Models\ElectionPosition;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class ElectionHandoverService
{
    /**
     * Per position: candidates by votes, who won, and whether a tie stops an automatic grant.
     * A tie that straddles the last open seat leaves every tied candidate out; only those
     * strictly ahead of the tie win.
     *
     * @return Collection<int, array{position: ElectionPosition, candidates: Collection, winners: Collection, tie: bool}>
     */
    public function standings(Election $election): Collection
    {
        $positions = ElectionPosition::where('election_id', $election->id)->orderBy('id')->get();
        $candidates = Candidate::withCount('votes')
            ->whereIn('position_id', $positions->pluck('id'))
            ->get()
            ->groupBy('position_id');

        return $positions->map(function (ElectionPosition $position) use ($candidates) {
            $ranked = $candidates->get($position->id, collect())
                ->filter(fn (Candidate $candidate) => $candidate->votes_count > 0)
                ->sortByDesc('votes_count')
                ->values();
            $seats = max(1, (int) $position->max_winners);
            $cutoff = $ranked->get($seats - 1)?->votes_count;

            if ($cutoff === null) {
                return ['position' => $position, 'candidates' => $ranked, 'winners' => $ranked, 'tie' => false];
            }

            $beyond = $ranked->get($seats)?->votes_count;
            $tie = $beyond !== null && $beyond === $cutoff;

            return [
                'position' => $position,
                'candidates' => $ranked,
                'winners' => $tie ? $ranked->filter(fn (Candidate $candidate) => $candidate->votes_count > $cutoff)->values() : $ranked->take($seats)->values(),
                'tie' => $tie,
            ];
        });
    }

    /** Position titles where a winner's access was skipped in the hand over, so the results can say so. */
    public function skippedTitles(Election $election): array
    {
        $audit = AuditLog::where('record_type', Election::class)->where('record_id', $election->id)->where('action', 'access_handed_over')->latest('id')->first();

        return array_values(array_unique(array_column($audit?->new_values['skipped'] ?? [], 'position_title')));
    }

    public function isReleased(Election $election): bool
    {
        return $election->status === 'closed' && $election->results_visible && $election->finalized_at !== null;
    }

    /**
     * Give each position's winners access to the organization and step the outgoing holders
     * of the same position down to plain students. A tied seat stays open, so its outgoing holders keep access until
     * someone assigns it by hand. Runs once per election, however many times results are released.
     *
     * @return array{handed_over: bool, granted: int, demoted: int, ties: int}|null null when nothing ran
     */
    public function handOver(Election $election, ?int $actorSchoolId = null, ?string $ipAddress = null): ?array
    {
        if ($election->access_handed_over_at !== null || ! $this->isReleased($election)) {
            return null;
        }

        return DB::transaction(function () use ($election, $actorSchoolId, $ipAddress) {
            $claimed = Election::whereKey($election->id)->whereNull('access_handed_over_at')->update(['access_handed_over_at' => now()]);
            if ($claimed === 0) {
                return null;
            }

            $organization = Organization::find($election->organization_id);
            if (! $organization) {
                return null;
            }

            $standings = $this->standings($election);
            $granted = [];
            $skipped = [];
            $demoted = [];
            $ties = $standings->where('tie', true)->map(fn (array $row) => $row['position']->title)->values()->all();
            $decided = $standings->reject(fn (array $row) => $row['winners']->isEmpty());

            foreach ($decided->reject(fn (array $row) => $row['tie']) as $row) {
                $winnerIds = $row['winners']->pluck('user_id')->map(fn ($id) => (int) $id)->all();
                $outgoing = AccountProfile::where('organization_id', $organization->id)
                    ->whereIn('role', ['ADMIN', 'SBO_OFFICER'])
                    ->where('account_status', 'active')
                    ->whereRaw('lower(position_title) = ?', [Str::lower($row['position']->title)])
                    ->whereNotIn('user_school_id', $winnerIds)
                    ->get();
                foreach ($outgoing as $profile) {
                    // A former officer is still a member: they keep the organization, stay on the voter roll and lose only the seat.
                    $profile->update(['role' => 'STUDENT', 'position_title' => null, 'modules' => null]);
                    // The account row of a member whose home is this organization holds the title as well, and reads back when the profile has none.
                    User::where('school_id', $profile->user_school_id)->where('organization_id', $organization->id)->update(['position_title' => null]);
                    $demoted[] = (int) $profile->user_school_id;
                }
            }

            foreach ($decided as $row) {
                $title = $row['position']->title;
                $role = $this->roleFor($title);
                foreach ($row['winners'] as $candidate) {
                    $outcome = $this->grant($organization, $election, (int) $candidate->user_id, $role, $title, $demoted);
                    if ($outcome === 'granted') {
                        $granted[] = ['school_id' => (int) $candidate->user_id, 'position_title' => $title, 'role' => $role];
                    } elseif ($outcome === 'skipped') {
                        $skipped[] = ['school_id' => (int) $candidate->user_id, 'position_title' => $title];
                    }
                }
            }

            $demoted = array_values(array_diff($demoted, array_column($granted, 'school_id')));

            AuditLog::create([
                'organization_id' => $organization->id,
                'user_id' => $actorSchoolId,
                'module' => 'elections',
                'action' => 'access_handed_over',
                'record_type' => Election::class,
                'record_id' => $election->id,
                'old_values' => null,
                'new_values' => ['granted' => $granted, 'skipped' => $skipped, 'demoted' => $demoted, 'ties' => $ties],
                'ip_address' => $ipAddress,
                'created_at' => now(),
            ]);

            return ['handed_over' => true, 'granted' => count($granted), 'demoted' => count($demoted), 'ties' => count($ties)];
        });
    }

    /**
     * The President and every Vice President head the organization; every other seat is an officer.
     * The organization's position list is not consulted: it carries the standard titles under both roles.
     */
    private function roleFor(string $title): string
    {
        $normalised = Str::lower(trim(preg_replace('/[\p{Pd}\s]+/u', ' ', $title) ?? $title));

        return $normalised === 'president' || str_starts_with($normalised, 'vice president') ? 'ADMIN' : 'SBO_OFFICER';
    }

    /**
     * @param  array<int, int>  $retired  holders stepped down in this run, who may take the seat they won instead
     * @return 'granted'|'kept'|'skipped'
     */
    private function grant(Organization $organization, Election $election, int $schoolId, string $role, string $title, array $retired): string
    {
        $profile = AccountProfile::where('organization_id', $organization->id)->where('user_school_id', $schoolId)->first();
        $retiredNow = in_array($schoolId, $retired, true);

        if ($profile && ! in_array($profile->role, ['ADMIN', 'SBO_OFFICER', 'STUDENT'], true)) {
            return 'skipped';
        }

        // A profile or account switched off for cause stays off; only a seat just stepped down from here is taken back.
        if ($profile && ! $retiredNow && $profile->account_status !== 'active') {
            return 'skipped';
        }

        if (! User::where('school_id', $schoolId)->where('account_status', 'active')->exists()) {
            return 'skipped';
        }

        // An org head the dean granted keeps that access when they win a lower seat.
        if ($profile && $profile->role === 'ADMIN' && $role !== 'ADMIN' && ! $retiredNow) {
            return 'kept';
        }

        if ($profile) {
            $profile->update(['role' => $role, 'position_title' => $title, 'account_status' => 'active', 'modules' => null]);
        } else {
            AccountProfile::create([
                'user_school_id' => $schoolId,
                'organization_id' => $organization->id,
                'role' => $role,
                'account_status' => 'active',
                'position_title' => $title,
                'modules' => null,
            ]);
        }

        Notification::create([
            'organization_id' => $organization->id,
            'user_id' => $schoolId,
            'title' => 'You now have access to '.$organization->name,
            'message' => 'You won '.$title.' in "'.$election->title.'". You now have access to '.$organization->name.' as '.$title.'.',
            'notification_type' => 'general',
            'reference_type' => 'election',
            'reference_id' => $election->id,
            'is_read' => false,
            'sent_at' => now(),
        ]);

        return 'granted';
    }
}
