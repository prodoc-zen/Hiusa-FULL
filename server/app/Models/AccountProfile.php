<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AccountProfile extends Model
{
    /** The organization areas an officer can be limited to. A null `modules` column means every area. */
    public const MODULES = ['members', 'events', 'finance', 'tasks', 'merchandise', 'elections', 'compliance', 'announcements'];

    /** Profile roles that vote in their organization's election. */
    public const VOTER_ROLES = ['ADMIN', 'SBO_OFFICER', 'STUDENT'];

    protected $guarded = [];

    protected function casts(): array
    {
        return ['modules' => 'array'];
    }

    public function allowsModule(string $module): bool
    {
        return $this->modules === null || in_array($module, $this->modules, true);
    }

    /**
     * The one rule for who votes in an organization: an active student, officer or administrator profile there on an
     * active account, wherever the account itself lives. The voter list counts it and the ballot enforces it.
     */
    public function scopeVotingMembers(Builder $query): Builder
    {
        return $query->where('account_profiles.account_status', 'active')
            ->whereIn('account_profiles.role', self::VOTER_ROLES)
            ->whereHas('user', fn ($user) => $user->where('users.account_status', 'active'));
    }

    /**
     * The voter roll of an election: the voting members who had a profile in the organization when its ballot was
     * finalized. A profile created afterwards is never on it, so nobody can be added to vote in a ballot already set.
     */
    public function scopeOnVoterRoll(Builder $query, $finalizedAt): Builder
    {
        return $finalizedAt
            ? $query->votingMembers()->where('account_profiles.created_at', '<=', $finalizedAt)
            : $query->votingMembers();
    }

    /** The one rule every administrator count follows: an administrator whose profile or user account is disabled or inactive is not counted. */
    public function scopeActiveAdministrators(Builder $query): Builder
    {
        return $query->where('account_profiles.role', 'ADMIN')->where('account_profiles.account_status', 'active')
            ->whereHas('user', fn ($user) => $user->where('users.account_status', 'active'));
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_school_id', 'school_id');
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }
}
