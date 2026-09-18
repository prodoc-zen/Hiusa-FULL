<?php

namespace Database\Seeders;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Database\Seeder;

class AdministratorSeeder extends Seeder
{
    public function run(): void
    {
        if (app()->isProduction()) {
            return;
        }

        $saoOrganizationId = Organization::where('acronym', 'SAO')->value('id');

        User::updateOrCreate(
            ['school_id' => 990001],
            [
                'organization_id' => $saoOrganizationId,
                'first_name' => 'SAO',
                'last_name' => 'Director',
                'email' => 'sao.director@hiusa.local',
                'password_hash' => 'Admin@123456',
                'role' => 'SUPER_ADMIN',
                'position_title' => 'SAO Director',
            ]
        );

        // Adviser is an organization-scoped ADMIN position assigned by SAO.
        // Other demo organization leaders belong in UserSeeder; creating them
        // here too would duplicate the same ADMIN accounts and positions.
        Organization::query()
            ->where('organization_type', '!=', 'SYSTEM_ADMINISTRATION')
            ->orderBy('id')
            ->get()
            ->values()
            ->each(function (Organization $organization, int $organizationIndex): void {
                $schoolId = 990002 + ($organizationIndex * 10);
                $email = $organization->acronym === 'PSITS-CCS'
                    ? 'org.admin@hiusa.local'
                    : 'adviser.'.($organization->slug ?: $organization->id).'@hiusa.local';

                User::updateOrCreate(
                    ['school_id' => $schoolId],
                    [
                        'organization_id' => $organization->id,
                        'first_name' => 'Organization',
                        'last_name' => 'Adviser',
                        'email' => $email,
                        'password_hash' => 'Admin@123456',
                        'role' => 'ADMIN',
                        'position_title' => 'Adviser',
                        'account_status' => 'active',
                        'is_member' => true,
                        'department' => $organization->college,
                    ]
                );
            });
    }
}
