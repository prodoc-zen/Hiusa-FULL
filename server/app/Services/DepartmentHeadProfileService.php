<?php

namespace App\Services;

use App\Models\AccountProfile;
use App\Models\Organization;
use Illuminate\Support\Facades\DB;

class DepartmentHeadProfileService
{
    public function assignForOrganization(Organization $organization): int
    {
        if ($organization->organization_type !== 'STUDENT_ORGANIZATION' || ! $organization->college_id || ! $organization->is_active || ! $organization->isWritable()) {
            return 0;
        }

        $home = Organization::where('organization_type', 'COLLEGE')->where('college_id', $organization->college_id)
            ->where('is_active', true)->first(['id']);
        if (! $home) {
            return 0;
        }

        $created = 0;
        $heads = AccountProfile::where('organization_id', $home->id)->where('role', 'DEPARTMENT_HEAD')
            ->where('account_status', 'active')->whereHas('user', fn ($query) => $query->where('account_status', 'active'))
            ->get(['user_school_id', 'position_title']);
        foreach ($heads as $head) {
            $profile = AccountProfile::firstOrCreate(
                ['user_school_id' => $head->user_school_id, 'organization_id' => $organization->id],
                ['role' => 'DEPARTMENT_HEAD', 'account_status' => 'active', 'position_title' => $head->position_title],
            );
            $created += (int) $profile->wasRecentlyCreated;
        }

        return $created;
    }

    public function backfillApprovedOrganizations(?int $collegeId = null): int
    {
        $created = 0;
        Organization::student()->where('is_active', true)->where('lifecycle_status', 'active')
            ->when($collegeId, fn ($query) => $query->where('college_id', $collegeId))
            ->whereIn('id', DB::table('organization_applications')->where('status', 'approved')->whereNotNull('organization_id')->select('organization_id'))
            ->chunkById(100, function ($organizations) use (&$created) {
                foreach ($organizations as $organization) {
                    $created += $this->assignForOrganization($organization);
                }
            });

        return $created;
    }
}
