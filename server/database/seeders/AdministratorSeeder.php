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

        User::updateOrCreate(
            ['school_id' => 990001],
            [
                'organization_id' => $organizationId,
                'first_name' => 'System',
                'last_name' => 'Administrator',
                'email' => 'admin@hiusa.local',
                'password_hash' => 'Admin@123456',
                'role' => 'admin',
            ]
        );
    }
}
