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

        $organizationId = Organization::where('acronym', 'PSITS-CCS')->value('id');
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

        User::updateOrCreate(
            ['school_id' => 990002],
            [
                'organization_id' => $organizationId,
                'first_name' => 'Organization',
                'last_name' => 'Administrator',
                'email' => 'org.admin@hiusa.local',
                'password_hash' => 'Admin@123456',
                'role' => 'ADMIN',
                'position_title' => 'Adviser',
            ]
        );
    }
}
