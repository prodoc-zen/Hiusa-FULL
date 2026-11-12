<?php

namespace App\Services;

use App\Models\AccountProfile;
use Illuminate\Support\Collection;

/**
 * Who a notice about an organization goes to. A person belongs to an organization, and administers it, through an
 * account profile: the home columns on the users row name only where the account was created, so a plain query on
 * users.role and users.organization_id misses everyone who was granted access afterwards. Every row carries the
 * profile's own organization, the one the bell filters by.
 */
class OrganizationRecipients
{
    /** The active administrators of one organization, one profile each (user_school_id, organization_id). */
    public function administrators(int $organizationId): Collection
    {
        return AccountProfile::activeAdministrators()
            ->where('account_profiles.organization_id', $organizationId)
            ->get(['account_profiles.user_school_id', 'account_profiles.organization_id']);
    }

    /** The active administrators of every student organization, one profile each (user_school_id, organization_id). */
    public function studentOrganizationAdministrators(): Collection
    {
        return AccountProfile::activeAdministrators()
            ->whereHas('organization', fn ($organization) => $organization->student())
            ->get(['account_profiles.user_school_id', 'account_profiles.organization_id']);
    }

    /** The school ids of everyone with an active profile in one organization, whatever their role, except one person. */
    public function memberIds(int $organizationId, ?int $exceptSchoolId = null): Collection
    {
        return AccountProfile::where('account_profiles.organization_id', $organizationId)
            ->where('account_profiles.account_status', 'active')
            ->whereHas('user', fn ($user) => $user->where('users.account_status', 'active'))
            ->when($exceptSchoolId !== null, fn ($query) => $query->where('account_profiles.user_school_id', '!=', $exceptSchoolId))
            ->distinct()
            ->pluck('account_profiles.user_school_id');
    }
}
