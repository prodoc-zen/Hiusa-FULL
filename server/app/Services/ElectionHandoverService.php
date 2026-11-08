<?php

namespace App\Services;

use App\Models\AccountProfile;
use App\Models\AuditLog;
use App\Models\Candidate;
use App\Models\Election;
use App\Models\ElectionPosition;
use App\Models\Notification;
use App\Models\Organization;
use App\Models\SboPosition;
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

    public function isReleased(Election $election): bool
    {
        return $election->status === 'closed' && $election->results_visible && $election->finalized_at !== null;
    }

    /**
     * Give each position's winners access to the organization and retire the outgoing holders
     * of the same position. A tied seat stays open, so its outgoing holders keep access until
     * someone assigns it by hand. Runs once per election, however many times results are released.
     *
     * @return array{handed_over: bool, granted: int, deactivated: int, ties: int}|null null when nothing ran
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
            $deactivated = [];
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
                    $profile->update(['account_status' => 'inactive']);
                    $deactivated[] = (int) $profile->user_school_id;
                }
            }

            foreach ($decided as $row) {
                $title = $row['position']->title;
                $role = $this->roleFor($organization->id, $title);
                foreach ($row['winners'] as $candidate) {
                    if ($this->grant($organization, $election, (int) $candidate->user_id, $role, $title)) {
                        $granted[] = ['school_id' => (int) $candidate->user_id, 'position_title' => $title, 'role' => $role];
                    }
                }
            }

            AuditLog::create([
                'organization_id' => $organization->id,
                'user_id' => $actorSchoolId,
                'module' => 'elections',
                'action' => 'access_handed_over',
                'record_type' => Election::class,
                'record_id' => $election->id,
                'old_values' => null,
                'new_values' => ['granted' => $granted, 'deactivated' => $deactivated, 'ties' => $ties],
                'ip_address' => $ipAddress,
                'created_at' => now(),
            ]);

            return ['handed_over' => true, 'granted' => count($granted), 'deactivated' => count($deactivated), 'ties' => count($ties)];
        });
    }

    private function roleFor(int $organizationId, string $title): string
    {
        $listed = SboPosition::where('organization_id', $organizationId)
            ->whereRaw('lower(title) = ?', [Str::lower($title)])
            ->orderByRaw("case when role = 'ADMIN' then 0 else 1 end")
            ->first();

        if ($listed) {
            return $listed->role === 'ADMIN' ? 'ADMIN' : 'SBO_OFFICER';
        }

        return Str::contains(Str::lower($title), 'president') ? 'ADMIN' : 'SBO_OFFICER';
    }

    private function grant(Organization $organization, Election $election, int $schoolId, string $role, string $title): bool
    {
        $profile = AccountProfile::where('organization_id', $organization->id)->where('user_school_id', $schoolId)->first();

        if ($profile && ! in_array($profile->role, ['ADMIN', 'SBO_OFFICER', 'STUDENT'], true)) {
            return false;
        }

        // An org head the dean granted keeps that access when they win a lower seat.
        if ($profile && $profile->role === 'ADMIN' && $role !== 'ADMIN') {
            return false;
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

        return true;
    }
}
