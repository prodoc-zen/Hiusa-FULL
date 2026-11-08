<?php

namespace App\Services\Records;

use App\Models\AcademicSemester;
use App\Models\AccountProfile;
use App\Models\Organization;
use App\Models\OrganizationSemesterRecord;
use Illuminate\Support\Facades\DB;

/**
 * Freezes who led each student organization, and in what standing, for one semester, so the Records page can
 * show a past period as it was after officers change and organizations are archived.
 */
class SemesterSnapshotService
{
    /** Writes or refreshes one row per student organization and returns how many were written. */
    public function snapshot(AcademicSemester $semester): int
    {
        $organizations = Organization::student()->get(['id', 'lifecycle_status']);
        $officers = AccountProfile::whereIn('organization_id', $organizations->pluck('id'))
            ->whereIn('role', ['ADMIN', 'SBO_OFFICER'])->where('account_status', 'active')
            ->with(['user' => fn ($query) => $query->without('organization')->select('school_id', 'first_name', 'last_name')])
            ->get()
            ->groupBy('organization_id');

        DB::transaction(function () use ($organizations, $officers, $semester) {
            foreach ($organizations as $organization) {
                OrganizationSemesterRecord::updateOrCreate(
                    ['organization_id' => $organization->id, 'academic_semester_id' => $semester->id],
                    [
                        'lifecycle_status' => $organization->lifecycle_status,
                        'officers' => $this->officerRows($officers->get($organization->id)),
                    ],
                );
            }
        });

        return $organizations->count();
    }

    /** @return array<int, array{school_id: int, name: string, position_title: ?string, role: string}> */
    public function officerRows(?iterable $profiles): array
    {
        return collect($profiles ?? [])
            ->filter(fn (AccountProfile $profile) => $profile->user !== null)
            ->sortBy(fn (AccountProfile $profile) => $profile->role.'|'.$profile->user->last_name.'|'.$profile->user->first_name)
            ->map(fn (AccountProfile $profile) => [
                'school_id' => (int) $profile->user_school_id,
                'name' => trim($profile->user->first_name.' '.$profile->user->last_name),
                'position_title' => $profile->position_title,
                'role' => $profile->role,
            ])->values()->all();
    }
}
