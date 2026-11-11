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

    public const UNAVAILABLE_MESSAGE = 'This account profile is unavailable.';

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

    /**
     * Active profiles that put the holder's password beyond an Admin's reset, because one password opens every profile:
     * administrator or higher in any organization, or officer in any organization but the Admin's own.
     */
    public function scopeBeyondAdminReset(Builder $query, int $organizationId): Builder
    {
        return $query->where('account_profiles.account_status', 'active')
            ->where(fn (Builder $elevated) => $elevated
                ->whereIn('account_profiles.role', ['ADMIN', 'DEPARTMENT_HEAD', 'SUPER_ADMIN'])
                ->orWhere(fn (Builder $elsewhere) => $elsewhere
                    ->where('account_profiles.organization_id', '!=', $organizationId)
                    ->where('account_profiles.role', '!=', 'STUDENT')));
    }

    /** The one rule for a profile somebody can work in: it is active, and so are its organization and college. */
    public function isUsable(): bool
    {
        return $this->account_status === 'active' && (bool) $this->organization?->is_active && $this->organization->collegeAllowsAccess();
    }

    /** What the holder of a profile that stopped working is told: an election hand over names itself, anything else stays plain. */
    public function unavailableMessage(): string
    {
        return $this->retiredByHandover()
            ? 'Your officer access for '.$this->organization->name.' ended when the new officers took over.'
            : self::UNAVAILABLE_MESSAGE;
    }

    /** The hand over is why a profile is inactive only while nothing has touched it since: a later change, like switching it off again, has its own cause. */
    private function retiredByHandover(): bool
    {
        return $this->account_status === 'inactive' && $this->organization !== null
            && AuditLog::where('organization_id', $this->organization_id)->where('action', 'access_handed_over')
                ->when($this->updated_at, fn (Builder $audits, $retiredAt) => $audits->where('created_at', '>=', $retiredAt))
                ->get(['new_values'])
                ->contains(fn (AuditLog $audit) => in_array((int) $this->user_school_id, array_map('intval', $audit->new_values['deactivated'] ?? []), true));
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
