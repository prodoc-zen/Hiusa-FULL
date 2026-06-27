<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;

class UserSeeder extends Seeder
{
    public function run(): void
    {
        $users = [
            ['school_id' => 'OFF-2024-001', 'role' => 'officer',  'first_name' => 'Marco',    'last_name' => 'Dela Cruz', 'email' => 'officer1@hiusa.local'],
            ['school_id' => 'OFF-2024-002', 'role' => 'officer',  'first_name' => 'Angela',   'last_name' => 'Santos',    'email' => 'officer2@hiusa.local'],
            ['school_id' => 'ADV-2024-001', 'role' => 'adviser',  'first_name' => 'Ricardo',  'last_name' => 'Lim',       'email' => 'adviser1@hiusa.local'],
            ['school_id' => 'ADV-2024-002', 'role' => 'adviser',  'first_name' => 'Maria',    'last_name' => 'Reyes',     'email' => 'adviser2@hiusa.local'],
            ['school_id' => '2023-00001',   'role' => 'student',  'first_name' => 'Juan',     'last_name' => 'Dela Vega', 'email' => 'student1@hiusa.local'],
            ['school_id' => '2023-00002',   'role' => 'student',  'first_name' => 'Sofia',    'last_name' => 'Bautista',  'email' => 'student2@hiusa.local'],
            ['school_id' => '2023-00003',   'role' => 'student',  'first_name' => 'Carlo',    'last_name' => 'Mendoza',   'email' => 'student3@hiusa.local'],
            ['school_id' => '2023-00004',   'role' => 'student',  'first_name' => 'Pia',      'last_name' => 'Torres',    'email' => 'student4@hiusa.local'],
            ['school_id' => '2023-00005',   'role' => 'student',  'first_name' => 'Luis',     'last_name' => 'Ramos',     'email' => 'student5@hiusa.local'],
        ];

        foreach ($users as $u) {
            User::updateOrCreate(
                ['school_id' => $u['school_id']],
                array_merge($u, ['password_hash' => 'Demo@12345', 'is_member' => true])
            );
        }
    }
}
