<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;

class AdministratorSeeder extends Seeder
{
    public function run(): void
    {
        User::updateOrCreate(
            ['school_id' => 'HIUSA-ADMIN-0001'],
            [
                'first_name' => 'System',
                'last_name' => 'Administrator',
                'email' => 'admin@hiusa.local',
                'password_hash' => 'Admin@123456',
                'role' => 'admin',
            ]
        );
    }
}
