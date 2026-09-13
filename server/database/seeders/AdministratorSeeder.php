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

        // Every student organization has its own leadership team. These are
        // regular organization-scoped ADMIN accounts, not SAO accounts.
        // They sign in by selecting their own organization first.
        $leadership = [
            ['title' => 'Adviser', 'first_name' => 'Organization', 'last_name' => 'Adviser'],
            ['title' => 'President', 'first_name' => 'Organization', 'last_name' => 'President'],
            ['title' => 'Vice President â€“ Internal', 'first_name' => 'Organization', 'last_name' => 'Vice President'],
            ['title' => 'Secretary', 'first_name' => 'Organization', 'last_name' => 'Secretary'],
        ];

        Organization::query()
            ->where('organization_type', '!=', 'SYSTEM_ADMINISTRATION')
            ->orderBy('id')
            ->get()
            ->values()
            ->each(function (Organization $organization, int $organizationIndex) use ($leadership): void {
                foreach ($leadership as $leadershipIndex => $leader) {
                    $schoolId = 990002 + ($organizationIndex * 10) + $leadershipIndex;
                    $email = $organization->acronym === 'PSITS-CCS' && $leader['title'] === 'Adviser'
                        ? 'org.admin@hiusa.local'
                        : 'admin.'.($organization->slug ?: $organization->id).'.'.($leadershipIndex + 1).'@hiusa.local';

                    User::updateOrCreate(
                        ['school_id' => $schoolId],
                        [
                            'organization_id' => $organization->id,
                            'first_name' => $leader['first_name'],
                            'last_name' => $leader['last_name'],
                            'email' => $email,
                            'password_hash' => 'Admin@123456',
                            'role' => 'ADMIN',
                            'position_title' => $leader['title'],
                            'account_status' => 'active',
                            'is_member' => true,
                            'department' => $organization->college,
                        ]
                    );
                }
            });
    }
}
