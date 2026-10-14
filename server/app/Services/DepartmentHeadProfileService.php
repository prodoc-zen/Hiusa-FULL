<?php

namespace App\Services;

use App\Models\AccountProfile;

class DepartmentHeadProfileService
{
    public function removeOrganizationProfiles(?int $collegeId = null): int
    {
        $query = AccountProfile::where('role', 'DEPARTMENT_HEAD')
            ->whereHas('organization', fn ($organization) => $organization->where('organization_type', 'STUDENT_ORGANIZATION')
                ->when($collegeId, fn ($organization) => $organization->where('college_id', $collegeId)))
            ->whereHas('user.accountProfiles', fn ($profiles) => $profiles->where('role', 'DEPARTMENT_HEAD')
                ->whereHas('organization', fn ($organization) => $organization->where('organization_type', 'COLLEGE')));

        $removed = 0;
        $query->orderBy('id')->chunkById(100, function ($profiles) use (&$removed) {
            foreach ($profiles as $profile) {
                $profile->delete();
                $removed++;
            }
        });

        return $removed;
    }
}
